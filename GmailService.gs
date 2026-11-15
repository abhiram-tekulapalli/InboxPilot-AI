/**
 * ============================================================================
 * InboxPilot AI — GmailService.gs
 * Read-Only Gmail API Integration via Advanced Gmail Service (Gmail.Users.*)
 * ============================================================================
 *
 * OAuth Scope Required: https://www.googleapis.com/auth/gmail.readonly
 * Does NOT modify, delete, archive, send, or mark emails as read.
 */

const EXCLUDED_GMAIL_LABELS = ['SENT', 'DRAFT', 'TRASH'];
const INCLUDED_GMAIL_LABELS = ['INBOX', 'SPAM'];

/**
 * Tests read-only connectivity to the Gmail API and returns profile metadata.
 * @return {Object} { ok: boolean, emailAddress: string, historyId: string, messagesTotal: number, error: string|null }
 */
function testGmailConnectivity() {
  try {
    const profile = Gmail.Users.getProfile('me');
    return {
      ok: true,
      emailAddress: profile.emailAddress || 'me',
      historyId: String(profile.historyId || ''),
      messagesTotal: profile.messagesTotal || 0,
      error: null
    };
  } catch (e) {
    return {
      ok: false,
      emailAddress: '',
      historyId: '',
      messagesTotal: 0,
      error: e && e.message ? e.message : String(e)
    };
  }
}

/**
 * Fetches recent incoming messages from INBOX and SPAM (excluding SENT, DRAFT, TRASH).
 * Used for initial synchronization or when a Gmail historyId cursor expires (HTTP 404).
 *
 * @param {number=} maxResults Maximum number of recent messages to fetch.
 * @return {Object} { messageIds: Array<string>, latestHistoryId: string }
 */
function listRecentIncomingMessages(maxResults) {
  const config = getAppConfig();
  const limit = maxResults || config.initialSyncMaxResults || DEFAULT_CONFIG.INITIAL_SYNC_MAX_RESULTS;
  const query = '(in:inbox OR in:spam) -in:sent -in:drafts -in:trash';

  const messageIds = [];
  let pageToken = null;
  let latestHistoryId = '';

  // Also grab current profile historyId as baseline cursor
  try {
    const profile = Gmail.Users.getProfile('me');
    if (profile && profile.historyId) {
      latestHistoryId = String(profile.historyId);
    }
  } catch (profileErr) {
    // Continue and derive historyId from messages if needed
  }

  do {
    const requestParams = {
      q: query,
      includeSpamTrash: true,
      maxResults: Math.min(limit - messageIds.length, 100)
    };
    if (pageToken) {
      requestParams.pageToken = pageToken;
    }

    const response = Gmail.Users.Messages.list('me', requestParams);
    if (response && response.messages && response.messages.length > 0) {
      for (let i = 0; i < response.messages.length; i++) {
        const msg = response.messages[i];
        if (msg && msg.id) {
          messageIds.push(String(msg.id));
        }
        if (messageIds.length >= limit) {
          break;
        }
      }
    }

    pageToken = response && response.nextPageToken ? response.nextPageToken : null;
  } while (pageToken && messageIds.length < limit);

  // Reverse so oldest of the recent batch is queued first (chronological order)
  messageIds.reverse();

  return {
    messageIds: messageIds,
    latestHistoryId: latestHistoryId
  };
}

/**
 * Uses the Gmail History API (Gmail.Users.History.list) to incrementally fetch
 * newly added message IDs since startHistoryId, handling pagination and cursor expiration.
 *
 * @param {string} startHistoryId Stored Gmail history cursor.
 * @return {Object} { messageIds: Array<string>, latestHistoryId: string, cursorExpired: boolean }
 */
