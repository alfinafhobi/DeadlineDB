const dns = require("dns");
const http = require("http");
const https = require("https");
const net = require("net");
const tls = require("tls");
const { URL } = require("url");

const appConfig = require("../config/appConfig");
const { decryptSecret } = require("./secureTokenService");
const { normalizeTelegramMessage } = require("./providerNormalizationService");
const logger = require("../utils/logger");

let HttpsProxyAgent = null;

try {
  ({ HttpsProxyAgent } = require("https-proxy-agent"));
} catch (error) {
  HttpsProxyAgent = null;
}

const TELEGRAM_TOKEN_PATTERN = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;
const TELEGRAM_ALLOWED_UPDATES = ["message", "edited_message", "channel_post", "edited_channel_post"];
let telegramRequestExecutor = executeTelegramRequest;

function sanitizeBotToken(value) {
  return String(value || "").trim();
}

function validateTelegramTokenFormat(value) {
  const token = sanitizeBotToken(value);

  if (!token) {
    return {
      valid: false,
      code: "TELEGRAM_TOKEN_REQUIRED",
      reason: "Telegram bot token is missing."
    };
  }

  if (/\s/.test(token)) {
    return {
      valid: false,
      code: "TELEGRAM_TOKEN_WHITESPACE",
      reason: "Telegram bot token contains unexpected whitespace."
    };
  }

  if (!TELEGRAM_TOKEN_PATTERN.test(token)) {
    return {
      valid: false,
      code: "TELEGRAM_TOKEN_INVALID_FORMAT",
      reason: "Telegram bot token format is invalid."
    };
  }

  return {
    valid: true,
    code: "",
    reason: "",
    token
  };
}

