/**
 * ============================================================================
 * InboxPilot AI — SheetsService.gs
 * Google Sheets Database Engine (Schema Init, Batch Reads/Writes, Formatting)
 * ============================================================================
 *
 * Manages all 6 required sheets:
 * 1. Dashboard
 * 2. Emails (26 columns + hidden Critical Reason metadata column = 27 columns)
 * 3. Sender Directory
 * 4. Sender Rules
 * 5. Daily Reports
 * 6. Logs
 */

const EMAILS_HEADERS = [
  'Message ID',                    // Col 1  (idx 0)
  'Thread ID',                     // Col 2  (idx 1)
  'Received Timestamp',            // Col 3  (idx 2)
  'Date',                          // Col 4  (idx 3)
  'Sender Name',                   // Col 5  (idx 4)
  'Sender Email',                  // Col 6  (idx 5)
  'Sender Domain',                 // Col 7  (idx 6)
  'Sender Group',                  // Col 8  (idx 7)
  'Subject',                       // Col 9  (idx 8)
  'Email Summary',                 // Col 10 (idx 9)
  'Priority',                      // Col 11 (idx 10)
  'Primary Category',              // Col 12 (idx 11)
  'Secondary Category',            // Col 13 (idx 12)
  'Action Required',               // Col 14 (idx 13)
  'Action Description',            // Col 15 (idx 14)
  'Action Status',                 // Col 16 (idx 15)
  'Deadline Text',                 // Col 17 (idx 16)
  'Deadline ISO',                  // Col 18 (idx 17)
  'Deadline Confidence',           // Col 19 (idx 18)
  'Classification Confidence',     // Col 20 (idx 19)
  'Gmail Spam Label',              // Col 21 (idx 20)
  'Gmail Message Link',            // Col 22 (idx 21)
  'Processing Status',             // Col 23 (idx 22)
  'Critical Alert Status',         // Col 24 (idx 23)
  'Critical Alert Sent Timestamp', // Col 25 (idx 24)
  'Retry Count',                   // Col 26 (idx 25)
  'Critical Reason'                // Col 27 (idx 26)
];

const SENDER_DIRECTORY_HEADERS = [
  'Sender Email',
  'Sender Name',
  'Sender Domain',
  'Organization',
  'Sender Group',
  'Email Count',
  'Last Received Timestamp',
  'Historical Primary Category'
];

const SENDER_RULES_HEADERS = [
  'Rule Type (EMAIL or DOMAIN)',
  'Pattern (e.g. exam@univ.ac.in or univ.ac.in)',
  'Sender Group Override',
  'Forced Priority (Optional)',
  'Forced Category (Optional)',
  'Organization Name',
  'Active (TRUE/FALSE)',
  'Notes'
];

const DAILY_REPORTS_HEADERS = [
  'Date',
  'Generated Timestamp',
  'Total Emails',
  'Critical Count',
  'High Count',
  'Normal Count',
  'Low Count',
  'Spam Count',
  'Action Required Count',
  'Pending Actions Total',
  'Overdue Actions Count',
  'Telegram Delivery Status',
  'Daily AI Overview'
];

const LOGS_HEADERS = [
  'Execution Timestamp',
  'Function Name',
  'Emails Detected',
  'Emails Processed',
  'Classifications Completed',
  'Critical Alerts Sent',
  'API Failures',
  'Telegram Failures',
  'Sync Errors',
  'Retry Attempts',
  'Notes / Details'
];

/**
 * Opens and returns the configured Google Spreadsheet.
 * @return {Spreadsheet} Google Apps Script Spreadsheet instance.
 */
function getDatabaseSpreadsheet() {
  const config = getAppConfig();
  if (config.spreadsheetId) {
    return SpreadsheetApp.openById(config.spreadsheetId);
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    return active;
  }
  throw new Error('SPREADSHEET_ID is not configured in Script Properties and no active spreadsheet is bound.');
}

/**
 * Automatically creates and initializes all 6 required sheets with headers,
 * frozen rows, filters, data validation dropdowns, conditional formatting,
 * and column widths if they do not exist.
 *
 * @return {Object} { ok: boolean, spreadsheetUrl: string, initializedSheets: Array<string> }
 */