function listIncrementalHistoryMessages(startHistoryId) {
  if (!startHistoryId) {
    return {
      messageIds: [],
      latestHistoryId: '',
      cursorExpired: true
    };
  }

  const seenIds = {};
  const orderedIds = [];
  let pageToken = null;
  let latestHistoryId = String(startHistoryId);

  try {
    do {
      const params = {
        startHistoryId: String(startHistoryId),
        historyTypes: ['messageAdded'],
        maxResults: 100
      };
      if (pageToken) {
        params.pageToken = pageToken;
      }

      const historyResponse = Gmail.Users.History.list('me', params);
      if (historyResponse && historyResponse.historyId) {
        latestHistoryId = String(historyResponse.historyId);
      }

      if (historyResponse && historyResponse.history && historyResponse.history.length > 0) {
        for (let i = 0; i < historyResponse.history.length; i++) {
          const record = historyResponse.history[i];
          if (record.id && compareHistoryIds(String(record.id), latestHistoryId) > 0) {
            latestHistoryId = String(record.id);
          }

          if (record.messagesAdded && record.messagesAdded.length > 0) {
            for (let j = 0; j < record.messagesAdded.length; j++) {
              const addedItem = record.messagesAdded[j];
              const msg = addedItem && addedItem.message ? addedItem.message : null;
              if (!msg || !msg.id) continue;

              const labels = msg.labelIds || [];
              if (isRelevantIncomingLabelSet(labels)) {
                const msgId = String(msg.id);
                if (!seenIds[msgId]) {
                  seenIds[msgId] = true;
                  orderedIds.push(msgId);
                }
              }
            }
          }
        }
      }

      pageToken = historyResponse && historyResponse.nextPageToken ? historyResponse.nextPageToken : null;
    } while (pageToken);

    return {
      messageIds: orderedIds,
      latestHistoryId: latestHistoryId,
      cursorExpired: false
    };
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err);
    // Gmail History API returns HTTP 404 (Not Found) or 400 when startHistoryId is too old/invalid
    if (errMsg.indexOf('404') !== -1 || errMsg.indexOf('Not Found') !== -1 || errMsg.indexOf('startHistoryId') !== -1) {
      return {
        messageIds: [],
        latestHistoryId: '',
        cursorExpired: true
      };
    }
    throw err;
  }
}

/**
 * Compares two numeric historyId strings safely without 53-bit float precision loss.
 * @param {string} a First historyId.
 * @param {string} b Second historyId.
 * @return {number} 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareHistoryIds(a, b) {
  const cleanA = String(a || '').replace(/\D/g, '');
  const cleanB = String(b || '').replace(/\D/g, '');
  if (cleanA.length !== cleanB.length) {
    return cleanA.length > cleanB.length ? 1 : -1;
  }
  if (cleanA === cleanB) return 0;
  return cleanA > cleanB ? 1 : -1;
}

/**
 * Determines whether a Gmail message's labelIds qualify it as an incoming Inbox or Spam email,
 * excluding SENT, DRAFT, and TRASH messages.
 * Note: In History.list, labelIds might occasionally be omitted on brief stubs; if labels are
 * empty here, full message inspection will filter it later.
 *
 * @param {Array<string>} labelIds Array of Gmail label IDs.
 * @param {boolean=} requireExplicitInboxOrSpam True when inspecting a full message resource.
 * @return {boolean} True if eligible for processing.
 */
function isRelevantIncomingLabelSet(labelIds, requireExplicitInboxOrSpam) {
  if (!labelIds || labelIds.length === 0) {
    return !requireExplicitInboxOrSpam;
  }

  for (let i = 0; i < EXCLUDED_GMAIL_LABELS.length; i++) {
    if (labelIds.indexOf(EXCLUDED_GMAIL_LABELS[i]) !== -1) {
      return false;
    }
  }

  for (let j = 0; j < INCLUDED_GMAIL_LABELS.length; j++) {
    if (labelIds.indexOf(INCLUDED_GMAIL_LABELS[j]) !== -1) {
      return true;
    }
  }

  return false;
}

/**
 * Fetches and parses a single Gmail message by ID using Gmail.Users.Messages.get.
 * Extracts headers, plain/HTML body (ignoring attachments in v1), spam status, and timestamps.
 *
 * @param {string} messageId Gmail message ID.
 * @return {Object|null} Parsed email object, or { skippedIrrelevant: true } if sent/draft/trash, or null if not found.
 */
