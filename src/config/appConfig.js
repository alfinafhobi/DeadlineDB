function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(value, fallback = []) {
  if (!value) {
    return fallback;
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const port = parseNumber(process.env.PORT, 3000);
const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;

module.exports = {
  nodeEnv,
  isProduction,
  port,
  appBaseUrl,
  trustProxy: parseBoolean(process.env.TRUST_PROXY, isProduction),
  mongoUri: process.env.MONGO_URI || "",
  jwtSecret: process.env.JWT_SECRET || "change-me",
  providerTokenEncryptionKey: process.env.PROVIDER_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || "change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  corsOrigins: parseCsv(
    process.env.CORS_ORIGINS,
    ["http://localhost:3000", "http://127.0.0.1:3000"]
  ),
  bodyLimit: process.env.BODY_LIMIT || "300kb",
  rateLimitWindowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  rateLimitMax: parseNumber(process.env.RATE_LIMIT_MAX, 250),
  authRateLimitMax: parseNumber(process.env.AUTH_RATE_LIMIT_MAX, 20),
  dashboardCacheTtlMs: parseNumber(process.env.DASHBOARD_CACHE_TTL_MS, 5000),
  reminderCron: process.env.REMINDER_CRON || "*/5 * * * *",
  reminderSchedulerEnabled: parseBoolean(process.env.REMINDER_SCHEDULER_ENABLED, true),
  reminderSweepBatchSize: parseNumber(process.env.REMINDER_SWEEP_BATCH_SIZE, 200),
  sourceSyncCron: process.env.SOURCE_SYNC_CRON || "*/30 * * * *",
  sourceSyncSchedulerEnabled: parseBoolean(process.env.SOURCE_SYNC_SCHEDULER_ENABLED, false),
  sourceSyncBatchSize: parseNumber(process.env.SOURCE_SYNC_BATCH_SIZE, 25),
  emailFrom: process.env.EMAIL_FROM || "notifications@deadlinedb.local",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: parseNumber(process.env.SMTP_PORT, 587),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpSecure: parseBoolean(process.env.SMTP_SECURE, false),
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || `${appBaseUrl}/api/integrations/oauth/google/callback`,
  telegramApiBaseUrl: process.env.TELEGRAM_API_BASE_URL || "https://api.telegram.org",
  telegramProxyUrl:
    process.env.TELEGRAM_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    "",
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
  telegramRequestTimeoutMs: parseNumber(process.env.TELEGRAM_REQUEST_TIMEOUT_MS, 15000),
  telegramIpFamily: parseNumber(process.env.TELEGRAM_IP_FAMILY, 0),
  defaultTimezone: process.env.DEFAULT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Calcutta",
  logLevel: process.env.LOG_LEVEL || "info",
  demoMode: parseBoolean(process.env.DEMO_MODE, false),
  demoPassword: process.env.DEMO_PASSWORD || "demo123",
  serveStaticMaxAge: isProduction ? "1d" : 0
};
