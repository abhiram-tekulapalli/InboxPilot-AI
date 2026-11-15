/**
 * ============================================================================
 * InboxPilot AI — Utils.gs
 * Utility Functions for Date/Time, HTML Stripping, Base64URL, Sanitization
 * ============================================================================
 */

/**
 * Formats a Date object or timestamp in the configured timezone (default Asia/Kolkata).
 * @param {Date|number|string} dateInput Date or timestamp.
 * @param {string=} pattern SimpleDateFormat pattern.
 * @return {string} Formatted date string.
 */
function formatDateInTimezone(dateInput, pattern) {
  const config = getAppConfig();
  const tz = config.timezone || DEFAULT_CONFIG.TIMEZONE;
  const dateObj = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(dateObj.getTime())) {
    return '';
  }
  const fmt = pattern || 'yyyy-MM-dd HH:mm:ss';
  return Utilities.formatDate(dateObj, tz, fmt);
}

/**
 * Returns the current date string (yyyy-MM-dd) in Asia/Kolkata (or configured timezone).
 * @param {Date=} dateOpt Optional date object.
 * @return {string} Date string in yyyy-MM-dd format.
 */
function getCalendarDateString(dateOpt) {
  return formatDateInTimezone(dateOpt || new Date(), 'yyyy-MM-dd');
}

/**
 * Decodes a Base64URL encoded string (used by Gmail API message payloads) into UTF-8 text.
 * @param {string} base64UrlString Base64URL encoded string.
 * @return {string} Decoded UTF-8 string.
 */
function decodeBase64Url(base64UrlString) {
  if (!base64UrlString) return '';
  try {
    let normalized = base64UrlString.replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4 !== 0) {
      normalized += '=';
    }
    const bytes = Utilities.base64Decode(normalized);
    return Utilities.newBlob(bytes).getDataAsString('UTF-8');
  } catch (e) {
    try {
      const bytes = Utilities.base64DecodeWebSafe(base64UrlString);
      return Utilities.newBlob(bytes).getDataAsString('UTF-8');
    } catch (innerErr) {
      return '';
    }
  }
}

/**
 * Converts HTML email content into clean readable plain text.
 * Removes script/style tags, preserves line breaks, decodes common entities.
 * @param {string} html Raw HTML string.
 * @return {string} Clean plain text.
 */
function stripHtmlToText(html) {
  if (!html) return '';
  let text = String(html);

  // Remove head, script, style, xml, and comment blocks
  text = text.replace(/<head[\s\S]*?<\/head>/gi, ' ');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');

  // Replace structural tags with newlines
  text = text.replace(/<\/(p|div|tr|li|h[1-6]|blockquote|section|article)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Extract hrefs from links if useful
  text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, function(_, url, label) {
    const cleanLabel = label.replace(/<[^>]+>/g, '').trim();
    if (!cleanLabel || cleanLabel === url) return url;
    if (url.indexOf('mailto:') === 0) return cleanLabel;
    return cleanLabel + ' (' + url + ')';
  });

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode standard HTML entities
  const entities = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&ndash;': '-',
    '&mdash;': '—',
    '&bull;': '•',
    '&copy;': '(c)',
    '&reg;': '(R)'
  };
  Object.keys(entities).forEach(function(entity) {
    text = text.split(entity).join(entities[entity]);
  });

  // Decode numeric entities
  text = text.replace(/&#(\d+);/g, function(_, dec) {
    return String.fromCharCode(parseInt(dec, 10));
  });
  text = text.replace(/&#x([0-9a-fA-F]+);/g, function(_, hex) {
    return String.fromCharCode(parseInt(hex, 16));
  });

  // Collapse excessive whitespace and blank lines
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/\n\s*\n\s*\n+/g, '\n\n');

  return text.trim();
}

/**
 * Truncates and sanitizes untrusted email body text before sending to Gemini.
 * Strips null bytes and limits length to configured MAX_BODY_CHARACTERS.
 * @param {string} rawBody Extracted plain text email body.
 * @param {number=} maxChars Optional override for max character limit.
 * @return {string} Sanitized, bounded email body string.
 */