function initializeDatabaseSheets() {
  const ss = getDatabaseSpreadsheet();
  const initialized = [];

  // 1. Emails Sheet
  const emailsSheet = ensureSheetWithHeaders(ss, SHEET_NAMES.EMAILS, EMAILS_HEADERS, '#0f172a', '#ffffff');
  configureEmailsSheetFormatting(emailsSheet);
  initialized.push(SHEET_NAMES.EMAILS);

  // 2. Sender Directory Sheet
  const senderDirSheet = ensureSheetWithHeaders(ss, SHEET_NAMES.SENDER_DIRECTORY, SENDER_DIRECTORY_HEADERS, '#1e293b', '#ffffff');
  senderDirSheet.setColumnWidths(1, SENDER_DIRECTORY_HEADERS.length, 165);
  initialized.push(SHEET_NAMES.SENDER_DIRECTORY);

  // 3. Sender Rules Sheet
  const senderRulesSheet = ensureSheetWithHeaders(ss, SHEET_NAMES.SENDER_RULES, SENDER_RULES_HEADERS, '#1e293b', '#ffffff');
  configureSenderRulesSheet(senderRulesSheet);
  initialized.push(SHEET_NAMES.SENDER_RULES);

  // 4. Daily Reports Sheet
  const dailyReportsSheet = ensureSheetWithHeaders(ss, SHEET_NAMES.DAILY_REPORTS, DAILY_REPORTS_HEADERS, '#1e293b', '#ffffff');
  dailyReportsSheet.setColumnWidths(1, DAILY_REPORTS_HEADERS.length, 140);
  dailyReportsSheet.setColumnWidth(13, 420);
  initialized.push(SHEET_NAMES.DAILY_REPORTS);

  // 5. Logs Sheet
  const logsSheet = ensureSheetWithHeaders(ss, SHEET_NAMES.LOGS, LOGS_HEADERS, '#334155', '#ffffff');
  logsSheet.setColumnWidths(1, LOGS_HEADERS.length, 135);
  logsSheet.setColumnWidth(11, 360);
  initialized.push(SHEET_NAMES.LOGS);

  // 6. Dashboard Sheet (Main reporting interface, placed first)
  let dashboardSheet = ss.getSheetByName(SHEET_NAMES.DASHBOARD);
  if (!dashboardSheet) {
    dashboardSheet = ss.insertSheet(SHEET_NAMES.DASHBOARD, 0);
  }
  refreshDashboardSheet();
  initialized.push(SHEET_NAMES.DASHBOARD);

  SpreadsheetApp.flush();

  return {
    ok: true,
    spreadsheetUrl: ss.getUrl(),
    initializedSheets: initialized
  };
}

/**
 * Ensures a sheet exists with the specified header row, frozen top row, and filter.
 */
function ensureSheetWithHeaders(ss, sheetName, headers, headerBg, headerFg) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    // Ensure all header columns are up to date
    const existingHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    let needsHeaderUpdate = false;
    for (let i = 0; i < headers.length; i++) {
      if (existingHeaders[i] !== headers[i]) {
        needsHeaderUpdate = true;
        break;
      }
    }
    if (needsHeaderUpdate) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange
    .setBackground(headerBg || '#0f172a')
    .setFontColor(headerFg || '#ffffff')
    .setFontWeight('bold')
    .setVerticalAlignment('middle');

  sheet.setFrozenRows(1);

  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), headers.length).createFilter();
  }

  return sheet;
}

/**
 * Configures dropdown validations, conditional formatting for Priority levels,
 * and clean column widths on the Emails sheet.
 * @param {Sheet} sheet Emails sheet instance.
 */
