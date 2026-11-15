/**
 * ============================================================================
 * InboxPilot AI — TelegramService.gs
 * Telegram Bot API Integration (Immediate Critical Alerts, Digest, Splitting)
 * ============================================================================
 *
 * Uses Script Properties:
 * - TELEGRAM_BOT_TOKEN
 * - TELEGRAM_CHAT_ID
 *
 * Reliability & Safety:
 * - Never marks an alert as SENT unless Telegram API confirms HTTP 200 & ok:true.
 * - Splits messages exceeding Telegram's 4096-character limit into numbered parts.
 * - Honors DRY_RUN mode so tests do not spam real notifications unless requested.
 */

const TELEGRAM_MAX_MESSAGE_LENGTH = 3900; // Safe margin below Telegram's hard 4096-char limit

/**
 * Tests Telegram Bot connectivity using the getMe endpoint.
 * @return {Object} { ok: boolean, botUsername: string, botId: string, error: string|null }
 */
function testTelegramConnectivity() {
  const config = getAppConfig();
  if (!config.telegramBotToken) {
    return {
      ok: false,
      botUsername: '',
      botId: '',
      error: 'TELEGRAM_BOT_TOKEN is not configured in Script Properties.'
    };
  }

  const url = 'https://api.telegram.org/bot' + encodeURIComponent(config.telegramBotToken) + '/getMe';
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    const body = safeParseJson(response.getContentText());

    if (status === 200 && body && body.ok && body.result) {
      return {
        ok: true,
        botUsername: body.result.username || '',
        botId: String(body.result.id || ''),
        error: null
      };
    }

    return {
      ok: false,
      botUsername: '',
      botId: '',
      error: 'Telegram API error (HTTP ' + status + '): ' + (body && body.description ? body.description : response.getContentText())
    };
  } catch (e) {
    return {
      ok: false,
      botUsername: '',
      botId: '',
      error: e && e.message ? e.message : String(e)
    };
  }
}

/**
 * Retrieves the user's Telegram Chat ID after they send /start or any message to the bot.
 * Automatically saves TELEGRAM_CHAT_ID in Script Properties if found.
 *
 * @return {Object} { ok: boolean, chatId: string, username: string, firstName: string, message: string }
 */
function retrieveTelegramChatId() {
  const config = getAppConfig();
  if (!config.telegramBotToken) {
    return {
      ok: false,
      chatId: '',
      username: '',
      firstName: '',
      message: 'Missing TELEGRAM_BOT_TOKEN in Script Properties.'
    };
  }

  const url = 'https://api.telegram.org/bot' + encodeURIComponent(config.telegramBotToken) + '/getUpdates?limit=20';
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true
    });
    const body = safeParseJson(response.getContentText());
    if (!body || !body.ok || !body.result || body.result.length === 0) {
      return {
        ok: false,
        chatId: '',
        username: '',
        firstName: '',
        message: 'No recent messages found. Open your Telegram bot, click Start (or send "Hello"), and run this function again.'
      };
    }

    // Inspect the most recent update containing a message with a chat object
    for (let i = body.result.length - 1; i >= 0; i--) {
      const update = body.result[i];
      const msg = update.message || update.edited_message || (update.my_chat_member && update.my_chat_member.chat ? { chat: update.my_chat_member.chat } : null);
      if (msg && msg.chat && msg.chat.id) {
        const chatId = String(msg.chat.id);
        PropertiesService.getScriptProperties().setProperty(CONFIG_KEYS.TELEGRAM_CHAT_ID, chatId);
        return {
          ok: true,
          chatId: chatId,
          username: msg.chat.username || '',
          firstName: msg.chat.first_name || '',
          message: 'Successfully retrieved and saved TELEGRAM_CHAT_ID: ' + chatId
        };
      }
    }

    return {
      ok: false,
      chatId: '',
      username: '',
      firstName: '',
      message: 'Updates existed but no chat ID could be extracted. Send a direct text message to your bot first.'
    };
  } catch (e) {
    return {
      ok: false,
      chatId: '',
      username: '',
      firstName: '',
      message: 'Error calling getUpdates: ' + (e && e.message ? e.message : String(e))
    };
  }
}

