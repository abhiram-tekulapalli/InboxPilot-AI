/**
 * ============================================================================
 * InboxPilot AI — Scheduler.gs
 * Idempotent Time-Driven Trigger Management (5-Minute Autonomous Polling)
 * ============================================================================
 */

const TRIGGER_HANDLER_FUNCTION = 'runScheduledAgentCycle';

/**
 * Programmatically creates the 5-minute time-driven trigger for `runScheduledAgentCycle`.
 * Idempotent: Running this function multiple times will NOT create duplicate triggers.
 *
 * @return {Object} { created: boolean, existingCount: number, triggerId: string, message: string }
 */
function setupScheduledTriggersIdempotent() {
  const existingTriggers = ScriptApp.getProjectTriggers();
  const matchingTriggers = [];

  for (let i = 0; i < existingTriggers.length; i++) {
    const t = existingTriggers[i];
    if (t.getHandlerFunction() === TRIGGER_HANDLER_FUNCTION) {
      matchingTriggers.push(t);
    }
  }

  // If more than 1 duplicate trigger exists, remove extras to enforce strict idempotency
  if (matchingTriggers.length > 1) {
    for (let j = 1; j < matchingTriggers.length; j++) {
      ScriptApp.deleteTrigger(matchingTriggers[j]);
    }
  }

  if (matchingTriggers.length >= 1) {
    const keptTrigger = matchingTriggers[0];
    return {
      created: false,
      existingCount: 1,
      triggerId: String(keptTrigger.getUniqueId() || ''),
      message: '5-minute scheduled trigger for ' + TRIGGER_HANDLER_FUNCTION + ' is already active (ID: ' + keptTrigger.getUniqueId() + '). No duplicate created.'
    };
  }

  const newTrigger = ScriptApp.newTrigger(TRIGGER_HANDLER_FUNCTION)
    .timeBased()
    .everyMinutes(5)
    .create();

  return {
    created: true,
    existingCount: 0,
    triggerId: String(newTrigger.getUniqueId() || ''),
    message: 'Created new 5-minute time-driven trigger for ' + TRIGGER_HANDLER_FUNCTION + ' (ID: ' + newTrigger.getUniqueId() + ').'
  };
}

/**
 * Removes all scheduled triggers for InboxPilot AI (useful when pausing the agent).
 * @return {number} Number of triggers deleted.
 */
function removeAllAgentTriggers() {
  const existingTriggers = ScriptApp.getProjectTriggers();
  let deleted = 0;
  for (let i = 0; i < existingTriggers.length; i++) {
    if (existingTriggers[i].getHandlerFunction() === TRIGGER_HANDLER_FUNCTION) {
      ScriptApp.deleteTrigger(existingTriggers[i]);
      deleted++;
    }
  }
  return deleted;
}

/**
 * Returns status information about active triggers and synchronization state.
 * @return {Object} Execution and trigger status report.
 */
function getAgentExecutionStatus() {
  const triggers = ScriptApp.getProjectTriggers();
  const agentTriggers = [];
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === TRIGGER_HANDLER_FUNCTION) {
      agentTriggers.push(triggers[i].getUniqueId());
    }
  }

  const config = getAppConfig();
  return {
    triggerActive: agentTriggers.length > 0,
    triggerCount: agentTriggers.length,
    triggerIds: agentTriggers,
    lastSyncTimestamp: getSyncState(STATE_KEYS.LAST_SYNC_TIMESTAMP) || 'Never',
    gmailHistoryCursor: getSyncState(STATE_KEYS.GMAIL_HISTORY_ID) || 'Not initialized',
    initialSyncCompleted: getSyncState(STATE_KEYS.INITIAL_SYNC_COMPLETED) === 'true',
    lastDigestSentDate: getSyncState(STATE_KEYS.LAST_DIGEST_SENT_DATE) || 'Never',
    configuredDigestTime: config.digestTime,
    timezone: config.timezone,
    geminiModel: config.geminiModel,
    dryRun: config.dryRun
  };
}
