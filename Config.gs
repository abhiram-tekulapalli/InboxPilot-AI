/**
 * ============================================================================
 * InboxPilot AI — Config.gs
 * Configuration Management, Constants, and Script Properties Validation
 * ============================================================================
 */

const CONFIG_KEYS = {
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  GEMINI_MODEL: 'GEMINI_MODEL',
  TELEGRAM_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
  TELEGRAM_CHAT_ID: 'TELEGRAM_CHAT_ID',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  DIGEST_TIME: 'DIGEST_TIME',
  TIMEZONE: 'TIMEZONE',
  MAX_EMAILS_PER_EXECUTION: 'MAX_EMAILS_PER_EXECUTION',
  MAX_BODY_CHARACTERS: 'MAX_BODY_CHARACTERS',
  ALERT_ON_HIGH_PRIORITY: 'ALERT_ON_HIGH_PRIORITY',
  DRY_RUN: 'DRY_RUN'
};

const STATE_KEYS = {
  GMAIL_HISTORY_ID: 'STATE_GMAIL_HISTORY_ID',
  LAST_SYNC_TIMESTAMP: 'STATE_LAST_SYNC_TIMESTAMP',
  LAST_DIGEST_SENT_DATE: 'STATE_LAST_DIGEST_SENT_DATE',
  INITIAL_SYNC_COMPLETED: 'STATE_INITIAL_SYNC_COMPLETED'
};

const DEFAULT_CONFIG = {
  GEMINI_MODEL: 'gemini-4-hydrogen',
  FALLBACK_GEMINI_MODELS: [
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash'
  ],
  DIGEST_TIME: '20:30',
  TIMEZONE: 'Asia/Kolkata',
  MAX_EMAILS_PER_EXECUTION: 15,
  MAX_BODY_CHARACTERS: 12000,
  ALERT_ON_HIGH_PRIORITY: false,
  DRY_RUN: false,
  INITIAL_SYNC_MAX_RESULTS: 40,
  MAX_RETRY_COUNT: 5,
  LOCK_WAIT_MS: 10000,
  MAX_EXECUTION_TIME_MS: 270000 // 4.5 minutes safety boundary (Apps Script limit is 6 mins)
};

const SHEET_NAMES = {
  DASHBOARD: 'Dashboard',
  EMAILS: 'Emails',
  SENDER_DIRECTORY: 'Sender Directory',
  SENDER_RULES: 'Sender Rules',
  DAILY_REPORTS: 'Daily Reports',
  LOGS: 'Logs'
};

const PRIORITY_LEVELS = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  NORMAL: 'NORMAL',
  LOW: 'LOW'
};

const EMAIL_CATEGORIES = [
  'University and Academics',
  'Placement and Recruitment',
  'GitHub and Developer Tools',
  'Finance and Banking',
  'Bills and Payments',
  'Government and Official',
  'Personal Communication',
  'Security and Account Notifications',
  'Shopping and Orders',
  'Travel and Bookings',
  'Newsletters and Updates',
  'Promotions and Marketing',
  'Social and Events',
  'Suspected Spam and Phishing',
  'Other'
];

const SENDER_GROUPS = [
  'University / College',
  'Recruiter / Employer',
  'GitHub / Developer Platform',
  'Banking / Finance',
  'Government',
  'Personal Contact',
  'Newsletter / Marketing',
  'Services / Other'
];

const ACTION_STATUSES = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  DISMISSED: 'DISMISSED',
  NONE: 'NONE'
};

const PROCESSING_STATUSES = {
  QUEUED: 'QUEUED',
  CLASSIFIED: 'CLASSIFIED',
  SPAM_SKIPPED: 'SPAM_SKIPPED',
  FAILED_RETRY: 'FAILED_RETRY',
  FAILED_PERMANENT: 'FAILED_PERMANENT'
};

const ALERT_STATUSES = {
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED_RETRY: 'FAILED_RETRY',
  DRY_RUN_SKIPPED: 'DRY_RUN_SKIPPED'
};