function normalizeProxyUrl(proxyUrl) {
  if (!proxyUrl) {
    return "";
  }

  const trimmed = String(proxyUrl).trim();

  if (!trimmed) {
    return "";
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

function getConfiguredProxyUrl() {
  return normalizeProxyUrl(appConfig.telegramProxyUrl || "");
}

function getPreferredIpFamily() {
  return appConfig.telegramIpFamily === 4 || appConfig.telegramIpFamily === 6
    ? appConfig.telegramIpFamily
    : undefined;
}

function buildTelegramEndpoint(token, method) {
  const base = new URL(appConfig.telegramApiBaseUrl || "https://api.telegram.org");

  if (base.protocol !== "https:" && base.protocol !== "http:") {
    const error = new Error("Telegram API base URL must use http or https.");
    error.code = "TELEGRAM_API_BASE_INVALID";
    throw error;
  }

  const sanitizedMethod = String(method || "").trim().replace(/^\/+/, "");

  if (!sanitizedMethod) {
    const error = new Error("Telegram API method is required.");
    error.code = "TELEGRAM_METHOD_REQUIRED";
    throw error;
  }

  return new URL(`/bot${token}/${sanitizedMethod}`, ensureTrailingSlash(base));
}

function ensureTrailingSlash(url) {
  const value = String(url);
  return value.endsWith("/") ? value : `${value}/`;
}

function maskTelegramEndpoint(endpoint) {
  return String(endpoint || "").replace(/\/bot[^/]+\//, "/bot<redacted>/");
}

function maskProxyUrl(proxyUrl) {
  if (!proxyUrl) {
    return "";
  }

  try {
    const parsed = new URL(proxyUrl);

    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? "<redacted>" : "";
      parsed.password = parsed.password ? "<redacted>" : "";
    }

    return parsed.toString();
  } catch (error) {
    return "<invalid-proxy-url>";
  }
}

function createDiagnostics(method, endpoint, token, proxyUrl) {
  const ipFamily = getPreferredIpFamily();

  return {
    method,
    endpoint: maskTelegramEndpoint(endpoint.toString()),
    host: endpoint.hostname,
    port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
    ipFamily: ipFamily || 0,
    requestTimeoutMs: appConfig.telegramRequestTimeoutMs,
    token: {
      valid: true,
      formatValid: true,
      botIdPrefix: String(token).split(":")[0] || ""
    },
    proxy: {
      configured: Boolean(proxyUrl),
      supported: Boolean(!proxyUrl || HttpsProxyAgent),
      url: proxyUrl ? maskProxyUrl(proxyUrl) : ""
    },
    dns: {
      ok: false,
      addresses: [],
      errorCode: "",
      errorMessage: ""
    },
    tcp: {
      attempted: !proxyUrl,
      ok: false,
      remoteAddress: "",
      remotePort: 0,
      family: "",
      errorCode: "",
      errorMessage: ""
    },
    tls: {
      attempted: !proxyUrl,
      ok: false,
      authorized: false,
      authorizationError: "",
      errorCode: "",
      errorMessage: ""
    },
    request: {
      ok: false,
      httpStatus: 0,
      telegramOk: false,
      errorCode: "",
      errorMessage: "",
      responseDescription: "",
      socketLookup: "",
      tcpConnected: false,
      tlsEstablished: false,
      timeout: false
    }
  };
}

function getBotToken(connection) {
  const token = sanitizeBotToken(decryptSecret(connection.encryptedAccessToken));
  const validation = validateTelegramTokenFormat(token);

  if (!validation.valid) {
    const error = new Error(validation.reason);
    error.code = validation.code;
    error.diagnostics = {
      token: {
        valid: false,
        formatValid: false,
        reason: validation.reason
      }
    };
    throw error;
  }

  return validation.token;
}

function buildTransportAgent(proxyUrl, protocol) {
  if (proxyUrl) {
    if (!HttpsProxyAgent) {
      const error = new Error(
        "Telegram proxy support is configured, but https-proxy-agent is not installed. Run npm install to enable proxy-based Telegram access."
      );
      error.code = "TELEGRAM_PROXY_AGENT_MISSING";
      throw error;
    }

    return new HttpsProxyAgent(proxyUrl);
  }

  const family = getPreferredIpFamily();
  const options = {
    keepAlive: false
  };

  if (family) {
    options.family = family;
  }

  return protocol === "http:" ? new http.Agent(options) : new https.Agent(options);
}

async function resolveDnsDiagnostics(hostname) {
  try {
    const addresses = await dns.promises.lookup(hostname, {
      all: true,
      verbatim: true
    });

    return {
      ok: true,
      addresses: (addresses || []).map((entry) => ({
        address: entry.address,
        family: entry.family
      })),
      errorCode: "",
      errorMessage: ""
    };
  } catch (error) {
    return {
      ok: false,
      addresses: [],
      errorCode: error.code || "",
      errorMessage: error.message
    };
  }
}

async function probeTcpConnection(hostname, port, family, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({
      host: hostname,
      port,
      family
    });

    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      finish({
        attempted: true,
        ok: true,
        remoteAddress: socket.remoteAddress || "",
        remotePort: socket.remotePort || port,
        family: socket.remoteFamily || "",
        errorCode: "",
        errorMessage: ""
      });
    });

    socket.once("timeout", () => {
      finish({
        attempted: true,
        ok: false,
        remoteAddress: socket.remoteAddress || "",
        remotePort: socket.remotePort || 0,
        family: socket.remoteFamily || "",
        errorCode: "TCP_TIMEOUT",
        errorMessage: `TCP connection to ${hostname}:${port} timed out.`
      });
    });

    socket.once("error", (error) => {
      finish({
        attempted: true,
        ok: false,
        remoteAddress: socket.remoteAddress || "",
        remotePort: socket.remotePort || 0,
        family: socket.remoteFamily || "",
        errorCode: error.code || "",
        errorMessage: error.message
      });
    });
  });
}