function configureEmailsSheetFormatting(sheet) {
  const maxRows = Math.max(sheet.getMaxRows(), 500);

  // Set helpful column widths
  sheet.setColumnWidth(1, 145);  // Message ID
  sheet.setColumnWidth(3, 155);  // Received Timestamp
  sheet.setColumnWidth(5, 160);  // Sender Name
  sheet.setColumnWidth(6, 200);  // Sender Email
  sheet.setColumnWidth(8, 175);  // Sender Group
  sheet.setColumnWidth(9, 260);  // Subject
  sheet.setColumnWidth(10, 340); // Email Summary
  sheet.setColumnWidth(11, 105); // Priority
  sheet.setColumnWidth(12, 195); // Primary Category
  sheet.setColumnWidth(15, 260); // Action Description
  sheet.setColumnWidth(16, 130); // Action Status
  sheet.setColumnWidth(17, 160); // Deadline Text
  sheet.setColumnWidth(18, 185); // Deadline ISO
  sheet.setColumnWidth(22, 145); // Gmail Link

  // Dropdown validation for Action Status (Column 16: PENDING, COMPLETED, DISMISSED, NONE)
  const actionStatusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['PENDING', 'COMPLETED', 'DISMISSED', 'NONE'], true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(2, 16, maxRows - 1, 1).setDataValidation(actionStatusRule);

  // Conditional Formatting for Priority (Column 11)
  const priorityRange = sheet.getRange(2, 11, maxRows - 1, 1);
  const actionStatusRange = sheet.getRange(2, 16, maxRows - 1, 1);

  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('CRITICAL')
      .setBackground('#fee2e2')
      .setFontColor('#991b1b')
      .setBold(true)
      .setRanges([priorityRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('HIGH')
      .setBackground('#fef3c7')
      .setFontColor('#92400e')
      .setBold(true)
      .setRanges([priorityRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('NORMAL')
      .setBackground('#e0f2fe')
      .setFontColor('#075985')
      .setRanges([priorityRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('LOW')
      .setBackground('#f1f5f9')
      .setFontColor('#475569')
      .setRanges([priorityRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('PENDING')
      .setBackground('#fef9c3')
      .setFontColor('#854d0e')
      .setBold(true)
      .setRanges([actionStatusRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('COMPLETED')
      .setBackground('#dcfce7')
      .setFontColor('#166534')
      .setRanges([actionStatusRange])
      .build()
  ];

  sheet.setConditionalFormatRules(rules);
}

/**
 * Seeds starter examples and dropdown validations in the Sender Rules sheet if empty.
 * @param {Sheet} sheet Sender Rules sheet.
 */
function configureSenderRulesSheet(sheet) {
  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 230);
  sheet.setColumnWidth(3, 195);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 210);
  sheet.setColumnWidth(6, 170);
  sheet.setColumnWidth(7, 130);
  sheet.setColumnWidth(8, 260);

  if (sheet.getLastRow() === 1) {
    // Seed illustrative inactive example rules so the user sees exact format
    const sampleRules = [
      ['DOMAIN', 'ac.in', 'University / College', '', 'University and Academics', 'University', false, 'Example domain rule (set Active=TRUE to enable)'],
      ['EMAIL', 'placements@university.edu', 'Recruiter / Employer', 'HIGH', 'Placement and Recruitment', 'T&P Cell', false, 'Exact email rule takes precedence over domain rules']
    ];
    sheet.getRange(2, 1, sampleRules.length, SENDER_RULES_HEADERS.length).setValues(sampleRules);
  }

  const maxRows = Math.max(sheet.getMaxRows(), 100);
  const typeValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(['EMAIL', 'DOMAIN'], true)
    .build();
  const groupValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(SENDER_GROUPS, true)
    .build();

  sheet.getRange(2, 1, maxRows - 1, 1).setDataValidation(typeValidation);
  sheet.getRange(2, 3, maxRows - 1, 1).setDataValidation(groupValidation);
}

/**
 * Returns a lookup map of all existing Gmail Message IDs in the Emails sheet -> row index (1-based).
 * Uses a single batch read of Column A for speed.
 *
 * @return {Object} Map of { [messageId]: rowNumber }
 */
function getExistingMessageIdMap() {
  const ss = getDatabaseSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.EMAILS);
  if (!sheet || sheet.getLastRow() <= 1) return {};

  const numRows = sheet.getLastRow() - 1;
  const values = sheet.getRange(2, 1, numRows, 1).getValues();
  const map = {};
  for (let i = 0; i < values.length; i++) {
    const id = String(values[i][0] || '').trim();
    if (id) {
      map[id] = i + 2; // 1-based sheet row number
    }
  }
  return map;
}

/**
 * Enqueues newly discovered Gmail message IDs into the Emails sheet with status QUEUED.
 * Guarantees durable queueing before Gemini classification begins and prevents duplicates.
 *
 * @param {Array<string>} messageIds Newly detected Gmail message IDs.
 * @return {number} Count of new message IDs actually enqueued.
 */
function enqueueNewMessageIds(messageIds) {
  if (!messageIds || messageIds.length === 0) return 0;

  const ss = getDatabaseSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.EMAILS);
  if (!sheet) {
    initializeDatabaseSheets();
  }
  const targetSheet = ss.getSheetByName(SHEET_NAMES.EMAILS);
  const existingMap = getExistingMessageIdMap();

  const newRows = [];
  const seenInBatch = {};
  const nowFormatted = formatDateInTimezone(new Date(), 'yyyy-MM-dd HH:mm:ss');
  const todayDate = getCalendarDateString(new Date());

  for (let i = 0; i < messageIds.length; i++) {
    const id = String(messageIds[i] || '').trim();
    if (!id || existingMap[id] || seenInBatch[id]) continue;
    seenInBatch[id] = true;

    const linkFormula = '=HYPERLINK("' + buildGmailMessageLink(id) + '", "View in Gmail")';
    const row = new Array(EMAILS_HEADERS.length).fill('');
    row[0] = id;                              // Message ID
    row[2] = nowFormatted;                    // Received Timestamp (updated on fetch)
    row[3] = todayDate;                       // Date
    row[15] = ACTION_STATUSES.NONE;           // Action Status
    row[21] = linkFormula;                    // Gmail Message Link
    row[22] = PROCESSING_STATUSES.QUEUED;     // Processing Status
    row[23] = ALERT_STATUSES.NOT_REQUIRED;    // Critical Alert Status
    row[25] = 0;                              // Retry Count
    newRows.push(row);
  }

  if (newRows.length > 0) {
    const startRow = targetSheet.getLastRow() + 1;
    targetSheet.getRange(startRow, 1, newRows.length, EMAILS_HEADERS.length).setValues(newRows);
    SpreadsheetApp.flush();
  }

  return newRows.length;
}

/**
 * Fetches queued or retry-eligible email rows from the Emails sheet up to maxBatchSize.
 *
 * @param {number} maxBatchSize Maximum number of items to return.
 * @param {number} maxRetries Maximum allowed retries before marking permanent failure.
 * @return {Array<Object>} Array of { rowNumber: number, messageId: string, retryCount: number, status: string }
 */
function getQueuedEmailsBatch(maxBatchSize, maxRetries) {
  const ss = getDatabaseSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.EMAILS);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const numRows = sheet.getLastRow() - 1;
  const data = sheet.getRange(2, 1, numRows, EMAILS_HEADERS.length).getValues();
  const batch = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const msgId = String(row[0] || '').trim();
    const status = String(row[22] || '').trim();
    const retryCount = parseInt(row[25], 10) || 0;

    if (!msgId) continue;

    if (status === PROCESSING_STATUSES.QUEUED ||
       (status === PROCESSING_STATUSES.FAILED_RETRY && retryCount < maxRetries)) {
      batch.push({
        rowNumber: i + 2,
        messageId: msgId,
        retryCount: retryCount,
        status: status
      });
      if (batch.length >= maxBatchSize) break;
    }
  }

  return batch;
}

/**
 * Writes a completed email classification record to its specific row in the Emails sheet,
 * or inserts it if not yet present (deduplicating by Message ID).
 *
 * @param {Object} record Classified email record.
 * @param {number=} knownRowNumber Optional 1-based row number in the Emails sheet.
 * @return {number} 1-based row number where the record was stored.
 */
function saveClassifiedEmailRecord(record, knownRowNumber) {
  const ss = getDatabaseSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.EMAILS);
  let targetRow = knownRowNumber || 0;

  if (!targetRow) {
    const map = getExistingMessageIdMap();
    targetRow = map[record.messageId] || 0;
  }

  // Preserve manual Action Status if row already existed and user changed it to COMPLETED/DISMISSED
  let actionStatusToSave = record.actionStatus || ACTION_STATUSES.NONE;
  if (targetRow > 1) {
    const existingActionStatus = String(sheet.getRange(targetRow, 16).getValue() || '').trim();
    if (existingActionStatus === ACTION_STATUSES.COMPLETED || existingActionStatus === ACTION_STATUSES.DISMISSED) {
      actionStatusToSave = existingActionStatus;
    }
  }

  const linkFormula = '=HYPERLINK("' + (record.gmailLink || buildGmailMessageLink(record.messageId)) + '", "View in Gmail")';

  const rowValues = [
    String(record.messageId || ''),
    String(record.threadId || ''),
    String(record.receivedTimestamp || ''),
    String(record.date || ''),
    String(record.senderName || ''),
    String(record.senderEmail || ''),
    String(record.senderDomain || ''),
    String(record.senderGroup || ''),
    String(record.subject || ''),
    String(record.summary || ''),
    String(record.priority || PRIORITY_LEVELS.NORMAL),
    String(record.primaryCategory || 'Other'),
    String(record.secondaryCategory || ''),
    String(record.actionRequired || 'NO'),
    String(record.actionDescription || ''),
    String(actionStatusToSave),
    String(record.deadlineText || ''),
    String(record.deadlineISO || ''),
    Number(record.deadlineConfidence || 0),
    Number(record.classificationConfidence || 0),
    String(record.gmailSpamLabel || 'NO'),
    linkFormula,
    String(record.processingStatus || PROCESSING_STATUSES.CLASSIFIED),
    String(record.criticalAlertStatus || ALERT_STATUSES.NOT_REQUIRED),
    String(record.criticalAlertSentTimestamp || ''),
    Number(record.retryCount || 0),
    String(record.criticalReason || '')
  ];

  if (targetRow > 1) {
    sheet.getRange(targetRow, 1, 1, EMAILS_HEADERS.length).setValues([rowValues]);
  } else {
    targetRow = sheet.getLastRow() + 1;
    sheet.getRange(targetRow, 1, 1, EMAILS_HEADERS.length).setValues([rowValues]);
  }

  return targetRow;
}

/**
 * Updates a queued email row when classification fails or is deferred due to rate limit.
 *
 * @param {number} rowNumber 1-based row number in Emails sheet.
 * @param {number} newRetryCount Updated retry count.
 * @param {number} maxRetries Maximum allowed retries.
 * @param {string} errorSummary Brief error note.
 */
function markEmailRowFailedOrRetry(rowNumber, newRetryCount, maxRetries, errorSummary) {
  if (!rowNumber || rowNumber <= 1) return;
  const ss = getDatabaseSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.EMAILS);
  const nextStatus = newRetryCount >= maxRetries
    ? PROCESSING_STATUSES.FAILED_PERMANENT
    : PROCESSING_STATUSES.FAILED_RETRY;

  sheet.getRange(rowNumber, 23).setValue(nextStatus);
  sheet.getRange(rowNumber, 26).setValue(newRetryCount);
  if (errorSummary) {
    sheet.getRange(rowNumber, 10).setValue('[Retry Queue] ' + String(errorSummary).substring(0, 200));
  }
}

/**
 * Deletes a queued stub row ONLY if the Gmail message is confirmed to be a SENT, DRAFT, or TRASH message
 * (never deletes user emails in Gmail; only cleans up irrelevant outgoing/draft stubs from the tracking sheet).
 * @param {number} rowNumber 1-based row number.
 */
function removeIrrelevantStubRow(rowNumber) {
  if (!rowNumber || rowNumber <= 1) return;
  const ss = getDatabaseSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.EMAILS);
  sheet.deleteRow(rowNumber);
}