/**
 * Sends a test message to the configured Telegram chat.
 * @return {Object} { ok: boolean, error: string|null }
 */
function sendTestTelegramMessage() {
  const config = getAppConfig();
  const timestamp = formatDateInTimezone(new Date(), 'yyyy-MM-dd HH:mm:ss');
  const html = [
    '<b>✅ InboxPilot AI — Telegram Test Successful</b>',
    '',
    '<b>Timestamp:</b> ' + escapeTelegramHtml(timestamp + ' (' + config.timezone + ')'),
    '<b>Gemini Model:</b> ' + escapeTelegramHtml(config.geminiModel),
    '<b>Daily Digest Time:</b> ' + escapeTelegramHtml(config.digestTime),
    '<b>Dry Run Mode:</b> ' + (config.dryRun ? 'ENABLED' : 'DISABLED'),
    '',
    'Your 24/7 autonomous email agent is connected and ready to deliver immediate critical alerts and daily digests.'
  ].join('\n');

  return sendTelegramHtmlMessage(html, { bypassDryRun: true });
}

/**
 * Formats and sends an immediate Critical (or High, if configured) email alert via Telegram.
 *
 * @param {Object} emailRecord Classified email record.
 * @return {Object} { ok: boolean, dryRunSkipped: boolean, sentTimestamp: string, error: string|null }
 */
function sendImmediateCriticalEmailAlert(emailRecord) {
  const config = getAppConfig();
  if (config.dryRun) {
    return {
      ok: true,
      dryRunSkipped: true,
      sentTimestamp: formatDateInTimezone(new Date(), 'yyyy-MM-dd HH:mm:ss'),
      error: null
    };
  }

  const headerTitle = emailRecord.priority === PRIORITY_LEVELS.CRITICAL
    ? '🚨 <b>CRITICAL EMAIL ALERT</b>'
    : '⚠️ <b>HIGH PRIORITY EMAIL ALERT</b>';

  const senderDisplay = emailRecord.senderName
    ? emailRecord.senderName + ' (' + emailRecord.senderEmail + ')'
    : emailRecord.senderEmail;

  const actionLine = emailRecord.actionRequired === 'YES' && emailRecord.actionDescription
    ? emailRecord.actionDescription
    : 'Review email immediately.';

  const deadlineLine = emailRecord.deadlineText
    ? emailRecord.deadlineText + (emailRecord.deadlineISO && emailRecord.deadlineISO.indexOf('UNCERTAIN') === -1 ? ' (' + emailRecord.deadlineISO + ')' : '')
    : (emailRecord.deadlineISO || 'None specified');

  const lines = [
    headerTitle,
    '',
    '<b>Sender:</b> ' + escapeTelegramHtml(senderDisplay),
    '<b>Subject:</b> ' + escapeTelegramHtml(emailRecord.subject || '(No Subject)'),
    '<b>Priority:</b> ' + escapeTelegramHtml(emailRecord.priority),
    '<b>Category:</b> ' + escapeTelegramHtml(emailRecord.primaryCategory || 'Other'),
    '',
    '<b>Summary:</b>',
    escapeTelegramHtml(emailRecord.summary || ''),
    ''
  ];

  if (emailRecord.criticalReason) {
    lines.push('<b>Why Critical:</b>');
    lines.push(escapeTelegramHtml(emailRecord.criticalReason));
    lines.push('');
  }

  lines.push('<b>Action Required:</b>');
  lines.push(escapeTelegramHtml(actionLine));
  lines.push('');
  lines.push('<b>Deadline:</b>');
  lines.push(escapeTelegramHtml(deadlineLine));
  lines.push('');
  lines.push('<b>Open Email:</b>');
  lines.push('<a href="' + escapeTelegramHtml(emailRecord.gmailLink || buildGmailMessageLink(emailRecord.messageId)) + '">View in Gmail</a>');

  const messageHtml = lines.join('\n');
  const sendRes = sendTelegramHtmlMessage(messageHtml);

  return {
    ok: sendRes.ok,
    dryRunSkipped: false,
    sentTimestamp: sendRes.ok ? formatDateInTimezone(new Date(), 'yyyy-MM-dd HH:mm:ss') : '',
    error: sendRes.error
  };
}

