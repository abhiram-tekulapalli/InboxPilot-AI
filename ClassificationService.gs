/**
 * ============================================================================
 * InboxPilot AI — ClassificationService.gs
 * End-to-End Email Classification, Spam Fast-Path, Validation & Rule Merging
 * ============================================================================
 */

/**
 * Classifies an incoming preprocessed email record.
 * - For Gmail Spam-labelled messages, classifies them separately using the Spam indicator
 *   without wasting unnecessary Gemini API quota.
 * - For non-spam messages, combines Sender Intelligence rules, Gemini structured classification,
 *   and Action/Deadline normalization.
 *
 * @param {Object} emailObj Preprocessed email record from GmailService.
 * @param {Array<Object>} senderRules Active rules from the "Sender Rules" sheet.
 * @return {Object} {
 *   ok: boolean,
 *   rateLimited: boolean,
 *   error: string|null,
 *   record: Object|null
 * }
 */
function classifyEmailRecord(emailObj, senderRules) {
  const senderIntel = evaluateSenderIntelligence(emailObj, senderRules || []);

  // Fast-path for Gmail SPAM-labelled messages:
  // Requirement: "For Gmail Spam-labelled messages, use the Gmail spam label as a strong indicator,
  // classify them separately and avoid unnecessary AI calls. Never delete or modify them."
  if (emailObj.isSpam && senderIntel.matchedRuleType !== 'EXACT_EMAIL_RULE') {
    const spamRecord = buildSpamEmailRecord(emailObj, senderIntel);
    return {
      ok: true,
      rateLimited: false,
      error: null,
      record: spamRecord
    };
  }

  // Call Gemini API for full independent Priority + Category + Action + Deadline analysis
  const aiResponse = callGeminiForEmailClassification(emailObj, senderIntel);
  if (!aiResponse.ok) {
    return {
      ok: false,
      rateLimited: Boolean(aiResponse.rateLimited),
      error: aiResponse.error || 'Gemini classification failed',
      record: null
    };
  }

  const rawAi = aiResponse.data;
  const validated = validateAndMergeClassification(rawAi, emailObj, senderIntel);

  return {
    ok: true,
    rateLimited: false,
    error: null,
    record: validated
  };
}

/**
 * Builds a complete, structured record for Gmail Spam-labelled messages without invoking Gemini.
 * @param {Object} emailObj Preprocessed email object.
 * @param {Object} senderIntel Sender intelligence evaluation.
 * @return {Object} Complete classified record ready for Google Sheets storage.
 */
function buildSpamEmailRecord(emailObj, senderIntel) {
  return {
    messageId: emailObj.messageId,
    threadId: emailObj.threadId,
    receivedTimestamp: emailObj.receivedTimestampFormatted,
    date: emailObj.receivedDateString,
    senderName: emailObj.senderName,
    senderEmail: emailObj.senderEmail,
    senderDomain: emailObj.senderDomain,
    senderOrganization: senderIntel.organization || 'Unknown',
    senderGroup: senderIntel.senderGroup || 'Services / Other',
    subject: emailObj.subject,
    summary: '[Gmail Spam Filter] Message flagged as Spam by Gmail. ' +
      (emailObj.snippet ? emailObj.snippet.substring(0, 140) : ''),
    priority: PRIORITY_LEVELS.LOW,
    primaryCategory: 'Suspected Spam and Phishing',
    secondaryCategory: '',
    actionRequired: 'NO',
    actionDescription: '',
    actionStatus: ACTION_STATUSES.NONE,
    deadlineText: '',
    deadlineISO: '',
    deadlineConfidence: 0,
    classificationConfidence: 0.99,
    criticalReason: '',
    gmailSpamLabel: 'YES',
    gmailLink: emailObj.gmailLink,
    processingStatus: PROCESSING_STATUSES.SPAM_SKIPPED,
    criticalAlertStatus: ALERT_STATUSES.NOT_REQUIRED,
    criticalAlertSentTimestamp: '',
    retryCount: 0
  };
}

