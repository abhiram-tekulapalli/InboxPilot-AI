/**
 * ============================================================================
 * InboxPilot AI — SyncService.gs
 * Durable Queue Synchronization, Batch Processing, and Retry Orchestrator
 * ============================================================================
 *
 * Implements the complete fault-tolerant execution pipeline:
 * 1. Synchronize new Gmail messages using stored historyId cursor (with automatic
 *    fallback to recent-message sync on initial run or HTTP 404 expired cursor).
 * 2. Durably enqueue new message IDs in the Emails sheet before calling Gemini.
 * 3. Process a bounded batch of queued & retry-eligible emails within Apps Script's
 *    execution time budget.
 * 4. Send & retry immediate Telegram notifications for CRITICAL emails.
 * 5. Update Sender Directory and Dashboard statistics.
 */

/**
 * Performs Gmail synchronization (initial or incremental via History API) and
 * enqueues newly discovered incoming message IDs into the Google Sheets queue.
 *
 * @return {Object} { ok: boolean, syncMode: string, detectedCount: number, enqueuedCount: number, historyId: string, error: string|null }
 */
function synchronizeGmailInboxToQueue() {
  const initialDone = getSyncState(STATE_KEYS.INITIAL_SYNC_COMPLETED) === 'true';
  const storedHistoryId = getSyncState(STATE_KEYS.GMAIL_HISTORY_ID) || '';

  let syncMode = 'INCREMENTAL_HISTORY';
  let discoveredIds = [];
  let nextHistoryId = storedHistoryId;

  try {
    if (!initialDone || !storedHistoryId) {
      syncMode = 'INITIAL_RECENT_SYNC';
      const initialRes = listRecentIncomingMessages();
      discoveredIds = initialRes.messageIds || [];
      nextHistoryId = initialRes.latestHistoryId || '';
    } else {
      const historyRes = listIncrementalHistoryMessages(storedHistoryId);
      if (historyRes.cursorExpired) {
        // Requirement 4.6: Automatically perform a recent-message synchronization if cursor expired (HTTP 404)
        syncMode = 'CURSOR_EXPIRED_RECOVERY_SYNC';
        const fallbackRes = listRecentIncomingMessages();
        discoveredIds = fallbackRes.messageIds || [];
        nextHistoryId = fallbackRes.latestHistoryId || '';
      } else {
        discoveredIds = historyRes.messageIds || [];
        if (historyRes.latestHistoryId) {
          nextHistoryId = historyRes.latestHistoryId;
        }
      }
    }

    // Durably record newly detected message IDs in the Google Sheets queue first
    const enqueuedCount = enqueueNewMessageIds(discoveredIds);

    // Update synchronization cursor only after durable queueing succeeds
    if (nextHistoryId) {
      setSyncState(STATE_KEYS.GMAIL_HISTORY_ID, nextHistoryId);
    }
    setSyncState(STATE_KEYS.INITIAL_SYNC_COMPLETED, 'true');
    setSyncState(STATE_KEYS.LAST_SYNC_TIMESTAMP, formatDateInTimezone(new Date(), 'yyyy-MM-dd HH:mm:ss'));

    return {
      ok: true,
      syncMode: syncMode,
      detectedCount: discoveredIds.length,
      enqueuedCount: enqueuedCount,
      historyId: nextHistoryId,
      error: null
    };
  } catch (err) {
    return {
      ok: false,
      syncMode: syncMode,
      detectedCount: 0,
      enqueuedCount: 0,
      historyId: storedHistoryId,
      error: err && err.message ? err.message : String(err)
    };
  }
}

/**
 * Processes a bounded batch of queued and retryable emails from the Google Sheets queue.
 * Respects MAX_EMAILS_PER_EXECUTION and stops gracefully if Gemini rate-limits (HTTP 429)
 * or if the execution approaches Apps Script's 6-minute limit.
 *
 * @param {number} startTimeMs Execution start timestamp in ms.
 * @return {Object} Telemetry counters for the batch run.
 */