/**
 * Sends a potentially long HTML message to Telegram, automatically splitting it
 * into properly numbered sequential messages if it exceeds Telegram's size limit.
 *
 * @param {string} fullHtmlText Complete HTML-formatted message.
 * @param {Object=} options Optional { bypassDryRun: boolean }
 * @return {Object} { ok: boolean, partsSent: number, error: string|null }
 */
function sendTelegramHtmlMessage(fullHtmlText, options) {
  const config = getAppConfig();
  const bypassDryRun = Boolean(options && options.bypassDryRun);

  if (config.dryRun && !bypassDryRun) {
    return { ok: true, partsSent: 0, error: null };
  }

  if (!config.telegramBotToken || !config.telegramChatId) {
    return {
      ok: false,
      partsSent: 0,
      error: 'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in Script Properties.'
    };
  }

  const chunks = splitLongTelegramMessage(fullHtmlText, TELEGRAM_MAX_MESSAGE_LENGTH);
  const url = 'https://api.telegram.org/bot' + encodeURIComponent(config.telegramBotToken) + '/sendMessage';

  for (let i = 0; i < chunks.length; i++) {
    const partHeader = chunks.length > 1
      ? '<b>[Part ' + (i + 1) + '/' + chunks.length + ']</b>\n'
      : '';

    const payload = {
      chat_id: config.telegramChatId,
      text: partHeader + chunks[i],
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };

    let delivered = false;
    let lastError = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        const code = response.getResponseCode();
        const body = safeParseJson(response.getContentText());

        if (code === 200 && body && body.ok) {
          delivered = true;
          break;
        }

        lastError = 'Telegram HTTP ' + code + ': ' + (body && body.description ? body.description : response.getContentText());
        if (code >= 500 || code === 429) {
          Utilities.sleep(attempt * 1200);
        } else {
          break;
        }
      } catch (e) {
        lastError = e && e.message ? e.message : String(e);
        if (attempt < 2) Utilities.sleep(1000);
      }
    }

    if (!delivered) {
      return {
        ok: false,
        partsSent: i,
        error: lastError
      };
    }

    if (chunks.length > 1 && i < chunks.length - 1) {
      Utilities.sleep(350);
    }
  }

  return {
    ok: true,
    partsSent: chunks.length,
    error: null
  };
}

/**
 * Splits a long message along newline boundaries so no single chunk exceeds maxLen,
 * preserving HTML tags on individual lines.
 *
 * @param {string} text Input message text.
 * @param {number=} maxLen Max characters per chunk (default 3900).
 * @return {Array<string>} Array of message chunks.
 */
function splitLongTelegramMessage(text, maxLen) {
  const limit = maxLen || TELEGRAM_MAX_MESSAGE_LENGTH;
  if (!text) return [''];
  if (text.length <= limit) return [text];

  const lines = String(text).split('\n');
  const chunks = [];
  let currentChunk = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const candidate = currentChunk ? (currentChunk + '\n' + line) : line;

    if (candidate.length <= limit) {
      currentChunk = candidate;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      // If a single line is longer than limit, slice it safely
      if (line.length > limit) {
        let remaining = line;
        while (remaining.length > limit) {
          chunks.push(remaining.substring(0, limit));
          remaining = remaining.substring(limit);
        }
        currentChunk = remaining;
      } else {
        currentChunk = line;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}