function sanitizeAndTruncateEmailBody(rawBody, maxChars) {
  if (!rawBody) return '[No readable text body]';
  const config = getAppConfig();
  const limit = maxChars || config.maxBodyCharacters || DEFAULT_CONFIG.MAX_BODY_CHARACTERS;

  let cleaned = String(rawBody)
    .replace(/\u0000/g, '')
    .trim();

  if (cleaned.length === 0) {
    return '[No readable text body]';
  }

  if (cleaned.length > limit) {
    cleaned = cleaned.substring(0, limit) + '\n...[TRUNCATED AT ' + limit + ' CHARACTERS]';
  }

  return cleaned;
}

/**
 * Parses a raw RFC 2822 "From" header into sender name, email address, and domain.
 * Examples:
 *   "Placement Cell <placements@iitb.ac.in>" -> { name: "Placement Cell", email: "placements@iitb.ac.in", domain: "iitb.ac.in" }
 *   "alerts@hdfcbank.net" -> { name: "alerts", email: "alerts@hdfcbank.net", domain: "hdfcbank.net" }
 * @param {string} rawFromHeader Raw From header string.
 * @return {Object} { name: string, email: string, domain: string }
 */
function parseSenderHeader(rawFromHeader) {
  if (!rawFromHeader) {
    return { name: 'Unknown Sender', email: 'unknown@unknown.invalid', domain: 'unknown.invalid' };
  }

  const raw = String(rawFromHeader).trim();
  let name = '';
  let email = '';

  const angleMatch = raw.match(/^(.*?)<([^<>]+@[^<>]+)>$/);
  if (angleMatch) {
    name = angleMatch[1].trim().replace(/^["']|["']$/g, '').trim();
    email = angleMatch[2].trim().toLowerCase();
  } else {
    const emailMatch = raw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      email = emailMatch[1].trim().toLowerCase();
      name = raw.replace(emailMatch[0], '').replace(/[<>()"']/g, '').trim();
    } else {
      name = raw;
      email = 'unknown@unknown.invalid';
    }
  }

  if (!name && email && email !== 'unknown@unknown.invalid') {
    name = email.split('@')[0];
  }

  let domain = 'unknown.invalid';
  const atIndex = email.lastIndexOf('@');
  if (atIndex !== -1 && atIndex < email.length - 1) {
    domain = email.substring(atIndex + 1).toLowerCase().trim();
  }

  return {
    name: name || 'Unknown Sender',
    email: email || 'unknown@unknown.invalid',
    domain: domain
  };
}

/**
 * Builds a direct clickable Gmail message web URL for a given Gmail message ID.
 * @param {string} messageId Gmail Message ID.
 * @return {string} Direct URL to view the email in Gmail.
 */
function buildGmailMessageLink(messageId) {
  if (!messageId) return 'https://mail.google.com/mail/u/0/#inbox';
  return 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(String(messageId).trim());
}

/**
 * Escapes special characters for Telegram HTML parse_mode.
 * @param {string} text Input string.
 * @return {string} HTML-escaped string safe for Telegram HTML mode.
 */
function escapeTelegramHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Safely parses JSON from an AI response string, stripping optional markdown code fences.
 * @param {string} rawText Raw response text.
 * @return {Object|null} Parsed JSON object or null if invalid.
 */
function safeParseJson(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  let cleaned = rawText.trim();

  // Strip ```json ... ``` fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Attempt to extract the first {...} JSON object block
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
      } catch (innerErr) {
        return null;
      }
    }
    return null;
  }
}

/**
 * Checks if the current execution has exceeded the safe runtime threshold.
 * @param {number} startTimeMs Execution start timestamp in ms.
 * @return {boolean} True if execution should stop gracefully to avoid timeout.
 */
function isExecutionTimeExceeded(startTimeMs) {
  const config = getAppConfig();
  const elapsed = Date.now() - startTimeMs;
  return elapsed >= (config.maxExecutionTimeMs || DEFAULT_CONFIG.MAX_EXECUTION_TIME_MS);
}
