const express = require("express");

const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const SourceConnection = require("../models/SourceConnection");
const User = require("../models/User");
const { invalidateUserViewCaches } = require("../services/cacheService");
const {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  verifyState
} = require("../services/googleOAuthService");
const { encryptSecret } = require("../services/secureTokenService");
const {
  findConnectionWithSecrets,
  importNormalizedItem,
  syncConnection
} = require("../services/sourceSyncService");
const {
  buildConnectivityMessage,
  discoverVisibleChats,
  extractWebhookMessages,
  publicDiagnostics,
  testTelegramConnection,
  verifyWebhookSecret
} = require("../services/telegramAdapter");
const { normalizeTelegramMessage } = require("../services/providerNormalizationService");
const logger = require("../utils/logger");
const {
  integrationCreateSchema,
  integrationSettingsSchema,
  integrationSyncSchema,
  providerParamSchema
} = require("../validation/schemas");

const router = express.Router();

function normalizeCsv(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFlexibleBoolean(value, fallback = undefined) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveInteger(value, fallback = undefined) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeSettings(settings = {}) {
  const normalized = { ...settings };

  [
    "courseIds",
    "courseNames",
    "senderFilters",
    "keywordFilters",
    "labelFilters",
    "courseKeywords",
    "chatIds"
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) {
      normalized[key] = normalizeCsv(normalized[key]);
    }
  });

  if (Object.prototype.hasOwnProperty.call(normalized, "pollingEnabled")) {
    normalized.pollingEnabled = parseFlexibleBoolean(normalized.pollingEnabled, true);
  }

  if (Object.prototype.hasOwnProperty.call(normalized, "maxResults")) {
    normalized.maxResults = parsePositiveInteger(normalized.maxResults);
  }

  [
    "botToken",
    "botUsername",
    "webhookSecret",
    "webhookUrl",
    "query"
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) {
      normalized[key] = String(normalized[key] || "").trim();
    }
  });

  return normalized;
}

function mergeSettings(existing = {}, incoming = {}) {
  return {
    ...(existing || {}),
    ...(incoming || {})
  };
}

function defaultProviderLabel(provider) {
  return {
    gmail: "Academic Gmail",
    "google-classroom": "Google Classroom",
    telegram: "Telegram Academic Notices"
  }[provider] || "Connected source";
}

async function findLatestProviderConnection(userId, provider) {
  return SourceConnection.findOne({
    user: userId,
    provider
  }).sort({ updatedAt: -1, createdAt: -1 });
}

async function cleanupDuplicateProviderConnections(userId, provider, keepConnectionId) {
  if (!keepConnectionId) {
    return;
  }

  const duplicates = await SourceConnection.find({
    user: userId,
    provider,
    _id: { $ne: keepConnectionId },
    status: { $ne: "disconnected" }
  }).select("+encryptedAccessToken +encryptedRefreshToken");

  if (!duplicates.length) {
    return;
  }

  for (const duplicate of duplicates) {
    duplicate.status = "disconnected";
    duplicate.health = "disconnected";
    duplicate.encryptedAccessToken = "";
    duplicate.encryptedRefreshToken = "";
    duplicate.tokenExpiresAt = null;
    duplicate.lastSyncResult = {
      importedCount: 0,
      skippedDuplicates: 0,
      updatedCount: 0,
      failedRecords: 0,
      message: `Replaced by the latest ${provider} connection.`
    };
    await duplicate.save();
  }
}

function dedupeConnections(connections = []) {
  const latestByProvider = new Map();

  for (const connection of connections) {
    const provider = connection.provider || connection.type;
    const current = latestByProvider.get(provider);

    if (!current) {
      latestByProvider.set(provider, connection);
      continue;
    }

    if (new Date(connection.updatedAt || connection.createdAt || 0).getTime() > new Date(current.updatedAt || current.createdAt || 0).getTime()) {
      latestByProvider.set(provider, connection);
    }
  }

  return Array.from(latestByProvider.values()).sort((left, right) => (
    new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime()
  ));
}