/**
 * Retrieves the complete merged configuration from Script Properties and defaults.
 * @return {Object} Configuration object.
 */
function getAppConfig() {
  const props = PropertiesService.getScriptProperties().getProperties();
  
  let spreadsheetId = (props[CONFIG_KEYS.SPREADSHEET_ID] || '').trim();
  if (!spreadsheetId) {
    try {
      const activeSs = SpreadsheetApp.getActiveSpreadsheet();
      if (activeSs) {
        spreadsheetId = activeSs.getId();
      }
    } catch (e) {
      // Running in standalone trigger context without active spreadsheet
    }
  }

  return {
    geminiApiKey: (props[CONFIG_KEYS.GEMINI_API_KEY] || '').trim(),
    geminiModel: (props[CONFIG_KEYS.GEMINI_MODEL] || DEFAULT_CONFIG.GEMINI_MODEL).trim(),
    telegramBotToken: (props[CONFIG_KEYS.TELEGRAM_BOT_TOKEN] || '').trim(),
    telegramChatId: (props[CONFIG_KEYS.TELEGRAM_CHAT_ID] || '').trim(),
    spreadsheetId: spreadsheetId,
    digestTime: (props[CONFIG_KEYS.DIGEST_TIME] || DEFAULT_CONFIG.DIGEST_TIME).trim(),
    timezone: (props[CONFIG_KEYS.TIMEZONE] || DEFAULT_CONFIG.TIMEZONE).trim(),
    maxEmailsPerExecution: parseInt(props[CONFIG_KEYS.MAX_EMAILS_PER_EXECUTION], 10) || DEFAULT_CONFIG.MAX_EMAILS_PER_EXECUTION,
    maxBodyCharacters: parseInt(props[CONFIG_KEYS.MAX_BODY_CHARACTERS], 10) || DEFAULT_CONFIG.MAX_BODY_CHARACTERS,
    alertOnHighPriority: String(props[CONFIG_KEYS.ALERT_ON_HIGH_PRIORITY]).toLowerCase() === 'true',
    dryRun: String(props[CONFIG_KEYS.DRY_RUN]).toLowerCase() === 'true',
    initialSyncMaxResults: DEFAULT_CONFIG.INITIAL_SYNC_MAX_RESULTS,
    maxRetryCount: DEFAULT_CONFIG.MAX_RETRY_COUNT,
    lockWaitMs: DEFAULT_CONFIG.LOCK_WAIT_MS,
    maxExecutionTimeMs: DEFAULT_CONFIG.MAX_EXECUTION_TIME_MS
  };
}

/**
 * Seeds default non-secret Script Properties if they are not already set.
 */
function initializeDefaultProperties() {
  const scriptProps = PropertiesService.getScriptProperties();
  const current = scriptProps.getProperties();
  const updates = {};

  if (!current[CONFIG_KEYS.GEMINI_MODEL]) updates[CONFIG_KEYS.GEMINI_MODEL] = DEFAULT_CONFIG.GEMINI_MODEL;
  if (!current[CONFIG_KEYS.DIGEST_TIME]) updates[CONFIG_KEYS.DIGEST_TIME] = DEFAULT_CONFIG.DIGEST_TIME;
  if (!current[CONFIG_KEYS.TIMEZONE]) updates[CONFIG_KEYS.TIMEZONE] = DEFAULT_CONFIG.TIMEZONE;
  if (!current[CONFIG_KEYS.MAX_EMAILS_PER_EXECUTION]) {
    updates[CONFIG_KEYS.MAX_EMAILS_PER_EXECUTION] = String(DEFAULT_CONFIG.MAX_EMAILS_PER_EXECUTION);
  }
  if (!current[CONFIG_KEYS.MAX_BODY_CHARACTERS]) {
    updates[CONFIG_KEYS.MAX_BODY_CHARACTERS] = String(DEFAULT_CONFIG.MAX_BODY_CHARACTERS);
  }
  if (!current[CONFIG_KEYS.ALERT_ON_HIGH_PRIORITY]) {
    updates[CONFIG_KEYS.ALERT_ON_HIGH_PRIORITY] = String(DEFAULT_CONFIG.ALERT_ON_HIGH_PRIORITY);
  }
  if (!current[CONFIG_KEYS.DRY_RUN]) {
    updates[CONFIG_KEYS.DRY_RUN] = String(DEFAULT_CONFIG.DRY_RUN);
  }

  if (!current[CONFIG_KEYS.SPREADSHEET_ID]) {
    try {
      const activeSs = SpreadsheetApp.getActiveSpreadsheet();
      if (activeSs) {
        updates[CONFIG_KEYS.SPREADSHEET_ID] = activeSs.getId();
      }
    } catch (e) {
      // Ignore if not container-bound
    }
  }

  if (Object.keys(updates).length > 0) {
    scriptProps.setProperties(updates, false);
  }
}