async function probeTlsHandshake(hostname, port, family, timeoutMs) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: hostname,
      port,
      family,
      servername: hostname,
      rejectUnauthorized: true
    });

    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.once("secureConnect", () => {
      finish({
        attempted: true,
        ok: true,
        authorized: socket.authorized,
        authorizationError: socket.authorizationError || "",
        errorCode: "",
        errorMessage: ""
      });
    });

    socket.once("timeout", () => {
      finish({
        attempted: true,
        ok: false,
        authorized: false,
        authorizationError: "",
        errorCode: "TLS_TIMEOUT",
        errorMessage: `TLS handshake with ${hostname}:${port} timed out.`
      });
    });

    socket.once("error", (error) => {
      finish({
        attempted: true,
        ok: false,
        authorized: false,
        authorizationError: "",
        errorCode: error.code || "",
        errorMessage: error.message
      });
    });
  });
}

async function runDirectDiagnostics(diagnostics) {
  diagnostics.dns = await resolveDnsDiagnostics(diagnostics.host);

  if (!diagnostics.dns.ok) {
    return diagnostics;
  }

  if (diagnostics.proxy.configured) {
    diagnostics.tcp.attempted = false;
    diagnostics.tls.attempted = false;
    return diagnostics;
  }

  const family = diagnostics.ipFamily || undefined;
  diagnostics.tcp = await probeTcpConnection(
    diagnostics.host,
    diagnostics.port,
    family,
    diagnostics.requestTimeoutMs
  );

  if (!diagnostics.tcp.ok) {
    return diagnostics;
  }

  diagnostics.tls = await probeTlsHandshake(
    diagnostics.host,
    diagnostics.port,
    family,
    diagnostics.requestTimeoutMs
  );

  return diagnostics;
}