/**
 * Updates the Critical Alert Status and Timestamp on an Email row.
 * @param {number} rowNumber 1-based row number in Emails sheet.
 * @param {string} alertStatus New status (SENT, FAILED_RETRY, DRY_RUN_SKIPPED).
 * @param {string=} sentTimestamp Formatted timestamp when Telegram confirmed delivery.
 */
function updateEmailAlertStatus(rowNumber, alertStatus, sentTimestamp) {
  if (!rowNumber || rowNumber <= 1) return;
  const ss = getDatabaseSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.EMAILS);
  sheet.getRange(rowNumber, 24, 1, 2).setValues([[
    alertStatus,
    sentTimestamp || ''
  ]]);
}

/**
 * Finds all email records whose Critical Alert Status is PENDING or FAILED_RETRY.
 * @return {Array<Object>} List of email records requiring immediate Telegram alert delivery.
 */
function getPendingCriticalAlerts() {
  const ss = getDatabaseSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.EMAILS);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const numRows = sheet.getLastRow() - 1;
  const values = sheet.getRange(2, 1, numRows, EMAILS_HEADERS.length).getValues();
  const formulas = sheet.getRange(2, 22, numRows, 1).getFormulas();
  const pending = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const alertStatus = String(row[23] || '').trim();
    if (alertStatus === ALERT_STATUSES.PENDING || alertStatus === ALERT_STATUSES.FAILED_RETRY) {
      pending.push(rowToEmailRecordObject(row, i + 2, formulas[i][0]));
    }
  }
  return pending;
}

