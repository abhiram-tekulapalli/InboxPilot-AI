/**
 * ============================================================================
 * InboxPilot AI — ActionService.gs
 * Action Required Normalization and Deadline Extraction & Validation Engine
 * ============================================================================
 */

/**
 * Normalizes and validates the action and deadline fields extracted by Gemini.
 * Ensures Asia/Kolkata default timezone, prevents hallucinated deadlines, and
 * flags uncertain deadlines for manual review.
 *
 * @param {Object} rawAiResult Validated or raw Gemini classification object.
 * @param {Object} emailObj Preprocessed email object.
 * @param {string} finalPriority Final priority assigned to the email.
 * @return {Object} {
 *   actionRequired: boolean,
 *   actionRequiredLabel: string, // "YES" | "NO"
 *   actionDescription: string,
 *   actionPriority: string,
 *   actionStatus: string, // "PENDING" | "NONE"
 *   deadlineText: string,
 *   deadlineISO: string,
 *   deadlineDate: string,
 *   deadlineTime: string,
 *   deadlineTimezone: string,
 *   deadlineConfidence: number,
 *   isUncertainDeadline: boolean
 * }
 */
function processActionAndDeadline(rawAiResult, emailObj, finalPriority) {
  const config = getAppConfig();
  const defaultTz = config.timezone || DEFAULT_CONFIG.TIMEZONE;

  const actionRequiredBool = Boolean(rawAiResult && rawAiResult.actionRequired === true);
  let actionDescription = rawAiResult && rawAiResult.actionDescription
    ? String(rawAiResult.actionDescription).trim()
    : '';

  if (actionRequiredBool && !actionDescription) {
    actionDescription = 'Review email and complete required action: ' + (emailObj.subject || '');
  }
  if (!actionRequiredBool) {
    actionDescription = '';
  }

  // Every actionable email initially receives the status PENDING
  const actionStatus = actionRequiredBool ? ACTION_STATUSES.PENDING : ACTION_STATUSES.NONE;
  const actionPriority = actionRequiredBool ? finalPriority : 'NONE';

  // Process Deadline Extraction
  let deadlineText = rawAiResult && rawAiResult.deadlineText
    ? String(rawAiResult.deadlineText).trim()
    : '';
  let rawIso = rawAiResult && rawAiResult.deadlineISO
    ? String(rawAiResult.deadlineISO).trim()
    : '';
  let deadlineConfidence = typeof (rawAiResult && rawAiResult.deadlineConfidence) === 'number'
    ? Math.max(0, Math.min(1, rawAiResult.deadlineConfidence))
    : 0;

  let normalizedIso = '';
  let deadlineDate = '';
  let deadlineTime = '';
  let isUncertainDeadline = false;

  if (deadlineText.toLowerCase() === 'null' || deadlineText.toLowerCase() === 'none') {
    deadlineText = '';
  }
  if (rawIso.toLowerCase() === 'null' || rawIso.toLowerCase() === 'none') {
    rawIso = '';
  }

  if (rawIso) {
    const parsedDeadline = parseAndNormalizeDeadlineIso(rawIso, defaultTz);
    if (parsedDeadline.valid) {
      normalizedIso = parsedDeadline.isoString;
      deadlineDate = parsedDeadline.dateString;
      deadlineTime = parsedDeadline.timeString;
      if (deadlineConfidence === 0) {
        deadlineConfidence = 0.85;
      }
    } else {
      isUncertainDeadline = true;
      normalizedIso = 'UNCERTAIN (Manual Review)';
      deadlineConfidence = Math.min(deadlineConfidence || 0.4, 0.5);
    }
  } else if (deadlineText) {
    // Wording exists in the email, but exact calendar date could not be resolved confidently
    isUncertainDeadline = true;
    normalizedIso = 'UNCERTAIN (Manual Review)';
    deadlineConfidence = Math.min(deadlineConfidence || 0.45, 0.55);
  }

  if (deadlineConfidence > 0 && deadlineConfidence < 0.6 && normalizedIso && normalizedIso.indexOf('UNCERTAIN') === -1) {
    isUncertainDeadline = true;
    deadlineText = (deadlineText ? deadlineText + ' [VERIFY DATE]' : '[VERIFY DATE]');
  }

  return {
    actionRequired: actionRequiredBool,
    actionRequiredLabel: actionRequiredBool ? 'YES' : 'NO',
    actionDescription: actionDescription,
    actionPriority: actionPriority,
    actionStatus: actionStatus,
    deadlineText: deadlineText,
    deadlineISO: normalizedIso,
    deadlineDate: deadlineDate,
    deadlineTime: deadlineTime,
    deadlineTimezone: (deadlineText || normalizedIso) ? defaultTz : '',
    deadlineConfidence: (deadlineText || normalizedIso) ? Number(deadlineConfidence.toFixed(2)) : 0,
    isUncertainDeadline: isUncertainDeadline
  };
}

/**
 * Parses an ISO-8601 date or datetime string and normalizes it to Asia/Kolkata (+05:30).
 * Never invents a deadline if the string cannot be parsed.
 *
 * @param {string} rawIso ISO-8601 string from Gemini.
 * @param {string} timezone Target timezone (e.g. Asia/Kolkata).
 * @return {Object} { valid: boolean, isoString: string, dateString: string, timeString: string, dateObj: Date|null }
 */
function parseAndNormalizeDeadlineIso(rawIso, timezone) {
  if (!rawIso) {
    return { valid: false, isoString: '', dateString: '', timeString: '', dateObj: null };
  }

  let candidate = String(rawIso).trim();

  // If date-only YYYY-MM-DD is provided, default to 23:59:00+05:30 in IST
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    candidate = candidate + 'T23:59:00+05:30';
  } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(candidate)) {
    // If no timezone offset is attached, attach +05:30 for Asia/Kolkata
    candidate = candidate.replace(' ', 'T');
    if (candidate.split(':').length === 2) {
      candidate += ':00';
    }
    candidate += '+05:30';
  }

  const parsedDate = new Date(candidate);
  if (isNaN(parsedDate.getTime())) {
    return { valid: false, isoString: '', dateString: '', timeString: '', dateObj: null };
  }

  // Sanity check year range (2020 - 2035) to catch hallucinated timestamps
  const year = parsedDate.getFullYear();
  if (year < 2020 || year > 2035) {
    return { valid: false, isoString: '', dateString: '', timeString: '', dateObj: null };
  }

  const tz = timezone || 'Asia/Kolkata';
  const isoFormatted = Utilities.formatDate(parsedDate, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
  const dateString = Utilities.formatDate(parsedDate, tz, 'yyyy-MM-dd');
  const timeString = Utilities.formatDate(parsedDate, tz, 'HH:mm');

  return {
    valid: true,
    isoString: isoFormatted,
    dateString: dateString,
    timeString: timeString,
    dateObj: parsedDate
  };
}

/**
 * Checks whether a pending action item's deadline is overdue relative to current time.
 * @param {string} deadlineIso Normalized ISO deadline string.
 * @param {Date=} referenceNow Optional current Date for testing.
 * @return {boolean} True if deadline is valid and in the past.
 */
function isDeadlineOverdue(deadlineIso, referenceNow) {
  if (!deadlineIso || String(deadlineIso).indexOf('UNCERTAIN') !== -1) {
    return false;
  }
  const d = new Date(deadlineIso);
  if (isNaN(d.getTime())) return false;
  const now = referenceNow || new Date();
  return d.getTime() < now.getTime();
}
