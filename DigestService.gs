/**
 * ============================================================================
 * InboxPilot AI — DigestService.gs
 * Comprehensive Daily Telegram Digest Generator & Delivery Engine
 * ============================================================================
 *
 * Builds the 7 required Daily Digest sections from stored Google Sheets records:
 * A. Overall email statistics (with Spam as a subset of total)
 * B. Subject/category breakdown
 * C. Sender-group breakdown
 * D. Critical and high-priority emails
 * E. Action-required emails (today)
 * F. Pending actions (including previous days + overdue highlighting)
 * G. Daily AI-written overview
 */

/**
 * Checks whether the daily digest is due based on configured DIGEST_TIME (default 20:30 IST)
 * and whether it has already been sent for today's calendar date.
 *
 * @param {Date=} referenceNow Optional current Date for testing.
 * @return {Object} { due: boolean, todayDate: string, reason: string }
 */
function isDailyDigestDue(referenceNow) {
  const config = getAppConfig();
  const now = referenceNow || new Date();
  const todayDate = getCalendarDateString(now);
  const lastSentDate = getSyncState(STATE_KEYS.LAST_DIGEST_SENT_DATE) || '';

  if (lastSentDate === todayDate) {
    return {
      due: false,
      todayDate: todayDate,
      reason: 'Daily digest already sent today (' + todayDate + ').'
    };
  }

  const currentHm = formatDateInTimezone(now, 'HH:mm');
  const targetHm = config.digestTime || DEFAULT_CONFIG.DIGEST_TIME;

  if (currentHm >= targetHm) {
    return {
      due: true,
      todayDate: todayDate,
      reason: 'Current time (' + currentHm + ') is at or past configured DIGEST_TIME (' + targetHm + ').'
    };
  }

  return {
    due: false,
    todayDate: todayDate,
    reason: 'Waiting for DIGEST_TIME (' + targetHm + '). Current time: ' + currentHm
  };
}

/**
 * Generates and sends the comprehensive daily digest for a specified date (defaults to today in IST).
 * Records the summary in the "Daily Reports" sheet and updates LAST_DIGEST_SENT_DATE on success.
 *
 * @param {string=} targetDateOpt Optional YYYY-MM-DD date string.
 * @param {Object=} options Optional { isTestRun: boolean, bypassDryRun: boolean }
 * @return {Object} { ok: boolean, digestText: string, partsSent: number, summary: Object, error: string|null }
 */
function generateAndSendDailyDigest(targetDateOpt, options) {
  const now = new Date();
  const reportDate = targetDateOpt || getCalendarDateString(now);
  const isTestRun = Boolean(options && options.isTestRun);

  const allRecords = getAllStoredEmailRecords();
  const digestPayload = compileDailyDigestData(allRecords, reportDate, now);

  const sendResult = sendTelegramHtmlMessage(digestPayload.htmlText, {
    bypassDryRun: Boolean(options && options.bypassDryRun)
  });

  const config = getAppConfig();
  let deliveryStatus = 'FAILED';
  if (sendResult.ok) {
    deliveryStatus = (config.dryRun && !(options && options.bypassDryRun))
      ? 'DRY_RUN_SKIPPED'
      : 'SENT (' + sendResult.partsSent + ' part' + (sendResult.partsSent === 1 ? '' : 's') + ')';
  }

  const summaryRecord = {
    date: reportDate,
    total: digestPayload.stats.total,
    critical: digestPayload.stats.critical,
    high: digestPayload.stats.high,
    normal: digestPayload.stats.normal,
    low: digestPayload.stats.low,
    spam: digestPayload.stats.spam,
    actionRequired: digestPayload.stats.actionRequired,
    pendingActionsTotal: digestPayload.stats.pendingActionsTotal,
    overdueActionsCount: digestPayload.stats.overdueActionsCount,
    deliveryStatus: deliveryStatus,
    overview: digestPayload.overview
  };

  appendDailyReportRecord(summaryRecord);

  // Mark daily digest as sent for today only if Telegram confirmed delivery (and not just a manual test for a past date)
  if (sendResult.ok && !isTestRun && !config.dryRun) {
    setSyncState(STATE_KEYS.LAST_DIGEST_SENT_DATE, reportDate);
  }

  return {
    ok: sendResult.ok,
    digestText: digestPayload.htmlText,
    partsSent: sendResult.partsSent,
    summary: summaryRecord,
    error: sendResult.error
  };
}