/**
 * Reads all active manual sender override rules from the "Sender Rules" sheet.
 * @return {Array<Object>} Array of rule objects.
 */
function getActiveSenderRules() {
  const ss = getDatabaseSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.SENDER_RULES);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, SENDER_RULES_HEADERS.length).getValues();
  const rules = [];
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    const matchType = String(r[0] || '').trim().toUpperCase();
    const pattern = String(r[1] || '').trim().toLowerCase();
    const senderGroup = String(r[2] || '').trim();
    const forcedPriority = String(r[3] || '').trim().toUpperCase();
    const forcedCategory = String(r[4] || '').trim();
    const organization = String(r[5] || '').trim();
    const active = r[6] === true || String(r[6]).toUpperCase() === 'TRUE';

    if (active && (matchType === 'EMAIL' || matchType === 'DOMAIN') && pattern) {
      rules.push({
        matchType: matchType,
        pattern: pattern,
        senderGroup: senderGroup,
        forcedPriority: forcedPriority || null,
        forcedCategory: forcedCategory || null,
        organization: organization,
        active: true
      });
    }
  }
  return rules;
}

/**
 * Batch updates the "Sender Directory" sheet with newly processed email records.
 * Increments email counts, updates last-seen timestamps, and records historical category.
 *
 * @param {Array<Object>} classifiedRecords Array of newly classified email records.
 */
function updateSenderDirectoryBatch(classifiedRecords) {
  if (!classifiedRecords || classifiedRecords.length === 0) return;

  const ss = getDatabaseSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.SENDER_DIRECTORY);
  if (!sheet) return;

  const existingRows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, SENDER_DIRECTORY_HEADERS.length).getValues()
    : [];

  const directoryMap = {};
  for (let i = 0; i < existingRows.length; i++) {
    const row = existingRows[i];
    const emailKey = String(row[0] || '').toLowerCase().trim();
    if (emailKey) {
      directoryMap[emailKey] = {
        rowIndex: i,
        data: row
      };
    }
  }

  const newRowsToAppend = [];

  for (let j = 0; j < classifiedRecords.length; j++) {
    const rec = classifiedRecords[j];
    const emailKey = String(rec.senderEmail || '').toLowerCase().trim();
    if (!emailKey) continue;

    if (directoryMap[emailKey]) {
      const entry = directoryMap[emailKey];
      const currentCount = parseInt(entry.data[5], 10) || 0;
      entry.data[1] = rec.senderName || entry.data[1];
      entry.data[2] = rec.senderDomain || entry.data[2];
      entry.data[3] = rec.senderOrganization || entry.data[3];
      entry.data[4] = rec.senderGroup || entry.data[4];
      entry.data[5] = currentCount + 1;
      entry.data[6] = rec.receivedTimestamp || entry.data[6];
      entry.data[7] = rec.primaryCategory || entry.data[7];
    } else {
      const newRow = [
        emailKey,
        rec.senderName || '',
        rec.senderDomain || '',
        rec.senderOrganization || '',
        rec.senderGroup || 'Services / Other',
        1,
        rec.receivedTimestamp || '',
        rec.primaryCategory || 'Other'
      ];
      directoryMap[emailKey] = {
        rowIndex: -1,
        data: newRow
      };
      newRowsToAppend.push(newRow);
    }
  }

  if (existingRows.length > 0) {
    sheet.getRange(2, 1, existingRows.length, SENDER_DIRECTORY_HEADERS.length).setValues(existingRows);
  }
  if (newRowsToAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRowsToAppend.length, SENDER_DIRECTORY_HEADERS.length).setValues(newRowsToAppend);
  }
}