async function executeTelegramRequest(connection, method, body = {}) {
  const token = getBotToken(connection);
  const proxyUrl = getConfiguredProxyUrl();
  const endpoint = buildTelegramEndpoint(token, method);
  const diagnostics = createDiagnostics(method, endpoint, token, proxyUrl);

  logger.info("telegram.request.started", {
    endpoint: diagnostics.endpoint,
    method,
    proxyConfigured: diagnostics.proxy.configured,
    ipFamily: diagnostics.ipFamily || 0
  });

  await runDirectDiagnostics(diagnostics);

  if (diagnostics.proxy.configured && !diagnostics.proxy.supported) {
    throw buildTelegramError(
      "TELEGRAM_PROXY_AGENT_MISSING",
      "Telegram proxy support is configured, but https-proxy-agent is not installed. Run npm install or clear TELEGRAM_PROXY_URL.",
      diagnostics
    );
  }

  if (!diagnostics.dns.ok) {
    throw buildTelegramError(
      "TELEGRAM_DNS_LOOKUP_FAILED",
      `DNS lookup for ${diagnostics.host} failed: ${diagnostics.dns.errorMessage}`,
      diagnostics
    );
  }

  if (!diagnostics.proxy.configured && !diagnostics.tcp.ok) {
    throw buildTelegramError(
      "TELEGRAM_TCP_CONNECT_FAILED",
      `TCP connection to ${diagnostics.host}:${diagnostics.port} failed: ${diagnostics.tcp.errorMessage}`,
      diagnostics
    );
  }

  if (!diagnostics.proxy.configured && diagnostics.tcp.ok && !diagnostics.tls.ok) {
    throw buildTelegramError(
      "TELEGRAM_TLS_HANDSHAKE_FAILED",
      `TCP reached ${diagnostics.tcp.remoteAddress || diagnostics.host}:${diagnostics.port}, but the TLS handshake with ${diagnostics.host} did not complete. This usually indicates Telegram HTTPS is being blocked or intercepted on the current network.`,
      diagnostics
    );
  }

  const transport = endpoint.protocol === "http:" ? http : https;
  const agent = buildTransportAgent(proxyUrl, endpoint.protocol);

  try {
    const response = await new Promise((resolve, reject) => {
      const request = transport.request(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        agent,
        family: diagnostics.ipFamily || undefined,
        timeout: diagnostics.requestTimeoutMs,
        servername: endpoint.hostname
      }, (res) => {
        let responseBody = "";

        diagnostics.request.httpStatus = Number(res.statusCode || 0);

        res.on("data", (chunk) => {
          responseBody += chunk;
        });

        res.on("end", () => {
          try {
            const payload = JSON.parse(responseBody || "{}");
            resolve({
              payload,
              statusCode: Number(res.statusCode || 0)
            });
          } catch (error) {
            reject(buildTelegramError(
              "TELEGRAM_RESPONSE_PARSE_FAILED",
              "Telegram returned a response that could not be parsed as JSON.",
              diagnostics,
              {
                cause: error,
                rawResponse: responseBody.slice(0, 500)
              }
            ));
          }
        });
      });

      request.on("socket", (socket) => {
        socket.on("lookup", (error, address, family, host) => {
          diagnostics.request.socketLookup = error
            ? `lookup failed: ${error.message}`
            : `${address} family=${family} host=${host}`;
        });
        socket.on("connect", () => {
          diagnostics.request.tcpConnected = true;
        });
        socket.on("secureConnect", () => {
          diagnostics.request.tlsEstablished = true;
        });
        socket.on("error", (error) => {
          diagnostics.request.errorCode = error.code || diagnostics.request.errorCode;
          diagnostics.request.errorMessage = error.message;
        });
      });

      request.on("timeout", () => {
        diagnostics.request.timeout = true;
        request.destroy(buildTelegramError(
          "TELEGRAM_REQUEST_TIMEOUT",
          "Telegram Bot API request timed out before a response was received.",
          diagnostics
        ));
      });

      request.on("error", (error) => {
        reject(normalizeTelegramRequestError(error, diagnostics));
      });

      request.write(JSON.stringify(body));
      request.end();
    });

    const payload = response.payload || {};
    diagnostics.request.telegramOk = Boolean(payload.ok);
    diagnostics.request.responseDescription = payload.description || "";

    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300 || payload.ok === false) {
      throw normalizeTelegramApiFailure(response.statusCode, payload, diagnostics);
    }

    diagnostics.request.ok = true;

    logger.info("telegram.request.succeeded", {
      endpoint: diagnostics.endpoint,
      method,
      httpStatus: diagnostics.request.httpStatus
    });

    return {
      result: payload.result,
      diagnostics,
      payload,
      statusCode: response.statusCode
    };
  } catch (error) {
    if (!error.diagnostics) {
      error.diagnostics = diagnostics;
    }

    logger.warn("telegram.request.failed", {
      endpoint: diagnostics.endpoint,
      method,
      code: error.code || "",
      message: error.message,
      diagnostics: summarizeDiagnosticsForLogs(error.diagnostics)
    });

    throw error;
  }
}

function normalizeTelegramApiFailure(statusCode, payload, diagnostics) {
  const description = payload && payload.description ? payload.description : "Telegram Bot API rejected the request.";
  const normalized = description.toLowerCase();
  let code = "TELEGRAM_API_REJECTED";
  let message = description;

  if (normalized.includes("unauthorized") || normalized.includes("not found")) {
    code = "TELEGRAM_INVALID_TOKEN";
    message = "Telegram rejected the bot token. Check that the token is complete, current, and belongs to the intended bot.";
  } else if (statusCode === 429) {
    code = "TELEGRAM_RATE_LIMITED";
    message = "Telegram rate-limited the bot request. Wait a moment and try again.";
  }

  diagnostics.request.errorCode = payload && payload.error_code ? String(payload.error_code) : String(statusCode || "");
  diagnostics.request.errorMessage = description;

  return buildTelegramError(code, message, diagnostics, {
    status: statusCode,
    providerCode: payload && payload.error_code ? payload.error_code : ""
  });
}