async function prepareGoogleConnection({
  userId,
  provider,
  label,
  selectors,
  settings,
  connectionId
}) {
  const normalizedSettings = normalizeSettings(settings || {});
  let connection = null;

  if (connectionId) {
    connection = await SourceConnection.findOne({
      _id: connectionId,
      user: userId,
      provider
    });
  }

  if (!connection) {
    connection = await findLatestProviderConnection(userId, provider);
  }

  if (!connection) {
    connection = new SourceConnection({
      user: userId,
      provider,
      type: provider,
      syncMode: "api",
      status: "needs-auth",
      health: "action-required"
    });
  }

  if (label !== undefined) {
    connection.label = String(label || "").trim() || defaultProviderLabel(provider);
  } else if (!connection.label) {
    connection.label = defaultProviderLabel(provider);
  }

  if (selectors !== undefined) {
    connection.selectors = normalizeCsv(selectors);
  }

  if (settings !== undefined) {
    connection.settings = mergeSettings(connection.settings, normalizedSettings);
  }

  if (!connection.status || connection.status === "disconnected") {
    connection.status = "needs-auth";
  }

  if (!connection.health || connection.health === "disconnected") {
    connection.health = "action-required";
  }

  await connection.save();
  return connection;
}

function withoutSecretSettings(settings = {}) {
  const safeSettings = { ...settings };
  delete safeSettings.botToken;
  return safeSettings;
}

function listFromSettings(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : normalizeCsv(value);
}

function mergeProviderMetadata(connection, metadata = {}) {
  connection.settings = {
    ...(connection.settings || {}),
    providerMetadata: {
      ...((connection.settings && connection.settings.providerMetadata) || {}),
      ...metadata
    }
  };
}

function buildLastSyncResult(connection, message) {
  return {
    importedCount: connection.lastSyncResult && Number.isFinite(connection.lastSyncResult.importedCount)
      ? connection.lastSyncResult.importedCount
      : 0,
    skippedDuplicates: connection.lastSyncResult && Number.isFinite(connection.lastSyncResult.skippedDuplicates)
      ? connection.lastSyncResult.skippedDuplicates
      : 0,
    updatedCount: connection.lastSyncResult && Number.isFinite(connection.lastSyncResult.updatedCount)
      ? connection.lastSyncResult.updatedCount
      : 0,
    failedRecords: connection.lastSyncResult && Number.isFinite(connection.lastSyncResult.failedRecords)
      ? connection.lastSyncResult.failedRecords
      : 0,
    message
  };
}

function applyTelegramFailure(connection, error, status = "error") {
  const diagnostics = error && error.diagnostics ? publicDiagnostics(error.diagnostics) : null;
  const message = diagnostics ? buildConnectivityMessage(diagnostics) : error.message;
  const setupRequiredCodes = new Set([
    "TELEGRAM_TOKEN_REQUIRED",
    "TELEGRAM_TOKEN_INVALID_FORMAT",
    "TELEGRAM_TOKEN_WHITESPACE"
  ]);
  const nextStatus = status === "error" && setupRequiredCodes.has(error.code)
    ? "setup-required"
    : status;

  connection.status = nextStatus;
  connection.health = nextStatus === "setup-required" ? "action-required" : "error";
  connection.errorState = {
    code: error.code || "TELEGRAM_BOT_VALIDATION_FAILED",
    message,
    occurredAt: new Date()
  };
  connection.lastSyncResult = buildLastSyncResult(connection, message);

  if (diagnostics) {
    mergeProviderMetadata(connection, {
      telegramDiagnostics: diagnostics
    });
  }
}

async function enrichTelegramConnectionWithChats(connection, options = {}) {
  const discovery = await discoverVisibleChats(connection, options);
  const chats = discovery.chats || [];
  const currentChatIds = listFromSettings(connection.settings && connection.settings.chatIds);
  let nextChatIds = currentChatIds;
  let autoApplied = false;

  if (!currentChatIds.length && chats.length === 1) {
    nextChatIds = [String(chats[0].chatId)];
    autoApplied = true;
  }

  connection.settings = {
    ...(connection.settings || {}),
    chatIds: nextChatIds,
    discoveredChats: chats,
    lastChatDiscoveryAt: new Date(),
    lastChatDiscoveryMessage: discovery.providerMetadata && discovery.providerMetadata.message
      ? discovery.providerMetadata.message
      : ""
  };

  if (nextChatIds[0]) {
    connection.providerAccountId = nextChatIds[0];
  }

  if (discovery.providerMetadata && discovery.providerMetadata.telegramDiagnostics) {
    mergeProviderMetadata(connection, {
      telegramDiagnostics: discovery.providerMetadata.telegramDiagnostics
    });
  }

  return {
    chats,
    autoApplied,
    providerMetadata: discovery.providerMetadata || {}
  };
}