/**
 * Reads all classified email records from the Emails sheet.
 * @return {Array<Object>} Array of structured email objects.
 */
function getAllStoredEmailRecords() {
  const ss = getDatabaseSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.EMAILS);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const numRows = sheet.getLastRow() - 1;
  const values = sheet.getRange(2, 1, numRows, EMAILS_HEADERS.length).getValues();
  const formulas = sheet.getRange(2, 22, numRows, 1).getFormulas();
  const records = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const status = String(row[22] || '').trim();
    if (status === PROCESSING_STATUSES.CLASSIFIED || status === PROCESSING_STATUSES.SPAM_SKIPPED) {
      records.push(rowToEmailRecordObject(row, i + 2, formulas[i][0]));
    }
  }
  return records;
}

/**
 * Converts a raw 27-column row array from the Emails sheet into a structured object.
 */
function rowToEmailRecordObject(row, rowNumber, linkFormula) {
  const msgId = String(row[0] || '').trim();
  let dateStr = '';
  if (row[3] instanceof Date) {
    dateStr = getCalendarDateString(row[3]);
  } else {
    dateStr = String(row[3] || '').trim().substring(0, 10);
  }

  let receivedTsStr = '';
  if (row[2] instanceof Date) {
    receivedTsStr = formatDateInTimezone(row[2], 'yyyy-MM-dd HH:mm:ss');
  } else {
    receivedTsStr = String(row[2] || '').trim();
  }

  return {
    rowNumber: rowNumber,
    messageId: msgId,
    threadId: String(row[1] || ''),
    receivedTimestamp: receivedTsStr,
    date: dateStr,
    senderName: String(row[4] || ''),
    senderEmail: String(row[5] || ''),
    senderDomain: String(row[6] || ''),
    senderGroup: String(row[7] || ''),
    subject: String(row[8] || ''),
    summary: String(row[9] || ''),
    priority: String(row[10] || PRIORITY_LEVELS.NORMAL),
    primaryCategory: String(row[11] || 'Other'),
    secondaryCategory: String(row[12] || ''),
    actionRequired: String(row[13] || 'NO'),
    actionDescription: String(row[14] || ''),
    actionStatus: String(row[15] || ACTION_STATUSES.NONE),
    deadlineText: String(row[16] || ''),
    deadlineISO: String(row[17] || ''),
    deadlineConfidence: Number(row[18] || 0),
    classificationConfidence: Number(row[19] || 0),
    gmailSpamLabel: String(row[20] || 'NO'),
    gmailLink: buildGmailMessageLink(msgId),
    linkFormula: linkFormula || '',
    processingStatus: String(row[22] || ''),
    criticalAlertStatus: String(row[23] || ''),
    criticalAlertSentTimestamp: String(row[24] || ''),
    retryCount: parseInt(row[25], 10) || 0,
    criticalReason: String(row[26] || '')
  };
}

/**
 * Appends a historical daily summary record into the "Daily Reports" sheet.
 * @param {Object} reportSummary Summary metrics and overview text.
 */
function appendDailyReportRecord(reportSummary) {
  const ss = getDatabaseSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.DAILY_REPORTS);
  if (!sheet) return;

  const row = [
    reportSummary.date,
    formatDateInTimezone(new Date(), 'yyyy-MM-dd HH:mm:ss'),
    reportSummary.total,
    reportSummary.critical,
    reportSummary.high,
    reportSummary.normal,
    reportSummary.low,
    reportSummary.spam,
    reportSummary.actionRequired,
    reportSummary.pendingActionsTotal,
    reportSummary.overdueActionsCount,
    reportSummary.deliveryStatus,
    reportSummary.overview
  ];

  sheet.appendRow(row);
}

