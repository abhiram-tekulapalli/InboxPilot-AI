/**
 * ============================================================================
 * InboxPilot AI — Main.gs
 * Entry Points, Custom Google Sheets Menu, and LockService Orchestration
 * ============================================================================
 */

/**
 * Google Sheets onOpen trigger: Creates the custom "InboxPilot AI" management menu.
 */
function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('InboxPilot AI')
      .addItem('1. Setup / Initialize', 'menuSetupInitialize')
      .addItem('2. Run Agent Now', 'menuRunAgentNow')
      .addItem('3. Send Test Telegram Message', 'menuSendTestTelegramMessage')
      .addItem('4. Generate Test Daily Digest', 'menuGenerateTestDailyDigest')
      .addItem('5. Check Configuration', 'menuCheckConfiguration')
      .addItem('6. Retry Failed Tasks', 'menuRetryFailedTasks')
      .addItem('7. View Execution Status', 'menuViewExecutionStatus')
      .addSeparator()
      .addItem('Auto-Detect Telegram Chat ID', 'menuRetrieveTelegramChatId')
      .addItem('Run Verification Test Suite (DRY_RUN)', 'menuRunVerificationTests')
      .addToUi();
  } catch (e) {
    // Ignore if invoked outside interactive spreadsheet context
  }
}

/**
 * Primary 5-minute scheduled execution entry point (`runScheduledAgentCycle`).
 * Protected by LockService to prevent overlapping executions.
 *
 * Performs:
 * 1. Synchronize new Gmail messages using History API cursor.
 * 2. Add new messages to the durable processing queue.
 * 3. Process a bounded number of queued & retryable emails.
 * 4. Retry any unsent critical Telegram notifications.
 * 5. Check whether the daily digest is due (default 20:30 IST) and send once per day.
 * 6. Refresh Dashboard & append execution telemetry to Logs sheet.
 *
 * @return {Object} Execution summary report.
 */