function publicConnection(connection) {
  return {
    _id: connection._id,
    user: connection.user,
    type: connection.type,
    provider: connection.provider || connection.type,
    label: connection.label,
    selectors: connection.selectors || [],
    status: connection.status,
    syncMode: connection.syncMode,
    scopes: connection.scopes || [],
    providerAccountId: connection.providerAccountId,
    providerEmail: connection.providerEmail,
    settings: withoutSecretSettings(connection.settings || {}),
    lastSyncedAt: connection.lastSyncedAt,
    lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
    lastFailedSyncAt: connection.lastFailedSyncAt,
    lastSyncResult: connection.lastSyncResult,
    errorState: connection.errorState,
    health: connection.health,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt
  };
}

function isGoogleProvider(provider) {
  return provider === "google-classroom" || provider === "gmail";
}

router.get("/webhooks/telegram", (req, res) => {
  res.json({
    success: true,
    provider: "telegram",
    message: "Telegram webhook endpoint is ready. Configure it with setWebhook and X-Telegram-Bot-Api-Secret-Token."
  });
});

router.post("/webhooks/telegram", async (req, res, next) => {
  try {
    const secret = req.get("x-telegram-bot-api-secret-token") || "";
    const chatId = String(
      (req.body && req.body.message && req.body.message.chat && req.body.message.chat.id) ||
      (req.body && req.body.edited_message && req.body.edited_message.chat && req.body.edited_message.chat.id) ||
      (req.body && req.body.channel_post && req.body.channel_post.chat && req.body.channel_post.chat.id) ||
      (req.body && req.body.edited_channel_post && req.body.edited_channel_post.chat && req.body.edited_channel_post.chat.id) ||
      ""
    );
    const connectionQuery = {
      provider: "telegram",
      status: { $ne: "disconnected" },
      $or: []
    };

    if (chatId) {
      connectionQuery.$or.push(
        { providerAccountId: chatId },
        { "settings.chatIds": chatId }
      );
    }

    if (secret) {
      connectionQuery.$or.push({ "settings.webhookSecret": secret });
    }

    if (!connectionQuery.$or.length) {
      logger.warn("telegram.webhook.unroutable-update");
      return res.json({
        success: true,
        results: {
          received: 1,
          imported: 0,
          skipped: 1,
          failed: 0
        }
      });
    }

    const connection = await SourceConnection.findOne(connectionQuery);

    if (!connection) {
      logger.warn("telegram.webhook.no-connection", { chatId });
      return res.json({
        success: true,
        results: {
          received: 1,
          imported: 0,
          skipped: 1,
          failed: 0
        }
      });
    }

    if (!verifyWebhookSecret(secret, connection)) {
      return res.status(403).json({
        success: false,
        message: "Invalid Telegram webhook secret."
      });
    }

    const messages = extractWebhookMessages(req.body || {}, connection);
    const results = {
      received: messages.length,
      imported: 0,
      skipped: 0,
      failed: 0
    };

    for (const message of messages) {
      const user = await User.findById(connection.user).select("name email role");

      if (!user) {
        results.skipped += 1;
        continue;
      }

      try {
        const normalized = normalizeTelegramMessage(message, connection);

        if (!normalized) {
          results.skipped += 1;
          continue;
        }

        const outcome = await importNormalizedItem(normalized, connection, user);
        results[outcome.counter === "importedCount" ? "imported" : "skipped"] += 1;
        connection.lastSyncedAt = new Date();
        connection.lastSuccessfulSyncAt = connection.lastSyncedAt;
        connection.health = "healthy";
        connection.lastSyncResult = {
          importedCount: results.imported,
          skippedDuplicates: results.skipped,
          updatedCount: 0,
          failedRecords: results.failed,
          message: "Telegram webhook processed."
        };
        await connection.save();
        invalidateUserViewCaches([user._id]);
      } catch (error) {
        results.failed += 1;
        logger.warn("telegram.webhook.import-failed", {
          messageId: message.id,
          message: error.message
        });
      }
    }

    res.json({
      success: true,
      results
    });
  } catch (error) {
    next(error);
  }
});

