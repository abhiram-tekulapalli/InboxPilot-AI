/**
 * ============================================================================
 * InboxPilot AI — SenderIntelligence.gs
 * Sender Group Identification, Manual Rules Precedence, and Organization Lookup
 * ============================================================================
 *
 * Security Note:
 * Never treat a sender as verified merely because the display name resembles a
 * known university, recruiter, or bank. Classification is based on actual email
 * address, domain, and explicit user rules in the "Sender Rules" sheet.
 */

const KNOWN_DOMAIN_PATTERNS = {
  GITHUB_DEV: [
    'github.com', 'gitlab.com', 'bitbucket.org', 'vercel.com', 'netlify.com',
    'npmjs.com', 'docker.com', 'cloudflare.com', 'digitalocean.com', 'render.com',
    'heroku.com', 'jetbrains.com', 'stackoverflow.email', 'leetcode.com', 'hackerrank.com'
  ],
  RECRUITER_PLATFORMS: [
    'linkedin.com', 'naukri.com', 'internshala.com', 'wellfound.com', 'instahyre.com',
    'greenhouse.io', 'lever.co', 'workday.com', 'myworkdayjobs.com', 'ashbyhq.com',
    'smartrecruiters.com', 'superset.com', 'joinhandshake.com', 'unstop.com'
  ],
  BANKING_FINANCE: [
    'hdfcbank.net', 'hdfcbank.com', 'icicibank.com', 'sbi.co.in', 'axisbank.com',
    'kotak.com', 'yesbank.in', 'paytm.com', 'phonepe.com', 'razorpay.com',
    'stripe.com', 'paypal.com', 'zerodha.com', 'groww.in', 'nsdl.co.in', 'cdslindia.com'
  ],
  PERSONAL_PROVIDERS: [
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
    'yahoo.com', 'yahoo.co.in', 'icloud.com', 'proton.me', 'protonmail.com'
  ]
};

/**
 * Evaluates a sender against manual Sender Rules, known domain intelligence, and AI suggestion.
 * Exact email-address rules in "Sender Rules" take strict precedence over domain rules.
 *
 * @param {Object} emailObj Preprocessed email object ({ senderName, senderEmail, senderDomain, subject }).
 * @param {Array<Object>} senderRules Active rules from the "Sender Rules" sheet.
 * @return {Object} {
 *   senderGroup: string|null,
 *   forcedPriority: string|null,
 *   forcedCategory: string|null,
 *   organization: string,
 *   matchedRuleType: string|null,
 *   spoofWarning: string|null
 * }
 */
function evaluateSenderIntelligence(emailObj, senderRules) {
  const email = String(emailObj.senderEmail || '').toLowerCase().trim();
  const domain = String(emailObj.senderDomain || '').toLowerCase().trim();
  const displayName = String(emailObj.senderName || '').trim();

  let matchedRule = null;
  let matchedRuleType = null;

  if (senderRules && senderRules.length > 0) {
    // Pass 1: Exact Email Match (highest precedence)
    for (let i = 0; i < senderRules.length; i++) {
      const rule = senderRules[i];
      if (!rule || !rule.active) continue;
      if (rule.matchType === 'EMAIL' && rule.pattern === email) {
        matchedRule = rule;
        matchedRuleType = 'EXACT_EMAIL_RULE';
        break;
      }
    }

    // Pass 2: Domain Match (exact domain or subdomain match)
    if (!matchedRule) {
      for (let j = 0; j < senderRules.length; j++) {
        const rule = senderRules[j];
        if (!rule || !rule.active) continue;
        if (rule.matchType === 'DOMAIN') {
          const ruleDomain = rule.pattern.replace(/^@/, '');
          if (domain === ruleDomain || domain.endsWith('.' + ruleDomain)) {
            matchedRule = rule;
            matchedRuleType = 'DOMAIN_RULE';
            break;
          }
        }
      }
    }
  }

  // Detect potential display-name spoofing (e.g. Display name says "HDFC Bank" or "University Exam Cell" from a free personal email address)
  const spoofWarning = detectDisplayNameSpoofing(displayName, email, domain);

  if (matchedRule) {
    return {
      senderGroup: validateSenderGroup(matchedRule.senderGroup),
      forcedPriority: matchedRule.forcedPriority ? validatePriorityLevel(matchedRule.forcedPriority) : null,
      forcedCategory: matchedRule.forcedCategory ? validateCategoryName(matchedRule.forcedCategory) : null,
      organization: matchedRule.organization || inferOrganizationFromDomain(domain, displayName),
      matchedRuleType: matchedRuleType,
      spoofWarning: spoofWarning
    };
  }

  // Heuristic domain classification fallback
  const heuristicGroup = inferSenderGroupByDomain(email, domain);
  const organization = inferOrganizationFromDomain(domain, displayName);

  return {
    senderGroup: heuristicGroup, // May be null if ambiguous, allowing Gemini to classify
    forcedPriority: null,
    forcedCategory: null,
    organization: organization,
    matchedRuleType: heuristicGroup ? 'DOMAIN_HEURISTIC' : null,
    spoofWarning: spoofWarning
  };
}

/**
 * Infers a Sender Group based on institutional TLD or well-known platform domains.
 * @param {string} email Sender email address.
 * @param {string} domain Sender domain.
 * @return {string|null} Sender group or null if uncertain.
 */