function processQueuedEmailsBatch(startTimeMs) {
  const config = getAppConfig();
  const batchItems = getQueuedEmailsBatch(config.maxEmailsPerExecution, config.maxRetryCount);

  const metrics = {
    queuedBatchSize: batchItems.length,
    emailsProcessed: 0,
    classificationsCompleted: 0,
    criticalAlertsSent: 0,
    apiFailures: 0,
    telegramFailures: 0,
    retryAttempts: 0,
    rateLimitedStoppedEarly: false
  };

  if (batchItems.length === 0) {
    return metrics;
  }

  const senderRules = getActiveSenderRules();
  const newlyClassifiedRecords = [];

  for (let i = 0; i < batchItems.length; i++) {
    if (isExecutionTimeExceeded(startTimeMs)) {
      break;
    }

    const item = batchItems[i];
    if (item.retryCount > 0) {
      metrics.retryAttempts++;
    }

    let emailObj;
    try {
      emailObj = fetchAndPreprocessEmail(item.messageId);
    } catch (gmailErr) {
      metrics.apiFailures++;
      markEmailRowFailedOrRetry(
        item.rowNumber,
        item.retryCount + 1,
        config.maxRetryCount,
        'Gmail fetch error: ' + (gmailErr && gmailErr.message ? gmailErr.message : String(gmailErr))
      );
      continue;
    }

    if (!emailObj) {
      // Message no longer exists in Gmail
      removeIrrelevantStubRow(item.rowNumber);
      continue;
    }

    if (emailObj.skippedIrrelevant) {
      // Message was SENT, DRAFT, or TRASH
      removeIrrelevantStubRow(item.rowNumber);
      continue;
    }

    metrics.emailsProcessed++;

    const classificationRes = classifyEmailRecord(emailObj, senderRules);
    if (!classificationRes.ok) {
      metrics.apiFailures++;

      if (classificationRes.rateLimited) {
        // Defer remaining tasks to the next 5-minute scheduled execution without incrementing permanent failure
        markEmailRowFailedOrRetry(
          item.rowNumber,
          item.retryCount,
          config.maxRetryCount,
          'Deferred: Gemini API HTTP 429 rate limit'
        );
        metrics.rateLimitedStoppedEarly = true;
        break;
      }

      markEmailRowFailedOrRetry(
        item.rowNumber,
        item.retryCount + 1,
        config.maxRetryCount,
        classificationRes.error || 'Classification error'
      );
      continue;
    }

    const record = classificationRes.record;
    record.retryCount = item.retryCount;

    // 1. Save classified email record in Google Sheets
    const savedRow = saveClassifiedEmailRecord(record, item.rowNumber);
    record.rowNumber = savedRow;
    metrics.classificationsCompleted++;
    newlyClassifiedRecords.push(record);

    // 2. If CRITICAL (or HIGH when configured), send immediate Telegram alert right after saving
    if (record.criticalAlertStatus === ALERT_STATUSES.PENDING) {
      const alertRes = sendImmediateCriticalEmailAlert(record);
      if (alertRes.ok) {
        const finalAlertStatus = alertRes.dryRunSkipped
          ? ALERT_STATUSES.DRY_RUN_SKIPPED
          : ALERT_STATUSES.SENT;
        updateEmailAlertStatus(savedRow, finalAlertStatus, alertRes.sentTimestamp);
        if (!alertRes.dryRunSkipped) {
          metrics.criticalAlertsSent++;
        }
      } else {
        metrics.telegramFailures++;
        updateEmailAlertStatus(savedRow, ALERT_STATUSES.FAILED_RETRY, '');
      }
    }
  }

  // Batch update Sender Directory for all newly classified records
  if (newlyClassifiedRecords.length > 0) {
    try {
      updateSenderDirectoryBatch(newlyClassifiedRecords);
    } catch (dirErr) {
      console.error('Sender Directory update error:', dirErr);
    }
  }

  return metrics;
}

/**
 * Retries any previously unsent Critical Email alerts (where Critical Alert Status is PENDING or FAILED_RETRY).
 * Guarantees no duplicate alerts are sent once status transitions to SENT.
 *
 * @param {number} startTimeMs Execution start timestamp in ms.
 * @return {Object} { attempted: number, sent: number, failed: number }
 */
function retryUnsentCriticalAlerts(startTimeMs) {
  const pendingAlerts = getPendingCriticalAlerts();
  let attempted = 0;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < pendingAlerts.length; i++) {
    if (isExecutionTimeExceeded(startTimeMs)) break;

    const record = pendingAlerts[i];
    attempted++;

    const res = sendImmediateCriticalEmailAlert(record);
    if (res.ok) {
      const status = res.dryRunSkipped ? ALERT_STATUSES.DRY_RUN_SKIPPED : ALERT_STATUSES.SENT;
      updateEmailAlertStatus(record.rowNumber, status, res.sentTimestamp);
      if (!res.dryRunSkipped) sent++;
    } else {
      failed++;
      updateEmailAlertStatus(record.rowNumber, ALERT_STATUSES.FAILED_RETRY, '');
    }
  }

  return {
    attempted: attempted,
    sent: sent,
    failed: failed
  };
}