router.get("/oauth/google/callback", async (req, res, next) => {
  try {
    const { code, error, state } = req.query;

    if (error) {
      return res.redirect(`/?integrationError=${encodeURIComponent(String(error))}`);
    }

    const statePayload = verifyState(state);
    const provider = statePayload.provider;
    const user = await User.findById(statePayload.userId).select("name email role");

    if (!user || !isGoogleProvider(provider)) {
      return res.redirect("/?integrationError=Invalid%20OAuth%20state");
    }

    const tokens = await exchangeCodeForTokens(code);
    const googleProfile = await fetchGoogleUserInfo(tokens.access_token);
    const existingByAccount = await SourceConnection.findOne({
      user: user._id,
      provider,
      providerAccountId: googleProfile.id || googleProfile.email
    }).select("+encryptedAccessToken +encryptedRefreshToken");
    let connection = null;

    if (statePayload.connectionId) {
      connection = await SourceConnection.findOne({
        _id: statePayload.connectionId,
        user: user._id,
        provider
      }).select("+encryptedAccessToken +encryptedRefreshToken");
    }

    if (connection && existingByAccount && String(connection._id) !== String(existingByAccount._id)) {
      existingByAccount.label = connection.label || existingByAccount.label;
      existingByAccount.selectors = connection.selectors && connection.selectors.length
        ? connection.selectors
        : existingByAccount.selectors;
      existingByAccount.settings = mergeSettings(existingByAccount.settings, connection.settings);
      await SourceConnection.deleteOne({ _id: connection._id });
      connection = existingByAccount;
    }

    if (!connection) {
      connection = existingByAccount || new SourceConnection({
        user: user._id,
        provider,
        type: provider
      });
    }

    if (!connection.label || connection.label === defaultProviderLabel(provider)) {
      connection.label = provider === "gmail"
        ? `Gmail (${googleProfile.email || "connected account"})`
        : `Google Classroom (${googleProfile.email || "connected account"})`;
    }
    connection.providerAccountId = googleProfile.id || googleProfile.email || "";
    connection.providerEmail = googleProfile.email || "";
    connection.encryptedAccessToken = encryptSecret(tokens.access_token);

    if (tokens.refresh_token) {
      connection.encryptedRefreshToken = encryptSecret(tokens.refresh_token);
    }

    connection.tokenExpiresAt = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000);
    connection.scopes = String(tokens.scope || "").split(" ").filter(Boolean);
    connection.status = "connected";
    connection.health = "healthy";
    connection.syncMode = "api";
    connection.errorState = {
      code: "",
      message: "",
      occurredAt: null
    };
    await connection.save();

    logger.info("integration.oauth.connected", {
      provider,
      userId: user._id,
      connectionId: connection._id
    });

    res.redirect(`/?integrationConnected=${encodeURIComponent(provider)}`);
  } catch (error) {
    logger.error("integration.oauth.callback-failed", {
      message: error.message
    });
    next(error);
  }
});

router.use(auth);