function fetchAndPreprocessEmail(messageId) {
  if (!messageId) return null;

  let rawMessage;
  try {
    rawMessage = Gmail.Users.Messages.get('me', String(messageId), { format: 'full' });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (msg.indexOf('404') !== -1 || msg.indexOf('Not Found') !== -1) {
      return null;
    }
    throw err;
  }

  if (!rawMessage || !rawMessage.id) return null;

  const labelIds = rawMessage.labelIds || [];
  if (!isRelevantIncomingLabelSet(labelIds, true)) {
    return {
      id: String(rawMessage.id),
      skippedIrrelevant: true,
      reason: 'Message belongs to SENT/DRAFT/TRASH or is not in INBOX/SPAM'
    };
  }

  const isSpam = labelIds.indexOf('SPAM') !== -1;
  const headersMap = extractHeadersMap(rawMessage.payload ? rawMessage.payload.headers : []);

  const fromHeader = headersMap['from'] || '';
  const subject = (headersMap['subject'] || '(No Subject)').trim();
  const parsedSender = parseSenderHeader(fromHeader);

  const internalDateMs = parseInt(rawMessage.internalDate, 10) || Date.now();
  const receivedDateObj = new Date(internalDateMs);

  const extractedBodies = { plain: [], html: [] };
  if (rawMessage.payload) {
    extractMimePartsRecursive(rawMessage.payload, extractedBodies);
  }

  let bodyText = '';
  if (extractedBodies.plain.length > 0) {
    bodyText = extractedBodies.plain.join('\n\n').trim();
  }
  if (!bodyText && extractedBodies.html.length > 0) {
    bodyText = stripHtmlToText(extractedBodies.html.join('\n\n'));
  }
  if (!bodyText && rawMessage.snippet) {
    bodyText = stripHtmlToText(rawMessage.snippet);
  }

  const sanitizedBody = sanitizeAndTruncateEmailBody(bodyText);

  return {
    skippedIrrelevant: false,
    messageId: String(rawMessage.id),
    threadId: String(rawMessage.threadId || rawMessage.id),
    historyId: String(rawMessage.historyId || ''),
    receivedTimestampMs: internalDateMs,
    receivedTimestampFormatted: formatDateInTimezone(receivedDateObj, 'yyyy-MM-dd HH:mm:ss'),
    receivedDateString: getCalendarDateString(receivedDateObj),
    senderName: parsedSender.name,
    senderEmail: parsedSender.email,
    senderDomain: parsedSender.domain,
    subject: subject,
    snippet: rawMessage.snippet || '',
    body: sanitizedBody,
    isSpam: isSpam,
    labelIds: labelIds,
    gmailLink: buildGmailMessageLink(String(rawMessage.id))
  };
}

/**
 * Builds a lowercase header lookup map from Gmail payload headers.
 * @param {Array<Object>} headers Array of { name, value } objects.
 * @return {Object} Map of lowercase header name -> header value.
 */
function extractHeadersMap(headers) {
  const map = {};
  if (!headers || !headers.length) return map;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (h && h.name) {
      map[String(h.name).toLowerCase()] = h.value || '';
    }
  }
  return map;
}

/**
 * Recursively traverses MIME payload parts to collect text/plain and text/html bodies.
 * Strictly ignores attachments (parts with filenames or attachmentIds) per Version 1 security spec.
 *
 * @param {Object} part Gmail MessagePart object.
 * @param {Object} collector { plain: Array<string>, html: Array<string> }
 */
function extractMimePartsRecursive(part, collector) {
  if (!part) return;

  // Version 1 security requirement: Do NOT download or process attachments
  if (part.filename && String(part.filename).trim().length > 0) {
    return;
  }
  if (part.body && part.body.attachmentId) {
    return;
  }

  const mimeType = String(part.mimeType || '').toLowerCase();

  if (mimeType === 'text/plain' && part.body && part.body.data) {
    const decoded = decodeBase64Url(part.body.data);
    if (decoded) collector.plain.push(decoded);
  } else if (mimeType === 'text/html' && part.body && part.body.data) {
    const decoded = decodeBase64Url(part.body.data);
    if (decoded) collector.html.push(decoded);
  }

  if (part.parts && part.parts.length > 0) {
    for (let i = 0; i < part.parts.length; i++) {
      extractMimePartsRecursive(part.parts[i], collector);
    }
  }
}