function normalizeTelegramRequestError(error, diagnostics) {
  if (error && error.code && String(error.code).startsWith("TELEGRAM_")) {
    return error;
  }

  if (error && (error.name === "AbortError" || error.code === "ABORT_ERR")) {
    return buildTelegramError(
      "TELEGRAM_REQUEST_TIMEOUT",
      "Telegram Bot API request timed out before a response was received.",
      diagnostics
    );
  }

  const networkCode = error && error.code ? String(error.code) : "";
  const networkMessage = error && error.message ? error.message : "Telegram request failed.";

  if (networkCode === "ENOTFOUND") {
    return buildTelegramError(
      "TELEGRAM_DNS_LOOKUP_FAILED",
      `DNS lookup for ${diagnostics.host} failed: ${networkMessage}`,
      diagnostics
    );
  }

  if (networkCode === "ECONNREFUSED" || networkCode === "EHOSTUNREACH" || networkCode === "ENETUNREACH") {
    return buildTelegramError(
      "TELEGRAM_TCP_CONNECT_FAILED",
      `TCP connection to ${diagnostics.host}:${diagnostics.port} failed: ${networkMessage}`,
      diagnostics
    );
  }

  if (networkCode === "ECONNRESET" || networkCode === "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR") {
    return buildTelegramError(
      "TELEGRAM_TLS_HANDSHAKE_FAILED",
      `The HTTPS connection to ${diagnostics.host} was interrupted during TLS negotiation: ${networkMessage}`,
      diagnostics
    );
  }

  if (networkMessage === "fetch failed") {
    return buildTelegramError(
      "TELEGRAM_API_NETWORK_ERROR",
      `Telegram Bot API could not be reached from this machine while calling ${diagnostics.endpoint}.`,
      diagnostics
    );
  }

  return buildTelegramError(
    "TELEGRAM_API_NETWORK_ERROR",
    `Telegram Bot API request failed: ${networkMessage}`,
    diagnostics
  );
}

function buildTelegramError(code, message, diagnostics, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.diagnostics = diagnostics;
  error.statusCode = extra.statusCode || telegramStatusCodeForError(code, extra.status);
  Object.assign(error, extra);
  return error;
}

function telegramStatusCodeForError(code, providerStatus) {
  if (Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus <= 599) {
    return providerStatus;
  }

  if (["TELEGRAM_TOKEN_REQUIRED", "TELEGRAM_TOKEN_INVALID_FORMAT", "TELEGRAM_TOKEN_WHITESPACE"].includes(code)) {
    return 400;
  }

  if (code === "TELEGRAM_INVALID_TOKEN") {
    return 401;
  }

  if (code === "TELEGRAM_RATE_LIMITED") {
    return 429;
  }

  if ([
    "TELEGRAM_DNS_LOOKUP_FAILED",
    "TELEGRAM_TCP_CONNECT_FAILED",
    "TELEGRAM_TLS_HANDSHAKE_FAILED",
    "TELEGRAM_REQUEST_TIMEOUT",
    "TELEGRAM_API_NETWORK_ERROR"
  ].includes(code)) {
    return 503;
  }

  return 500;
}

function summarizeDiagnosticsForLogs(diagnostics = {}) {
  return {
    endpoint: diagnostics.endpoint,
    proxyConfigured: diagnostics.proxy && diagnostics.proxy.configured,
    dnsOk: diagnostics.dns && diagnostics.dns.ok,
    tcpOk: diagnostics.tcp && diagnostics.tcp.ok,
    tlsOk: diagnostics.tls && diagnostics.tls.ok,
    httpStatus: diagnostics.request && diagnostics.request.httpStatus,
    requestErrorCode: diagnostics.request && diagnostics.request.errorCode,
    requestErrorMessage: diagnostics.request && diagnostics.request.errorMessage
  };
}