/**
 * Validates required Script Properties and returns a structured validation report.
 * Never logs or exposes actual API keys.
 * @return {Object} { valid: boolean, errors: Array<string>, warnings: Array<string>, summary: Object }
 */
function validateConfiguration() {
  const config = getAppConfig();
  const errors = [];
  const warnings = [];

  if (!config.geminiApiKey) {
    errors.push('Missing GEMINI_API_KEY in Script Properties.');
  }
  if (!config.geminiModel) {
    errors.push('Missing GEMINI_MODEL in Script Properties.');
  }
  if (!config.spreadsheetId) {
    errors.push('Missing SPREADSHEET_ID in Script Properties (and script is not bound to an active sheet).');
  }
  if (!config.telegramBotToken) {
    errors.push('Missing TELEGRAM_BOT_TOKEN in Script Properties.');
  }
  if (!config.telegramChatId) {
    warnings.push('Missing TELEGRAM_CHAT_ID in Script Properties. You can auto-retrieve it using retrieveTelegramChatId() after messaging your bot.');
  }

  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!timeRegex.test(config.digestTime)) {
    errors.push('Invalid DIGEST_TIME format "' + config.digestTime + '". Expected 24-hour HH:mm format (e.g., 20:30).');
  }

  if (config.maxEmailsPerExecution < 1 || config.maxEmailsPerExecution > 50) {
    warnings.push('MAX_EMAILS_PER_EXECUTION (' + config.maxEmailsPerExecution + ') should ideally be between 5 and 25 to avoid 6-minute execution timeouts.');
  }

  if (config.maxBodyCharacters < 500 || config.maxBodyCharacters > 50000) {
    warnings.push('MAX_BODY_CHARACTERS (' + config.maxBodyCharacters + ') is outside recommended range (2000 - 20000).');
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings,
    summary: {
      geminiApiKeySet: Boolean(config.geminiApiKey),
      geminiModel: config.geminiModel,
      telegramBotTokenSet: Boolean(config.telegramBotToken),
      telegramChatIdSet: Boolean(config.telegramChatId),
      spreadsheetIdSet: Boolean(config.spreadsheetId),
      digestTime: config.digestTime,
      timezone: config.timezone,
      maxEmailsPerExecution: config.maxEmailsPerExecution,
      maxBodyCharacters: config.maxBodyCharacters,
      alertOnHighPriority: config.alertOnHighPriority,
      dryRun: config.dryRun
    }
  };
}

/**
 * Reads a synchronization state property.
 * @param {string} key State property key.
 * @return {string|null} Value or null.
 */
function getSyncState(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

/**
 * Sets a synchronization state property.
 * @param {string} key State property key.
 * @param {string} value State value.
 */
function setSyncState(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}

/**
 * Enables or disables DRY_RUN mode in Script Properties.
 * @param {boolean} enabled Whether DRY_RUN should be enabled.
 */
function setDryRunMode(enabled) {
  PropertiesService.getScriptProperties().setProperty(CONFIG_KEYS.DRY_RUN, enabled ? 'true' : 'false');
}