/**
 * Validates all fields returned by Gemini against allowed enums, applies manual Sender Rule
 * overrides (where exact email rules take precedence over domain rules), and normalizes actions/deadlines.
 *
 * @param {Object} rawAi Parsed JSON from Gemini.
 * @param {Object} emailObj Preprocessed email object.
 * @param {Object} senderIntel Sender intelligence evaluation.
 * @return {Object} Validated and normalized email classification record.
 */
function validateAndMergeClassification(rawAi, emailObj, senderIntel) {
  const config = getAppConfig();

  // 1. Validate Priority
  let priority = validatePriorityLevel(rawAi.priority);
  if (senderIntel.forcedPriority) {
    priority = senderIntel.forcedPriority;
  }

  // Guard against promotional/marketing or suspected phishing being marked CRITICAL without manual rule
  let primaryCategory = validateCategoryName(rawAi.category);
  if (senderIntel.forcedCategory) {
    primaryCategory = senderIntel.forcedCategory;
  }

  // If display name spoofing was detected and not overridden by a trusted rule, downgrade false CRITICAL
  // or flag as Suspected Spam and Phishing if Gemini also had low trust
  if (senderIntel.spoofWarning && !senderIntel.matchedRuleType) {
    if (primaryCategory === 'Suspected Spam and Phishing' && priority === PRIORITY_LEVELS.CRITICAL) {
      priority = PRIORITY_LEVELS.LOW;
    }
  }

  if (primaryCategory === 'Promotions and Marketing' && priority === PRIORITY_LEVELS.CRITICAL && !senderIntel.forcedPriority) {
    priority = PRIORITY_LEVELS.LOW;
  }

  // 2. Validate Secondary Category
  let secondaryCategory = '';
  if (rawAi.secondaryCategory && String(rawAi.secondaryCategory).toLowerCase() !== 'null') {
    const candidateSecondary = validateCategoryName(rawAi.secondaryCategory);
    if (candidateSecondary !== primaryCategory && candidateSecondary !== 'Other') {
      secondaryCategory = candidateSecondary;
    }
  }

  // 3. Validate Sender Group (Manual rules take precedence, then Gemini or Domain Heuristic)
  let senderGroup = validateSenderGroup(rawAi.senderGroup);
  if (senderIntel.matchedRuleType === 'EXACT_EMAIL_RULE' || senderIntel.matchedRuleType === 'DOMAIN_RULE') {
    senderGroup = senderIntel.senderGroup;
  } else if (senderIntel.senderGroup && senderGroup === 'Services / Other') {
    senderGroup = senderIntel.senderGroup;
  }

  // 4. Validate Summary
  let summary = rawAi.summary ? String(rawAi.summary).trim() : '';
  if (!summary) {
    summary = emailObj.snippet ? String(emailObj.snippet).substring(0, 180) : emailObj.subject;
  }
  if (senderIntel.spoofWarning) {
    summary = '⚠️ [Unverified Sender Warning] ' + summary;
  }

  // 5. Process Action & Deadline
  const actionAndDeadline = processActionAndDeadline(rawAi, emailObj, priority);

  // 6. Validate Confidence & Critical Reason
  let confidence = typeof rawAi.confidence === 'number'
    ? Math.max(0, Math.min(1, rawAi.confidence))
    : 0.85;
  confidence = Number(confidence.toFixed(2));

  let criticalReason = '';
  if (priority === PRIORITY_LEVELS.CRITICAL) {
    criticalReason = rawAi.criticalReason && String(rawAi.criticalReason).toLowerCase() !== 'null'
      ? String(rawAi.criticalReason).trim()
      : 'Time-sensitive critical email requiring immediate attention.';
  } else if (priority === PRIORITY_LEVELS.HIGH && config.alertOnHighPriority) {
    criticalReason = rawAi.criticalReason && String(rawAi.criticalReason).toLowerCase() !== 'null'
      ? String(rawAi.criticalReason).trim()
      : 'High-priority email notification enabled in settings.';
  }

  // Determine whether an immediate Telegram alert is required
  const needsImmediateAlert = (
    priority === PRIORITY_LEVELS.CRITICAL ||
    (priority === PRIORITY_LEVELS.HIGH && config.alertOnHighPriority)
  );

  return {
    messageId: emailObj.messageId,
    threadId: emailObj.threadId,
    receivedTimestamp: emailObj.receivedTimestampFormatted,
    date: emailObj.receivedDateString,
    senderName: emailObj.senderName,
    senderEmail: emailObj.senderEmail,
    senderDomain: emailObj.senderDomain,
    senderOrganization: senderIntel.organization || 'Unknown',
    senderGroup: senderGroup,
    subject: emailObj.subject,
    summary: summary,
    priority: priority,
    primaryCategory: primaryCategory,
    secondaryCategory: secondaryCategory,
    actionRequired: actionAndDeadline.actionRequiredLabel,
    actionDescription: actionAndDeadline.actionDescription,
    actionStatus: actionAndDeadline.actionStatus,
    deadlineText: actionAndDeadline.deadlineText,
    deadlineISO: actionAndDeadline.deadlineISO,
    deadlineConfidence: actionAndDeadline.deadlineConfidence,
    classificationConfidence: confidence,
    criticalReason: criticalReason,
    gmailSpamLabel: emailObj.isSpam ? 'YES' : 'NO',
    gmailLink: emailObj.gmailLink,
    processingStatus: PROCESSING_STATUSES.CLASSIFIED,
    criticalAlertStatus: needsImmediateAlert ? ALERT_STATUSES.PENDING : ALERT_STATUSES.NOT_REQUIRED,
    criticalAlertSentTimestamp: '',
    retryCount: 0
  };
}