/**
 * Appends a structured execution telemetry entry into the "Logs" sheet.
 * @param {Object} logEntry Execution metrics.
 */
function appendExecutionLog(logEntry) {
  try {
    const ss = getDatabaseSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.LOGS);
    if (!sheet) return;

    const row = [
      formatDateInTimezone(new Date(), 'yyyy-MM-dd HH:mm:ss'),
      logEntry.functionName || 'unknown',
      Number(logEntry.emailsDetected || 0),
      Number(logEntry.emailsProcessed || 0),
      Number(logEntry.classificationsCompleted || 0),
      Number(logEntry.criticalAlertsSent || 0),
      Number(logEntry.apiFailures || 0),
      Number(logEntry.telegramFailures || 0),
      Number(logEntry.syncErrors || 0),
      Number(logEntry.retryAttempts || 0),
      String(logEntry.notes || '')
    ];

    sheet.appendRow(row);
  } catch (e) {
    // Do not crash caller if logging fails
    console.error('Failed to write execution log:', e);
  }
}

/**
 * Builds or refreshes the "Dashboard" sheet with live statistics for the selected date,
 * category breakdown, sender-group breakdown, top senders, and most important emails.
 */
function refreshDashboardSheet() {
  const ss = getDatabaseSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.DASHBOARD);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.DASHBOARD, 0);
  }

  // Read existing selected date in B3 if user entered one, else default to today in IST
  let selectedDate = getCalendarDateString(new Date());
  if (sheet.getLastRow() >= 3) {
    const existingVal = sheet.getRange('B3').getValue();
    if (existingVal instanceof Date) {
      selectedDate = getCalendarDateString(existingVal);
    } else if (typeof existingVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(existingVal.trim())) {
      selectedDate = existingVal.trim();
    }
  }

  const allRecords = getAllStoredEmailRecords();
  const dateRecords = [];
  let pendingActionsCount = 0;
  let overdueActionsCount = 0;
  const now = new Date();

  const senderCounts = {};
  for (let i = 0; i < allRecords.length; i++) {
    const r = allRecords[i];
    if (r.date === selectedDate) {
      dateRecords.push(r);
    }
    if (r.actionRequired === 'YES' && r.actionStatus === ACTION_STATUSES.PENDING) {
      pendingActionsCount++;
      if (isDeadlineOverdue(r.deadlineISO, now)) {
        overdueActionsCount++;
      }
    }
    const senderKey = r.senderName ? (r.senderName + ' <' + r.senderEmail + '>') : r.senderEmail;
    if (senderKey) {
      senderCounts[senderKey] = (senderCounts[senderKey] || 0) + 1;
    }
  }

  // Compute Selected Date Metrics
  let criticalCount = 0;
  let highCount = 0;
  let normalCount = 0;
  let lowCount = 0;
  let spamCount = 0;
  let actionReqToday = 0;

  const categoryMap = {};
  for (let c = 0; c < EMAIL_CATEGORIES.length; c++) categoryMap[EMAIL_CATEGORIES[c]] = 0;

  const groupMap = {};
  for (let g = 0; g < SENDER_GROUPS.length; g++) groupMap[SENDER_GROUPS[g]] = 0;

  for (let j = 0; j < dateRecords.length; j++) {
    const rec = dateRecords[j];
    if (rec.priority === PRIORITY_LEVELS.CRITICAL) criticalCount++;
    else if (rec.priority === PRIORITY_LEVELS.HIGH) highCount++;
    else if (rec.priority === PRIORITY_LEVELS.NORMAL) normalCount++;
    else lowCount++;

    if (rec.gmailSpamLabel === 'YES') spamCount++;
    if (rec.actionRequired === 'YES') actionReqToday++;

    const cat = rec.primaryCategory || 'Other';
    categoryMap[cat] = (categoryMap[cat] || 0) + 1;

    const grp = rec.senderGroup || 'Services / Other';
    groupMap[grp] = (groupMap[grp] || 0) + 1;
  }

  sheet.clearContents();
  sheet.clearFormats();

  // Header Banner
  sheet.getRange('A1:G1').merge()
    .setValue('INBOXPILOT AI — INTELLIGENT EMAIL MANAGEMENT DASHBOARD')
    .setBackground('#0f172a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(13);

  sheet.getRange('A2:G2').merge()
    .setValue('24/7 Autonomous Gmail Monitoring • Gemini Classification • Action & Deadline Tracking • Last Refreshed: ' +
      formatDateInTimezone(new Date(), 'yyyy-MM-dd HH:mm:ss') + ' IST')
    .setBackground('#1e293b')
    .setFontColor('#cbd5e1')
    .setFontSize(10);

  sheet.getRange('A3').setValue('Selected Report Date (YYYY-MM-DD):').setFontWeight('bold');
  sheet.getRange('B3').setValue(selectedDate).setBackground('#fef9c3').setFontWeight('bold');

  // Section 1: Key Metrics (Columns A-B)
  const kpiRows = [
    ['OVERVIEW STATISTICS (SELECTED DATE)', 'COUNT'],
    ['Total Emails Received', dateRecords.length],
    ['Critical Emails', criticalCount],
    ['High-Priority Emails', highCount],
    ['Normal-Priority Emails', normalCount],
    ['Low-Priority Emails', lowCount],
    ['Spam Emails (Subset of Total)', spamCount],
    ['Emails Requiring Action (Selected Date)', actionReqToday],
    ['All Outstanding Pending Actions', pendingActionsCount],
    ['Overdue Pending Actions', overdueActionsCount]
  ];
  sheet.getRange(5, 1, kpiRows.length, 2).setValues(kpiRows);
  sheet.getRange('A5:B5').setBackground('#0f172a').setFontColor('#ffffff').setFontWeight('bold');
  sheet.getRange('A6:B14').setBorder(true, true, true, true, true, true, '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);

  // Section 2: Sender-Group Breakdown (Columns D-E, rows 5-13)
  const groupRows = [['SENDER GROUP BREAKDOWN (SELECTED DATE)', 'COUNT']];
  for (let g = 0; g < SENDER_GROUPS.length; g++) {
    groupRows.push([SENDER_GROUPS[g], groupMap[SENDER_GROUPS[g]] || 0]);
  }
  sheet.getRange(5, 4, groupRows.length, 2).setValues(groupRows);
  sheet.getRange('D5:E5').setBackground('#0f172a').setFontColor('#ffffff').setFontWeight('bold');
  sheet.getRange(6, 4, SENDER_GROUPS.length, 2).setBorder(true, true, true, true, true, true, '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);

  // Section 3: Subject Category Breakdown (Columns A-B, starting row 16)
  const catRows = [['SUBJECT CATEGORY BREAKDOWN (SELECTED DATE)', 'COUNT']];
  for (let c = 0; c < EMAIL_CATEGORIES.length; c++) {
    catRows.push([EMAIL_CATEGORIES[c], categoryMap[EMAIL_CATEGORIES[c]] || 0]);
  }
  sheet.getRange(16, 1, catRows.length, 2).setValues(catRows);
  sheet.getRange('A16:B16').setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
  sheet.getRange(17, 1, EMAIL_CATEGORIES.length, 2).setBorder(true, true, true, true, true, true, '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);

  // Section 4: Most Frequent Senders (Columns D-E, starting row 16)
  const sortedSenders = Object.keys(senderCounts).sort(function(a, b) {
    return senderCounts[b] - senderCounts[a];
  }).slice(0, 10);

  const topSenderRows = [['MOST FREQUENT SENDERS (ALL TIME)', 'EMAILS']];
  if (sortedSenders.length === 0) {
    topSenderRows.push(['No senders recorded yet', 0]);
  } else {
    for (let s = 0; s < sortedSenders.length; s++) {
      topSenderRows.push([sortedSenders[s], senderCounts[sortedSenders[s]]]);
    }
  }
  sheet.getRange(16, 4, topSenderRows.length, 2).setValues(topSenderRows);
  sheet.getRange('D16:E16').setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
  sheet.getRange(17, 4, topSenderRows.length - 1, 2).setBorder(true, true, true, true, true, true, '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);

  // Section 5: Most Important Emails (Critical & High) at Row 34
  const importantEmails = allRecords.filter(function(r) {
    return r.priority === PRIORITY_LEVELS.CRITICAL || r.priority === PRIORITY_LEVELS.HIGH;
  }).slice(-12).reverse();

  const impStartRow = 34;
  sheet.getRange(impStartRow, 1, 1, 7).setValues([[
    'DATE', 'PRIORITY', 'SENDER', 'SUBJECT', 'SUMMARY', 'DEADLINE', 'GMAIL LINK'
  ]]).setBackground('#0f172a').setFontColor('#ffffff').setFontWeight('bold');

  if (importantEmails.length === 0) {
    sheet.getRange(impStartRow + 1, 1, 1, 7).setValues([[
      '-', 'NONE', '-', 'No Critical or High-Priority emails recorded yet.', '-', '-', '-'
    ]]);
  } else {
    const impRows = importantEmails.map(function(item) {
      return [
        item.date,
        item.priority,
        item.senderName || item.senderEmail,
        item.subject,
        item.summary,
        item.deadlineText || item.deadlineISO || '-',
        '=HYPERLINK("' + item.gmailLink + '", "Open in Gmail")'
      ];
    });
    sheet.getRange(impStartRow + 1, 1, impRows.length, 7).setValues(impRows);
  }

  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 110);
  sheet.setColumnWidth(3, 40);
  sheet.setColumnWidth(4, 280);
  sheet.setColumnWidth(5, 320);
  sheet.setColumnWidth(6, 170);
  sheet.setColumnWidth(7, 130);
}
