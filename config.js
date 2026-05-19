require('dotenv').config();

const retry = {
  maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS || '3', 10),
  delayMs: parseInt(process.env.RETRY_DELAY_MS || '5000', 10),
  exponentialBackoff: process.env.RETRY_EXPONENTIAL_BACKOFF === 'true',
};

const smtpServer = {
  port: parseInt(process.env.PORT_SMTP_EXT || '2525', 10),
  host: "0.0.0.0",
  authOptional: process.env.SMTP_AUTH_OPTIONAL === 'true',
  disabledCommands: ["STARTTLS"],
};

const defaultSettings = {
  retryMaxAttempts: retry.maxAttempts,
  retryDelayMs: retry.delayMs,
  retryExponentialBackoff: retry.exponentialBackoff,
  defaultDailyLimit: parseInt(process.env.DEFAULT_DAILY_LIMIT || '400', 10),
  defaultHourlyLimit: parseInt(process.env.DEFAULT_HOURLY_LIMIT || '100', 10),
};

const accounts = (() => {
  // Config accounts base list (fallback)
  return [];
})();

const rules = (() => {
  return [
    {
      name: "Default",
      match: {}, // Match tất cả
      accounts: accounts.map((x) => x.id),
      order: 999,
      enabled: true,
    }
  ];
})();

module.exports = {
  smtpServer,
  accounts,
  rules,
  retry,
  defaultSettings,
};