/**
 * Validates that a priority string matches one of CRITICAL, HIGH, NORMAL, LOW.
 * @param {string} priority Candidate priority.
 * @return {string} Valid priority level.
 */
function validatePriorityLevel(priority) {
  if (!priority) return PRIORITY_LEVELS.NORMAL;
  const upper = String(priority).trim().toUpperCase();
  if (PRIORITY_LEVELS[upper]) {
    return PRIORITY_LEVELS[upper];
  }
  return PRIORITY_LEVELS.NORMAL;
}

/**
 * Validates that a category string matches one of the 15 official EMAIL_CATEGORIES.
 * @param {string} category Candidate category.
 * @return {string} Valid category name.
 */
function validateCategoryName(category) {
  if (!category) return 'Other';
  const trimmed = String(category).trim();
  if (EMAIL_CATEGORIES.indexOf(trimmed) !== -1) {
    return trimmed;
  }

  // Case-insensitive match
  const lower = trimmed.toLowerCase();
  for (let i = 0; i < EMAIL_CATEGORIES.length; i++) {
    if (EMAIL_CATEGORIES[i].toLowerCase() === lower) {
      return EMAIL_CATEGORIES[i];
    }
  }

  // Partial keyword fallback
  if (lower.indexOf('univ') !== -1 || lower.indexOf('academ') !== -1) return 'University and Academics';
  if (lower.indexOf('place') !== -1 || lower.indexOf('recruit') !== -1) return 'Placement and Recruitment';
  if (lower.indexOf('github') !== -1 || lower.indexOf('dev') !== -1) return 'GitHub and Developer Tools';
  if (lower.indexOf('finan') !== -1 || lower.indexOf('bank') !== -1) return 'Finance and Banking';
  if (lower.indexOf('bill') !== -1 || lower.indexOf('pay') !== -1) return 'Bills and Payments';
  if (lower.indexOf('gov') !== -1) return 'Government and Official';
  if (lower.indexOf('person') !== -1) return 'Personal Communication';
  if (lower.indexOf('secur') !== -1 || lower.indexOf('account') !== -1) return 'Security and Account Notifications';
  if (lower.indexOf('shop') !== -1 || lower.indexOf('order') !== -1) return 'Shopping and Orders';
  if (lower.indexOf('travel') !== -1 || lower.indexOf('book') !== -1) return 'Travel and Bookings';
  if (lower.indexOf('news') !== -1 || lower.indexOf('update') !== -1) return 'Newsletters and Updates';
  if (lower.indexOf('promo') !== -1 || lower.indexOf('market') !== -1) return 'Promotions and Marketing';
  if (lower.indexOf('social') !== -1 || lower.indexOf('event') !== -1) return 'Social and Events';
  if (lower.indexOf('spam') !== -1 || lower.indexOf('phish') !== -1) return 'Suspected Spam and Phishing';

  return 'Other';
}