function runScheduledAgentCycle() {
  const startTimeMs = Date.now();
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(DEFAULT_CONFIG.LOCK_WAIT_MS)) {
    const skipNote = 'Skipped execution: Another InboxPilot AI process is currently holding the ScriptLock.';
    appendExecutionLog({
      functionName: 'runScheduledAgentCycle',
      notes: skipNote
    });
    return { ok: false, skippedLock: true, message: skipNote };
  }

  const logMetrics = {
    functionName: 'runScheduledAgentCycle',
    emailsDetected: 0,
    emailsProcessed: 0,
    classificationsCompleted: 0,
    criticalAlertsSent: 0,
    apiFailures: 0,
    telegramFailures: 0,
    syncErrors: 0,
    retryAttempts: 0,
    notes: []
  };

  try {
    const validation = validateConfiguration();
    if (!validation.valid) {
      logMetrics.syncErrors = 1;
      logMetrics.notes.push('Config invalid: ' + validation.errors.join(' | '));
      appendExecutionLog({
        functionName: logMetrics.functionName,
        syncErrors: 1,
        notes: logMetrics.notes.join('; ')
      });
      return { ok: false, errors: validation.errors };
    }

    // Step 1 & 2: Synchronize new Gmail messages and enqueue into Emails sheet
    const syncRes = synchronizeGmailInboxToQueue();
    logMetrics.emailsDetected = syncRes.detectedCount;
    logMetrics.notes.push('Sync: ' + syncRes.syncMode + ' (enqueued ' + syncRes.enqueuedCount + ')');
    if (!syncRes.ok) {
      logMetrics.syncErrors++;
      logMetrics.notes.push('Sync error: ' + syncRes.error);
    }

    // Step 3 & 4: Process a bounded batch of queued and retryable emails
    const batchRes = processQueuedEmailsBatch(startTimeMs);
    logMetrics.emailsProcessed = batchRes.emailsProcessed;
    logMetrics.classificationsCompleted = batchRes.classificationsCompleted;
    logMetrics.criticalAlertsSent += batchRes.criticalAlertsSent;
    logMetrics.apiFailures += batchRes.apiFailures;
    logMetrics.telegramFailures += batchRes.telegramFailures;
    logMetrics.retryAttempts += batchRes.retryAttempts;
    if (batchRes.rateLimitedStoppedEarly) {
      logMetrics.notes.push('Gemini 429 rate limit reached; remaining queue deferred');
    }

    // Step 5: Retry any previously unsent critical notifications
    if (!isExecutionTimeExceeded(startTimeMs)) {
      const alertRetryRes = retryUnsentCriticalAlerts(startTimeMs);
      logMetrics.criticalAlertsSent += alertRetryRes.sent;
      logMetrics.telegramFailures += alertRetryRes.failed;
      logMetrics.retryAttempts += alertRetryRes.attempted;
    }

    // Step 6 & 7: Check whether the Daily Digest is due and send if not yet sent today
    if (!isExecutionTimeExceeded(startTimeMs)) {
      const digestCheck = isDailyDigestDue();
      if (digestCheck.due) {
        const digestRes = generateAndSendDailyDigest(digestCheck.todayDate);
        if (digestRes.ok) {
          logMetrics.notes.push('Daily Digest sent for ' + digestCheck.todayDate);
        } else {
          logMetrics.telegramFailures++;
          logMetrics.notes.push('Daily Digest failed: ' + digestRes.error);
        }
      }
    }

    // Refresh Dashboard metrics
    try {
      refreshDashboardSheet();
    } catch (dashErr) {
      logMetrics.notes.push('Dashboard refresh warning: ' + dashErr.message);
    }

    appendExecutionLog({
      functionName: logMetrics.functionName,
      emailsDetected: logMetrics.emailsDetected,
      emailsProcessed: logMetrics.emailsProcessed,
      classificationsCompleted: logMetrics.classificationsCompleted,
      criticalAlertsSent: logMetrics.criticalAlertsSent,
      apiFailures: logMetrics.apiFailures,
      telegramFailures: logMetrics.telegramFailures,
      syncErrors: logMetrics.syncErrors,
      retryAttempts: logMetrics.retryAttempts,
      notes: logMetrics.notes.join(' | ')
    });

    return {
      ok: true,
      metrics: logMetrics
    };
  } catch (fatalErr) {
    logMetrics.syncErrors++;
    logMetrics.notes.push('Fatal exception: ' + (fatalErr && fatalErr.message ? fatalErr.message : String(fatalErr)));
    appendExecutionLog({
      functionName: logMetrics.functionName,
      emailsDetected: logMetrics.emailsDetected,
      emailsProcessed: logMetrics.emailsProcessed,
      classificationsCompleted: logMetrics.classificationsCompleted,
      criticalAlertsSent: logMetrics.criticalAlertsSent,
      apiFailures: logMetrics.apiFailures,
      telegramFailures: logMetrics.telegramFailures,
      syncErrors: logMetrics.syncErrors,
      retryAttempts: logMetrics.retryAttempts,
      notes: logMetrics.notes.join(' | ')
    });
    return {
      ok: false,
      error: fatalErr && fatalErr.message ? fatalErr.message : String(fatalErr)
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Complete one-click initialization:
 * 1. Seeds default Script Properties.
 * 2. Creates and formats all 6 Google Sheets.
 * 3. Installs the idempotent 5-minute scheduled trigger.
 *
 * @return {Object} Initialization result.
 */
function setupAndInitializeAgent() {
  initializeDefaultProperties();
  const sheetsRes = initializeDatabaseSheets();
  const triggerRes = setupScheduledTriggersIdempotent();
  const configValidation = validateConfiguration();

  appendExecutionLog({
    functionName: 'setupAndInitializeAgent',
    notes: 'Initialized ' + sheetsRes.initializedSheets.length + ' sheets. ' + triggerRes.message
  });

  return {
    ok: true,
    sheets: sheetsRes,
    trigger: triggerRes,
    validation: configValidation
  };
}

/**
 * Retries failed classifications and unsent critical notifications on demand.
 * @return {Object} Retry summary.
 */
function retryFailedTasksNow() {
  const startTimeMs = Date.now();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(DEFAULT_CONFIG.LOCK_WAIT_MS)) {
    return { ok: false, message: 'Another process is currently running. Please wait a moment.' };
  }

  try {
    const batchRes = processQueuedEmailsBatch(startTimeMs);
    const alertRes = retryUnsentCriticalAlerts(startTimeMs);
    refreshDashboardSheet();

    appendExecutionLog({
      functionName: 'retryFailedTasksNow',
      emailsProcessed: batchRes.emailsProcessed,
      classificationsCompleted: batchRes.classificationsCompleted,
      criticalAlertsSent: batchRes.criticalAlertsSent + alertRes.sent,
      apiFailures: batchRes.apiFailures,
      telegramFailures: batchRes.telegramFailures + alertRes.failed,
      retryAttempts: batchRes.retryAttempts + alertRes.attempted,
      notes: 'Manual retry triggered'
    });

    return {
      ok: true,
      batchRes: batchRes,
      alertRes: alertRes
    };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// GOOGLE SHEETS MENU HANDLERS
// ============================================================================

function menuSetupInitialize() {
  const res = setupAndInitializeAgent();
  const msg = [
    '✅ InboxPilot AI Initialized!',
    '',
    '• Sheets Initialized: ' + res.sheets.initializedSheets.join(', '),
    '• Trigger Status: ' + res.trigger.message,
    '• Configuration Valid: ' + (res.validation.valid ? 'YES' : 'NO (Check Script Properties)'),
    res.validation.errors.length ? '\nMissing Properties:\n- ' + res.validation.errors.join('\n- ') : ''
  ].join('\n');
  showSheetAlert('Setup / Initialize', msg);
}

function menuRunAgentNow() {
  const res = runScheduledAgentCycle();
  if (!res.ok) {
    showSheetAlert('Run Agent Now — Warning', res.message || (res.errors ? res.errors.join('\n') : res.error));
    return;
  }
  const m = res.metrics;
  const msg = [
    '✅ Agent Execution Cycle Completed',
    '',
    '• New Emails Detected: ' + m.emailsDetected,
    '• Queued Emails Processed: ' + m.emailsProcessed,
    '• Classifications Completed: ' + m.classificationsCompleted,
    '• Critical Alerts Sent: ' + m.criticalAlertsSent,
    '• API Failures: ' + m.apiFailures,
    '• Notes: ' + m.notes.join(' | ')
  ].join('\n');
  showSheetAlert('Run Agent Now', msg);
}

function menuSendTestTelegramMessage() {
  const res = sendTestTelegramMessage();
  if (res.ok) {
    showSheetAlert('Telegram Test', '✅ Test message successfully delivered to your Telegram chat!');
  } else {
    showSheetAlert('Telegram Test Failed', '❌ Could not send Telegram message:\n' + res.error);
  }
}

function menuGenerateTestDailyDigest() {
  const today = getCalendarDateString(new Date());
  const res = generateAndSendDailyDigest(today, { isTestRun: true, bypassDryRun: true });
  if (res.ok) {
    showSheetAlert(
      'Test Daily Digest Sent',
      '✅ Daily Digest for ' + today + ' delivered (' + res.partsSent + ' message part(s)).'
    );
  } else {
    showSheetAlert('Test Daily Digest Failed', '❌ Failed to send Daily Digest:\n' + res.error);
  }
}

function menuCheckConfiguration() {
  const v = validateConfiguration();
  const lines = [
    v.valid ? '✅ Configuration is VALID' : '❌ Configuration has missing required properties',
    '',
    '• GEMINI_API_KEY: ' + (v.summary.geminiApiKeySet ? 'Configured' : 'MISSING'),
    '• GEMINI_MODEL: ' + v.summary.geminiModel,
    '• TELEGRAM_BOT_TOKEN: ' + (v.summary.telegramBotTokenSet ? 'Configured' : 'MISSING'),
    '• TELEGRAM_CHAT_ID: ' + (v.summary.telegramChatIdSet ? 'Configured' : 'MISSING'),
    '• SPREADSHEET_ID: ' + (v.summary.spreadsheetIdSet ? 'Configured' : 'MISSING'),
    '• DIGEST_TIME: ' + v.summary.digestTime + ' (' + v.summary.timezone + ')',
    '• MAX_EMAILS_PER_EXECUTION: ' + v.summary.maxEmailsPerExecution,
    '• MAX_BODY_CHARACTERS: ' + v.summary.maxBodyCharacters,
    '• DRY_RUN: ' + v.summary.dryRun
  ];
  if (v.errors.length > 0) {
    lines.push('\nErrors:\n- ' + v.errors.join('\n- '));
  }
  if (v.warnings.length > 0) {
    lines.push('\nWarnings:\n- ' + v.warnings.join('\n- '));
  }
  showSheetAlert('Configuration Check', lines.join('\n'));
}

function menuRetryFailedTasks() {
  const res = retryFailedTasksNow();
  if (!res.ok) {
    showSheetAlert('Retry Failed Tasks', res.message);
    return;
  }
  const msg = [
    '✅ Retry Cycle Finished',
    '',
    '• Emails Re-processed: ' + res.batchRes.emailsProcessed,
    '• Classifications Succeeded: ' + res.batchRes.classificationsCompleted,
    '• Critical Alerts Re-sent: ' + (res.batchRes.criticalAlertsSent + res.alertRes.sent),
    '• Remaining Failures: ' + (res.batchRes.apiFailures + res.alertRes.failed)
  ].join('\n');
  showSheetAlert('Retry Failed Tasks', msg);
}

function menuViewExecutionStatus() {
  const st = getAgentExecutionStatus();
  const msg = [
    '📊 InboxPilot AI — Execution Status',
    '',
    '• 5-Min Trigger Active: ' + (st.triggerActive ? 'YES (' + st.triggerCount + ' trigger)' : 'NO'),
    '• Initial Gmail Sync Done: ' + (st.initialSyncCompleted ? 'YES' : 'NO'),
    '• Gmail History Cursor: ' + st.gmailHistoryCursor,
    '• Last Sync Timestamp: ' + st.lastSyncTimestamp,
    '• Last Daily Digest Sent: ' + st.lastDigestSentDate,
    '• Scheduled Digest Time: ' + st.configuredDigestTime + ' (' + st.timezone + ')',
    '• Active Gemini Model: ' + st.geminiModel,
    '• Dry Run Mode: ' + (st.dryRun ? 'ENABLED' : 'DISABLED')
  ].join('\n');
  showSheetAlert('Execution Status', msg);
}

function menuRetrieveTelegramChatId() {
  const res = retrieveTelegramChatId();
  showSheetAlert('Auto-Detect Telegram Chat ID', res.message);
}

function menuRunVerificationTests() {
  const report = runAllVerificationTests();
  const msg = [
    '🧪 Verification Test Suite Completed (DRY_RUN enforced)',
    '',
    '• Total Tests: ' + report.total,
    '• Passed: ' + report.passed,
    '• Failed: ' + report.failed,
    '',
    'Detailed results have been logged to the "Logs" sheet and Execution Transcript.'
  ].join('\n');
  showSheetAlert('Verification Test Suite', msg);
}

/**
 * Helper to display a modal alert inside Google Sheets when invoked from the custom menu,
 * or log to console if invoked from the Apps Script IDE editor.
 */
function showSheetAlert(title, message) {
  console.log('[' + title + ']\n' + message);
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Running from script editor or trigger where UI alert is unavailable
  }
}