router.get("/", async (req, res, next) => {
  try {
    const connections = await SourceConnection.find({ user: req.user._id }).sort({ createdAt: -1 });

    res.json({
      success: true,
      connections: dedupeConnections(connections).map(publicConnection)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/oauth/:provider/start", validate(providerParamSchema, "params"), async (req, res, next) => {
  try {
    const { provider } = req.params;

    if (!isGoogleProvider(provider)) {
      return res.status(400).json({
        success: false,
        message: "OAuth is only available for Google Classroom and Gmail."
      });
    }

    const body = req.body || {};
    const hasConnectionConfig =
      Object.prototype.hasOwnProperty.call(body, "label") ||
      Object.prototype.hasOwnProperty.call(body, "selectors") ||
      Object.prototype.hasOwnProperty.call(body, "settings") ||
      Object.prototype.hasOwnProperty.call(body, "connectionId");

    const connection = await prepareGoogleConnection({
      userId: req.user._id,
      provider,
      label: hasConnectionConfig ? body.label : undefined,
      selectors: hasConnectionConfig ? body.selectors : undefined,
      settings: hasConnectionConfig ? body.settings : undefined,
      connectionId: body.connectionId || ""
    });

    res.json({
      success: true,
      connection: publicConnection(connection),
      authUrl: buildGoogleAuthUrl({
        provider,
        userId: req.user._id,
        connectionId: connection._id
      })
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/telegram/discover-chats", async (req, res, next) => {
  let connection = null;
  try {
    connection = await findConnectionWithSecrets({
      _id: req.params.id,
      user: req.user._id
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: "Integration not found."
      });
    }

    if ((connection.provider || connection.type) !== "telegram") {
      return res.status(400).json({
        success: false,
        message: "Chat discovery is only available for Telegram."
      });
    }

    const discovery = await enrichTelegramConnectionWithChats(connection, { limit: 100 });
    connection.status = "connected";
    connection.health = "healthy";
    connection.errorState = {
      code: "",
      message: "",
      occurredAt: null
    };
    connection.lastSyncResult = buildLastSyncResult(
      connection,
      discovery.autoApplied
        ? "Telegram is reachable. Found 1 visible chat and saved it automatically."
        : discovery.providerMetadata.message || "Telegram chat discovery completed."
    );
    await connection.save();

    res.json({
      success: true,
      chats: discovery.chats,
      autoApplied: discovery.autoApplied,
      providerMetadata: discovery.providerMetadata,
      connection: publicConnection(connection),
      message: discovery.autoApplied
        ? "Found 1 visible Telegram chat and saved it automatically."
        : discovery.chats.length
          ? `Found ${discovery.chats.length} visible Telegram chats.`
          : discovery.providerMetadata.message || "No bot-visible Telegram chats found yet."
    });
  } catch (error) {
    if (connection) {
      applyTelegramFailure(connection, error);
      await connection.save().catch(() => {});
    }
    next(error);
  }
});

router.post("/:id/telegram/test", async (req, res, next) => {
  let connection = null;

  try {
    connection = await findConnectionWithSecrets({
      _id: req.params.id,
      user: req.user._id
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: "Integration not found."
      });
    }

    if ((connection.provider || connection.type) !== "telegram") {
      return res.status(400).json({
        success: false,
        message: "Telegram diagnostics are only available for Telegram integrations."
      });
    }

    const testResult = await testTelegramConnection(connection);
    connection.status = "connected";
    connection.health = testResult.botProfile.canReadAllGroupMessages ? "healthy" : "limited";
    connection.errorState = {
      code: "",
      message: "",
      occurredAt: null
    };
    connection.providerEmail = testResult.botProfile.username ? `@${testResult.botProfile.username}` : connection.providerEmail;
    mergeProviderMetadata(connection, {
      telegramDiagnostics: testResult.diagnostics
    });
    const successMessage = testResult.botProfile.username
      ? `Telegram Bot API is reachable as @${testResult.botProfile.username}.`
      : "Telegram Bot API is reachable.";
    connection.lastSyncResult = buildLastSyncResult(connection, successMessage);
    await connection.save();

    res.json({
      success: true,
      message: successMessage,
      diagnostics: testResult.diagnostics,
      botProfile: testResult.botProfile,
      connection: publicConnection(connection)
    });
  } catch (error) {
    if (connection) {
      applyTelegramFailure(connection, error);
      await connection.save().catch(() => {});
    }
    next(error);
  }
});

router.post("/", validate(integrationCreateSchema), async (req, res, next) => {
  try {
    const { type, label, selectors, syncMode, providerAccountId, providerEmail, settings } = req.body;
    const provider = type;
    const normalizedSettings = normalizeSettings(settings || {});
    const botToken = provider === "telegram" ? normalizedSettings.botToken : "";
    delete normalizedSettings.botToken;

    if (isGoogleProvider(provider)) {
      return res.status(400).json({
        success: false,
        message: "Use the secure Connect OAuth button for Google Classroom and Gmail."
      });
    }

    let connection = await findLatestProviderConnection(req.user._id, provider);

    if (!connection || connection.status === "disconnected") {
      connection = new SourceConnection({
        user: req.user._id,
        type: provider,
        provider
      });
    }

    connection.label = label;
    connection.selectors = normalizeCsv(selectors);
    connection.syncMode = provider === "telegram"
      ? normalizedSettings.pollingEnabled === false
        ? "webhook"
        : "api"
      : (syncMode || "webhook");
    connection.status = provider === "telegram" && botToken ? "connected" : "setup-required";
    connection.health = provider === "telegram" && botToken ? "limited" : "action-required";
    connection.providerAccountId = providerAccountId || normalizedSettings.chatIds?.[0] || connection.providerAccountId || "";
    connection.providerEmail = providerEmail || connection.providerEmail || "";
    connection.settings = {
      ...(connection.settings || {}),
      ...normalizedSettings
    };
    connection.lastSyncResult = {
      importedCount: 0,
      skippedDuplicates: 0,
      updatedCount: 0,
      failedRecords: 0,
      message: provider === "telegram"
        ? "Connection created. Add a Telegram bot token and approved chat IDs before syncing."
        : "Connection created. Complete provider setup before syncing."
    };

    if (provider === "telegram" && botToken) {
      connection.encryptedAccessToken = encryptSecret(botToken);
    }

    await connection.save();

    if (provider === "telegram" && botToken) {
      try {
        const healthCheck = await testTelegramConnection(connection);
        const botProfile = healthCheck.botProfile;
        connection.status = "connected";
        connection.health = botProfile.canReadAllGroupMessages ? "healthy" : "limited";
        connection.providerEmail = botProfile.username ? `@${botProfile.username}` : "";
        connection.settings = {
          ...(connection.settings || {}),
          botUsername: botProfile.username || normalizedSettings.botUsername || "",
          canJoinGroups: botProfile.canJoinGroups,
          canReadAllGroupMessages: botProfile.canReadAllGroupMessages
        };
        mergeProviderMetadata(connection, {
          telegramDiagnostics: healthCheck.diagnostics
        });
        connection.lastSyncResult.message = botProfile.canReadAllGroupMessages
          ? "Telegram bot connected. Group-wide messages are visible to the bot."
          : "Telegram bot connected. Privacy mode may limit group message visibility unless disabled in BotFather or the bot is mentioned/replied to.";

        try {
          const discovery = await enrichTelegramConnectionWithChats(connection, { limit: 100 });

          if (discovery.autoApplied) {
            connection.lastSyncResult.message = "Telegram bot connected. Found 1 visible chat and saved its chat ID automatically.";
          } else if (discovery.chats.length) {
            connection.lastSyncResult.message = `Telegram bot connected. Found ${discovery.chats.length} visible chats. Use Discover Chats if you want to refresh them later.`;
          }
        } catch (discoveryError) {
          logger.warn("telegram.discovery.failed", {
            connectionId: connection._id,
            message: discoveryError.message
          });
        }

        await connection.save();
      } catch (error) {
        applyTelegramFailure(connection, error);
        await connection.save();
      }
    }

    await cleanupDuplicateProviderConnections(req.user._id, provider, connection._id);

    res.status(201).json({
      success: true,
      connection: publicConnection(connection)
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", validate(integrationSettingsSchema), async (req, res, next) => {
  try {
    const connection = await SourceConnection.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: "Integration not found."
      });
    }

    if (req.body.label) {
      connection.label = req.body.label;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "selectors")) {
      connection.selectors = normalizeCsv(req.body.selectors);
    }

    if (req.body.status) {
      connection.status = req.body.status;
      connection.health = req.body.status === "disconnected" ? "disconnected" : connection.health;
    }

    if (req.body.settings) {
      const nextSettings = normalizeSettings(req.body.settings);
      const nextBotToken = connection.provider === "telegram" ? nextSettings.botToken : "";
      delete nextSettings.botToken;

      connection.settings = {
        ...(connection.settings || {}),
        ...nextSettings
      };

      if (nextBotToken) {
        connection.encryptedAccessToken = encryptSecret(nextBotToken);
      }

      if (connection.provider === "telegram" && Array.isArray(connection.settings.chatIds) && connection.settings.chatIds[0]) {
        connection.providerAccountId = connection.settings.chatIds[0];
      }

      if (connection.provider === "telegram") {
        if (Object.prototype.hasOwnProperty.call(nextSettings, "pollingEnabled")) {
          connection.syncMode = nextSettings.pollingEnabled === false ? "webhook" : "api";
        }

        try {
          if (!connection.encryptedAccessToken) {
            const error = new Error("Telegram bot token is missing. Add a bot token before testing or syncing Telegram.");
            error.code = "TELEGRAM_TOKEN_REQUIRED";
            throw error;
          }

          const healthCheck = await testTelegramConnection(connection);
          const botProfile = healthCheck.botProfile;
          connection.status = "connected";
          connection.health = botProfile.canReadAllGroupMessages ? "healthy" : "limited";
          connection.providerEmail = botProfile.username ? `@${botProfile.username}` : connection.providerEmail;
          connection.settings = {
            ...(connection.settings || {}),
            botUsername: botProfile.username || connection.settings.botUsername || "",
            canJoinGroups: botProfile.canJoinGroups,
            canReadAllGroupMessages: botProfile.canReadAllGroupMessages
          };
          mergeProviderMetadata(connection, {
            telegramDiagnostics: healthCheck.diagnostics
          });
          connection.errorState = {
            code: "",
            message: "",
            occurredAt: null
          };

          try {
            const discovery = await enrichTelegramConnectionWithChats(connection, { limit: 100 });

            if (discovery.autoApplied) {
              connection.lastSyncResult = {
                ...(connection.lastSyncResult || {}),
                message: "Telegram bot updated. Found 1 visible chat and saved its chat ID automatically."
              };
            } else if (discovery.chats.length) {
              connection.lastSyncResult = {
                ...(connection.lastSyncResult || {}),
                message: `Telegram bot updated. Found ${discovery.chats.length} visible chats. Use Discover Chats to refresh them any time.`
              };
            }
          } catch (discoveryError) {
            logger.warn("telegram.discovery.failed", {
              connectionId: connection._id,
              message: discoveryError.message
            });
          }
        } catch (error) {
          applyTelegramFailure(connection, error);
        }
      }
    }

    await connection.save();
    await cleanupDuplicateProviderConnections(req.user._id, connection.provider || connection.type, connection._id);
    invalidateUserViewCaches([req.user._id]);

    res.json({
      success: true,
      connection: publicConnection(connection)
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const connection = await SourceConnection.findOne({
      _id: req.params.id,
      user: req.user._id
    }).select("+encryptedAccessToken +encryptedRefreshToken");

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: "Integration not found."
      });
    }

    connection.status = "disconnected";
    connection.health = "disconnected";
    connection.encryptedAccessToken = "";
    connection.encryptedRefreshToken = "";
    connection.tokenExpiresAt = null;
    await connection.save();
    invalidateUserViewCaches([req.user._id]);

    res.json({
      success: true,
      message: "Integration disconnected."
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/sync", validate(integrationSyncSchema), async (req, res, next) => {
  try {
    const connection = await findConnectionWithSecrets({
      _id: req.params.id,
      user: req.user._id
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: "Integration not found."
      });
    }

    const result = await syncConnection(connection, req.user, req.body);

    res.json({
      success: true,
      importedCount: result.importedCount,
      skippedDuplicates: result.skippedDuplicates,
      updatedCount: result.updatedCount,
      failedRecords: result.failedRecords,
      assignmentImports: result.assignmentImports,
      reminderImports: result.reminderImports,
      announcementImports: result.announcementImports,
      providerMetadata: result.providerMetadata,
      assignments: result.assignments,
      reminders: result.reminders
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