function publicDiagnostics(diagnostics = {}) {
  return {
    endpoint: diagnostics.endpoint || "",
    host: diagnostics.host || "",
    port: diagnostics.port || 0,
    ipFamily: diagnostics.ipFamily || 0,
    requestTimeoutMs: diagnostics.requestTimeoutMs || 0,
    proxy: diagnostics.proxy || {
      configured: false,
      supported: true,
      url: ""
    },
    dns: diagnostics.dns || {
      ok: false,
      addresses: [],
      errorCode: "",
      errorMessage: ""
    },
    tcp: diagnostics.tcp || {
      attempted: false,
      ok: false,
      remoteAddress: "",
      remotePort: 0,
      family: "",
      errorCode: "",
      errorMessage: ""
    },
    tls: diagnostics.tls || {
      attempted: false,
      ok: false,
      authorized: false,
      authorizationError: "",
      errorCode: "",
      errorMessage: ""
    },
    request: diagnostics.request || {
      ok: false,
      httpStatus: 0,
      telegramOk: false,
      errorCode: "",
      errorMessage: "",
      responseDescription: "",
      socketLookup: "",
      tcpConnected: false,
      tlsEstablished: false,
      timeout: false
    },
    token: diagnostics.token || {
      valid: false,
      formatValid: false,
      botIdPrefix: ""
    }
  };
}

function buildConnectivityMessage(diagnostics) {
  if (!diagnostics) {
    return "Telegram connectivity diagnostics are unavailable.";
  }

  if (!diagnostics.token || !diagnostics.token.formatValid) {
    return diagnostics.token && diagnostics.token.reason
      ? diagnostics.token.reason
      : "Telegram bot token is missing or malformed.";
  }

  if (diagnostics.proxy && diagnostics.proxy.configured && !diagnostics.proxy.supported) {
    return "A Telegram proxy URL is configured, but proxy support is not installed. Run npm install or clear TELEGRAM_PROXY_URL.";
  }

  if (diagnostics.dns && !diagnostics.dns.ok) {
    return `DNS lookup failed for ${diagnostics.host}: ${diagnostics.dns.errorMessage}`;
  }

  if (diagnostics.tcp && diagnostics.tcp.attempted && !diagnostics.tcp.ok) {
    return `TCP connection to ${diagnostics.host}:${diagnostics.port} failed: ${diagnostics.tcp.errorMessage}`;
  }

  if (diagnostics.tls && diagnostics.tls.attempted && !diagnostics.tls.ok) {
    return `TCP connected to ${diagnostics.tcp.remoteAddress || diagnostics.host}:${diagnostics.port}, but the TLS handshake with ${diagnostics.host} stalled or failed. This usually points to Telegram HTTPS being blocked or intercepted on the current network.`;
  }

  if (diagnostics.request && diagnostics.request.timeout) {
    return `Telegram Bot API request to ${diagnostics.endpoint || diagnostics.host} timed out after ${diagnostics.requestTimeoutMs} ms.`;
  }

  if (diagnostics.request && diagnostics.request.errorMessage) {
    return `Telegram Bot API request failed after connection setup: ${diagnostics.request.errorMessage}`;
  }

  if (diagnostics.request && diagnostics.request.httpStatus >= 400) {
    return diagnostics.request.responseDescription || `Telegram returned HTTP ${diagnostics.request.httpStatus}.`;
  }

  return "Telegram Bot API is reachable.";
}

async function testTelegramConnection(connection) {
  const token = sanitizeBotToken(decryptSecret(connection.encryptedAccessToken));
  const tokenValidation = validateTelegramTokenFormat(token);

  if (!tokenValidation.valid) {
    const diagnostics = {
      token: {
        valid: false,
        formatValid: false,
        reason: tokenValidation.reason,
        botIdPrefix: ""
      }
    };
    const error = buildTelegramError(tokenValidation.code, tokenValidation.reason, diagnostics);
    throw error;
  }

  const response = await telegramRequestExecutor(connection, "getMe", {});
  const bot = response.result || {};
  const diagnostics = publicDiagnostics(response.diagnostics);

  return {
    diagnostics,
    botProfile: {
      id: bot.id,
      username: bot.username,
      firstName: bot.first_name,
      canJoinGroups: bot.can_join_groups,
      canReadAllGroupMessages: bot.can_read_all_group_messages
    }
  };
}