function inferSenderGroupByDomain(email, domain) {
  if (!domain) return null;

  // Academic / University domains
  if (
    domain.endsWith('.edu') ||
    domain.endsWith('.ac.in') ||
    domain.endsWith('.edu.in') ||
    domain.endsWith('.ac.uk') ||
    domain.endsWith('.edu.au')
  ) {
    return 'University / College';
  }

  // Government domains
  if (
    domain.endsWith('.gov') ||
    domain.endsWith('.gov.in') ||
    domain.endsWith('.nic.in') ||
    domain.endsWith('.mil')
  ) {
    return 'Government';
  }

  // GitHub & Developer tools
  if (matchesDomainList(domain, KNOWN_DOMAIN_PATTERNS.GITHUB_DEV)) {
    return 'GitHub / Developer Platform';
  }

  // Recruiter & Career platforms
  if (matchesDomainList(domain, KNOWN_DOMAIN_PATTERNS.RECRUITER_PLATFORMS)) {
    return 'Recruiter / Employer';
  }

  // Banking & Finance
  if (matchesDomainList(domain, KNOWN_DOMAIN_PATTERNS.BANKING_FINANCE)) {
    return 'Banking / Finance';
  }

  // Newsletter / Marketing address prefixes
  const localPart = email.split('@')[0] || '';
  if (
    localPart.indexOf('newsletter') !== -1 ||
    localPart.indexOf('marketing') !== -1 ||
    localPart.indexOf('promo') !== -1 ||
    localPart.indexOf('offers') !== -1 ||
    localPart.indexOf('digest') !== -1
  ) {
    return 'Newsletter / Marketing';
  }

  return null;
}

/**
 * Checks whether a domain matches or is a subdomain of any domain in a list.
 * @param {string} domain Sender domain.
 * @param {Array<string>} domainList List of known root domains.
 * @return {boolean} True if matched.
 */
function matchesDomainList(domain, domainList) {
  for (let i = 0; i < domainList.length; i++) {
    const target = domainList[i];
    if (domain === target || domain.endsWith('.' + target)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a sender display name claims to be an official institution/bank/recruiter
 * while sending from a generic free webmail domain or suspicious unverified domain.
 *
 * @param {string} displayName Sender display name.
 * @param {string} email Sender email.
 * @param {string} domain Sender domain.
 * @return {string|null} Warning message if suspicious, or null.
 */
function detectDisplayNameSpoofing(displayName, email, domain) {
  if (!displayName || !domain) return null;
  const lowerName = displayName.toLowerCase();
  const isFreeMail = matchesDomainList(domain, KNOWN_DOMAIN_PATTERNS.PERSONAL_PROVIDERS);

  const highRiskClaims = [
    'bank', 'hdfc', 'icici', 'sbi', 'axis', 'paypal', 'razorpay', 'income tax',
    'government', 'ministry', 'github security', 'google security', 'microsoft account',
    'examination cell', 'registrar', 'controller of examinations'
  ];

  if (isFreeMail) {
    for (let i = 0; i < highRiskClaims.length; i++) {
      if (lowerName.indexOf(highRiskClaims[i]) !== -1) {
        return 'Display name "' + displayName + '" claims institutional/official identity "' +
          highRiskClaims[i] + '" but uses free webmail domain (' + domain + '). Treat as unverified.';
      }
    }
  }

  // Also check if display name embeds a different email address than the actual address
  const embeddedEmailMatch = displayName.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (embeddedEmailMatch && embeddedEmailMatch[1].toLowerCase() !== email) {
    return 'Display name contains a different email address (' + embeddedEmailMatch[1] + ') than actual sender (' + email + ').';
  }

  return null;
}

/**
 * Infers a human-readable organization name from a sender domain.
 * @param {string} domain Sender domain.
 * @param {string} displayName Sender display name.
 * @return {string} Organization name.
 */
function inferOrganizationFromDomain(domain, displayName) {
  if (!domain || domain === 'unknown.invalid') return 'Unknown';
  if (matchesDomainList(domain, KNOWN_DOMAIN_PATTERNS.PERSONAL_PROVIDERS)) {
    return 'Personal (' + domain + ')';
  }

  const parts = domain.split('.');
  if (parts.length >= 2) {
    // Strip common subdomains like mail, notifications, noreply, alerts, em
    const filtered = parts.filter(function(p) {
      return ['mail', 'email', 'notifications', 'notify', 'alerts', 'alert', 'info', 'news', 'em', ' bounce'].indexOf(p) === -1;
    });
    const core = filtered.length >= 2 ? filtered[0] : parts[0];
    return core.charAt(0).toUpperCase() + core.slice(1);
  }
  return domain;
}

/**
 * Validates that a sender group matches one of the 8 allowed SENDER_GROUPS.
 * @param {string} group Candidate sender group.
 * @return {string} Validated sender group.
 */
function validateSenderGroup(group) {
  if (!group) return 'Services / Other';
  const normalized = String(group).trim();
  if (SENDER_GROUPS.indexOf(normalized) !== -1) {
    return normalized;
  }
  const lower = normalized.toLowerCase();
  if (lower.indexOf('univ') !== -1 || lower.indexOf('college') !== -1) return 'University / College';
  if (lower.indexOf('recruit') !== -1 || lower.indexOf('employ') !== -1) return 'Recruiter / Employer';
  if (lower.indexOf('github') !== -1 || lower.indexOf('dev') !== -1) return 'GitHub / Developer Platform';
  if (lower.indexOf('bank') !== -1 || lower.indexOf('finan') !== -1) return 'Banking / Finance';
  if (lower.indexOf('gov') !== -1) return 'Government';
  if (lower.indexOf('person') !== -1) return 'Personal Contact';
  if (lower.indexOf('news') !== -1 || lower.indexOf('market') !== -1) return 'Newsletter / Marketing';
  return 'Services / Other';
}