/**
 * Compiles all 7 required sections of the Daily Digest from stored Google Sheets records.
 *
 * @param {Array<Object>} allRecords All classified records from the Emails sheet.
 * @param {string} reportDate YYYY-MM-DD date string.
 * @param {Date} referenceNow Current Date object for overdue comparison.
 * @return {Object} { htmlText: string, stats: Object, overview: string }
 */
function compileDailyDigestData(allRecords, reportDate, referenceNow) {
  const now = referenceNow || new Date();
  const todaysRecords = [];
  const allPendingActions = [];
  const overdueActions = [];

  for (let i = 0; i < allRecords.length; i++) {
    const r = allRecords[i];
    if (r.date === reportDate) {
      todaysRecords.push(r);
    }

    // Section F requirement: Include outstanding pending actions from previous days as well as today
    if (r.actionRequired === 'YES' && r.actionStatus === ACTION_STATUSES.PENDING) {
      const overdue = isDeadlineOverdue(r.deadlineISO, now);
      const itemWithFlag = Object.assign({}, r, { isOverdue: overdue });
      allPendingActions.push(itemWithFlag);
      if (overdue) {
        overdueActions.push(itemWithFlag);
      }
    }
  }

  // Compute Section A Statistics
  // Note: Spam is a subset of total, not an additional category in the priority totals
  const stats = {
    total: todaysRecords.length,
    critical: 0,
    high: 0,
    normal: 0,
    low: 0,
    spam: 0,
    actionRequired: 0,
    pendingActionsTotal: allPendingActions.length,
    overdueActionsCount: overdueActions.length
  };

  const categoryCounts = {};
  const senderGroupCounts = {};
  for (let g = 0; g < SENDER_GROUPS.length; g++) {
    senderGroupCounts[SENDER_GROUPS[g]] = 0;
  }

  const criticalAndHighToday = [];
  const actionRequiredToday = [];

  for (let j = 0; j < todaysRecords.length; j++) {
    const rec = todaysRecords[j];

    if (rec.priority === PRIORITY_LEVELS.CRITICAL) stats.critical++;
    else if (rec.priority === PRIORITY_LEVELS.HIGH) stats.high++;
    else if (rec.priority === PRIORITY_LEVELS.NORMAL) stats.normal++;
    else stats.low++;

    if (rec.gmailSpamLabel === 'YES') {
      stats.spam++;
    }

    const cat = rec.primaryCategory || 'Other';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

    const grp = validateSenderGroup(rec.senderGroup);
    senderGroupCounts[grp] = (senderGroupCounts[grp] || 0) + 1;

    if (rec.priority === PRIORITY_LEVELS.CRITICAL || rec.priority === PRIORITY_LEVELS.HIGH) {
      criticalAndHighToday.push(rec);
    }

    if (rec.actionRequired === 'YES') {
      stats.actionRequired++;
      actionRequiredToday.push(rec);
    }
  }

  // Section G: Generate short AI-written daily overview from stored summaries
  const importantForOverview = criticalAndHighToday.concat(actionRequiredToday).slice(0, 12);
  const overviewText = generateDailyOverviewWithGemini(importantForOverview, stats);

  // Format Mobile-Friendly HTML Report
  const lines = [];
  lines.push('📊 <b>INBOXPILOT AI — DAILY EMAIL DIGEST</b>');
  lines.push('📅 <b>Date:</b> ' + escapeTelegramHtml(reportDate));
  lines.push('────────────────────');

  // Section G (Placed near top or bottom; we include clearly labelled Section A through G)
  lines.push('<b>A. OVERALL EMAIL STATISTICS</b>');
  lines.push('• Total Emails Received Today: <b>' + stats.total + '</b>');
  lines.push('• Critical Emails: <b>' + stats.critical + '</b>');
  lines.push('• High-Priority Emails: <b>' + stats.high + '</b>');
  lines.push('• Normal-Priority Emails: <b>' + stats.normal + '</b>');
  lines.push('• Low-Priority Emails: <b>' + stats.low + '</b>');
  lines.push('• Spam Emails (subset of total): <b>' + stats.spam + '</b>');
  lines.push('');

  // Section B: Subject/Category Breakdown
  lines.push('<b>B. SUBJECT / CATEGORY BREAKDOWN</b>');
  let hasCategories = false;
  for (let c = 0; c < EMAIL_CATEGORIES.length; c++) {
    const catName = EMAIL_CATEGORIES[c];
    const count = categoryCounts[catName] || 0;
    if (count > 0) {
      lines.push('• ' + escapeTelegramHtml(catName) + ': <b>' + count + '</b>');
      hasCategories = true;
    }
  }
  if (!hasCategories) {
    lines.push('• No emails categorized today.');
  }
  lines.push('');

  // Section C: Sender-Group Breakdown
  lines.push('<b>C. SENDER-GROUP BREAKDOWN</b>');
  for (let s = 0; s < SENDER_GROUPS.length; s++) {
    const grpName = SENDER_GROUPS[s];
    const grpCount = senderGroupCounts[grpName] || 0;
    lines.push('• ' + escapeTelegramHtml(grpName) + ': <b>' + grpCount + '</b>');
  }
  lines.push('');

  // Section D: Critical and High-Priority Emails
  lines.push('<b>D. CRITICAL &amp; HIGH-PRIORITY EMAILS (' + criticalAndHighToday.length + ')</b>');
  if (criticalAndHighToday.length === 0) {
    lines.push('• None received today.');
  } else {
    for (let k = 0; k < criticalAndHighToday.length; k++) {
      const imp = criticalAndHighToday[k];
      const badge = imp.priority === PRIORITY_LEVELS.CRITICAL ? '🚨 [CRITICAL]' : '⚠️ [HIGH]';
      lines.push(
        (k + 1) + '. ' + badge + ' <b>' + escapeTelegramHtml(imp.subject) + '</b>\n' +
        '   From: ' + escapeTelegramHtml(imp.senderName || imp.senderEmail) + '\n' +
        '   Summary: ' + escapeTelegramHtml(imp.summary) + '\n' +
        (imp.deadlineText ? '   Deadline: <b>' + escapeTelegramHtml(imp.deadlineText) + '</b>\n' : '') +
        '   <a href="' + escapeTelegramHtml(imp.gmailLink) + '">View in Gmail</a>'
      );
    }
  }
  lines.push('');

  // Section E: Action-Required Emails (Today)
  lines.push('<b>E. ACTION-REQUIRED EMAILS TODAY (' + actionRequiredToday.length + ')</b>');
  if (actionRequiredToday.length === 0) {
    lines.push('• No new action items identified today.');
  } else {
    for (let a = 0; a < actionRequiredToday.length; a++) {
      const act = actionRequiredToday[a];
      lines.push(
        (a + 1) + '. <b>' + escapeTelegramHtml(act.actionDescription || act.subject) + '</b>\n' +
        '   Subject: ' + escapeTelegramHtml(act.subject) + '\n' +
        '   Deadline: ' + escapeTelegramHtml(act.deadlineText || act.deadlineISO || 'Not specified') + '\n' +
        '   Status: <b>' + escapeTelegramHtml(act.actionStatus) + '</b> | <a href="' + escapeTelegramHtml(act.gmailLink) + '">Gmail</a>'
      );
    }
  }
  lines.push('');

  // Section F: Pending Actions (All Outstanding + Overdue Highlighted)
  lines.push('<b>F. OUTSTANDING PENDING ACTIONS (' + allPendingActions.length + ' Total, ' + overdueActions.length + ' Overdue)</b>');
  if (allPendingActions.length === 0) {
    lines.push('• All caught up! Zero pending actions.');
  } else {
    // Sort so overdue items appear first
    allPendingActions.sort(function(x, y) {
      if (x.isOverdue !== y.isOverdue) return x.isOverdue ? -1 : 1;
      return String(x.date).localeCompare(String(y.date));
    });

    for (let p = 0; p < allPendingActions.length; p++) {
      const pend = allPendingActions[p];
      const prefix = pend.isOverdue ? '🔴 <b>[OVERDUE]</b> ' : '🟡 [PENDING] ';
      lines.push(
        (p + 1) + '. ' + prefix + '<b>' + escapeTelegramHtml(pend.actionDescription || pend.subject) + '</b>\n' +
        '   From (' + escapeTelegramHtml(pend.date) + '): ' + escapeTelegramHtml(pend.senderName || pend.senderEmail) + '\n' +
        '   Deadline: ' + escapeTelegramHtml(pend.deadlineText || pend.deadlineISO || 'None') +
        ' | <a href="' + escapeTelegramHtml(pend.gmailLink) + '">Open</a>'
      );
    }
  }
  lines.push('');

  // Section G: Daily Overview
  lines.push('<b>G. DAILY AI OVERVIEW</b>');
  lines.push(escapeTelegramHtml(overviewText));

  return {
    htmlText: lines.join('\n'),
    stats: stats,
    overview: overviewText
  };
}