async function validateBot(connection) {
  const result = await testTelegramConnection(connection);
  return result.botProfile;
}

async function fetchNormalizedItems(connection) {
  const settings = connection.settings || {};
  const healthCheck = await testTelegramConnection(connection);

  if (settings.webhookUrl && !settings.pollingEnabled) {
    const webhookInfo = await telegramRequestExecutor(connection, "getWebhookInfo", {});

    return {
      normalizedItems: [],
      providerMetadata: {
        webhookInfo: webhookInfo.result,
        telegramDiagnostics: healthCheck.diagnostics,
        message: "Telegram webhook is configured. New academic messages are imported when Telegram delivers webhook updates."
      }
    };
  }

  const offset = connection.syncCursor ? Number(connection.syncCursor) : undefined;
  const updatesResponse = await telegramRequestExecutor(connection, "getUpdates", {
    offset: Number.isFinite(offset) ? offset : undefined,
    timeout: 0,
    limit: settings.maxResults || 50,
    allowed_updates: TELEGRAM_ALLOWED_UPDATES
  });
  const updates = updatesResponse.result || [];
  let maxUpdateId = Number.isFinite(offset) ? offset - 1 : 0;
  let ignoredUnapprovedChats = 0;
  const normalizedItems = [];

  for (const update of updates) {
    maxUpdateId = Math.max(maxUpdateId, update.update_id);
    const message = mapTelegramUpdate(update);

    if (!message) {
      continue;
    }

    if (!isApprovedChat(message, settings)) {
      ignoredUnapprovedChats += 1;
      continue;
    }

    const normalized = normalizeTelegramMessage(message, connection);

    if (normalized) {
      normalizedItems.push(normalized);
    }
  }

  if (maxUpdateId > 0) {
    connection.syncCursor = String(maxUpdateId + 1);
  }

  return {
    normalizedItems,
    providerMetadata: {
      fetchedUpdates: Array.isArray(updates) ? updates.length : 0,
      matchedApprovedChats: normalizedItems.length,
      ignoredUnapprovedChats,
      nextOffset: connection.syncCursor,
      telegramDiagnostics: healthCheck.diagnostics,
      privacyModeNote: "If group-wide capture is needed, disable bot privacy mode in BotFather or mention/reply to the bot in groups."
    }
  };
}

async function discoverVisibleChats(connection, options = {}) {
  const settings = connection.settings || {};
  const healthCheck = await testTelegramConnection(connection);

  if (settings.webhookUrl && !settings.pollingEnabled) {
    return {
      chats: [],
      providerMetadata: {
        fetchedUpdates: 0,
        discoveredChatCount: 0,
        telegramDiagnostics: healthCheck.diagnostics,
        privacyModeNote: "If group-wide capture is needed, disable bot privacy mode in BotFather or mention/reply to the bot in groups.",
        message: "Telegram chat discovery works best in polling mode. For local testing, enable polling or send a message that reaches your webhook."
      }
    };
  }

  const updatesResponse = await telegramRequestExecutor(connection, "getUpdates", {
    timeout: 0,
    limit: options.limit || settings.maxResults || 100,
    allowed_updates: TELEGRAM_ALLOWED_UPDATES
  });
  const chats = extractVisibleChatsFromUpdates(updatesResponse.result || []);

  return {
    chats,
    providerMetadata: {
      fetchedUpdates: Array.isArray(updatesResponse.result) ? updatesResponse.result.length : 0,
      discoveredChatCount: chats.length,
      telegramDiagnostics: healthCheck.diagnostics,
      privacyModeNote: "If group-wide capture is needed, disable bot privacy mode in BotFather or mention/reply to the bot in groups.",
      message: chats.length
        ? `Found ${chats.length} bot-visible Telegram chat${chats.length === 1 ? "" : "s"}.`
        : "Telegram is reachable, but there are no bot-visible chats yet. Send the bot a private message or add it to a group and post once."
    }
  };
}

function verifyWebhookSecret(secretHeader, connection = null) {
  const expected = connection && connection.settings && connection.settings.webhookSecret
    ? connection.settings.webhookSecret
    : appConfig.telegramWebhookSecret;

  if (!expected) {
    return true;
  }

  return Boolean(secretHeader && secretHeader === expected);
}

function extractWebhookMessages(payload, connection) {
  const message = mapTelegramUpdate(payload);

  if (!message || !isApprovedChat(message, connection.settings || {})) {
    return [];
  }

  return [message];
}

function mapTelegramUpdate(update = {}) {
  const rawMessage =
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.edited_channel_post;

  if (!rawMessage) {
    return null;
  }

  const text = rawMessage.text || rawMessage.caption || "";

  if (!text) {
    return null;
  }

  const chat = rawMessage.chat || {};
  const sender = rawMessage.from || rawMessage.sender_chat || {};
  const senderName = [sender.first_name, sender.last_name].filter(Boolean).join(" ") || sender.title || "";

  return {
    updateId: update.update_id,
    id: rawMessage.message_id,
    chatId: String(chat.id || ""),
    chatTitle: chat.title || chat.username || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || "",
    chatType: chat.type || "",
    sender: senderName,
    senderUsername: sender.username || "",
    text,
    timestamp: rawMessage.date ? new Date(rawMessage.date * 1000).toISOString() : new Date().toISOString()
  };
}

function extractVisibleChatsFromUpdates(updates = []) {
  const chats = new Map();

  for (const update of updates || []) {
    const message = mapTelegramUpdate(update);

    if (!message || !message.chatId) {
      continue;
    }

    const existing = chats.get(String(message.chatId));
    const candidate = {
      chatId: String(message.chatId),
      title: message.chatTitle || message.sender || `Chat ${message.chatId}`,
      type: message.chatType || "",
      lastSeenAt: message.timestamp,
      lastMessagePreview: String(message.text || "").slice(0, 180),
      sender: message.sender || message.senderUsername || "",
      senderUsername: message.senderUsername || "",
      updateId: message.updateId || 0
    };

    if (!existing || new Date(candidate.lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime()) {
      chats.set(String(message.chatId), candidate);
    }
  }

  return Array.from(chats.values()).sort((left, right) => (
    new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime()
  ));
}

function isApprovedChat(message, settings = {}) {
  const approvedChats = (settings.chatIds || []).map(String).filter(Boolean);

  if (!approvedChats.length) {
    return true;
  }

  return approvedChats.includes(String(message.chatId));
}

function setTelegramRequestExecutorForTests(executor) {
  telegramRequestExecutor = typeof executor === "function" ? executor : executeTelegramRequest;
}

function resetTelegramRequestExecutorForTests() {
  telegramRequestExecutor = executeTelegramRequest;
}

module.exports = {
  buildConnectivityMessage,
  buildTelegramEndpoint,
  discoverVisibleChats,
  executeTelegramRequest,
  extractWebhookMessages,
  extractVisibleChatsFromUpdates,
  fetchNormalizedItems,
  mapTelegramUpdate,
  publicDiagnostics,
  resetTelegramRequestExecutorForTests,
  sanitizeBotToken,
  setTelegramRequestExecutorForTests,
  testTelegramConnection,
  validateBot,
  validateTelegramTokenFormat,
  verifyWebhookSecret
};
