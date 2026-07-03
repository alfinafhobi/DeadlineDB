const crypto = require("crypto");

const appConfig = require("../config/appConfig");
const { decryptSecret, encryptSecret } = require("./secureTokenService");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const GOOGLE_SCOPES = {
  "google-classroom": [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.announcements.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.students.readonly"
  ],
  gmail: [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.readonly"
  ]
};

function assertGoogleConfigured() {
  if (!appConfig.googleClientId || !appConfig.googleClientSecret) {
    const error = new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
    error.code = "GOOGLE_OAUTH_NOT_CONFIGURED";
    throw error;
  }
}

function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", appConfig.jwtSecret)
    .update(body)
    .digest("base64url");

  return `${body}.${signature}`;
}

function verifyState(state) {
  const [body, signature] = String(state || "").split(".");

  if (!body || !signature) {
    throw new Error("Invalid OAuth state.");
  }

  const expectedSignature = crypto
    .createHmac("sha256", appConfig.jwtSecret)
    .update(body)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new Error("Invalid OAuth state signature.");
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  const ageMs = Date.now() - Number(payload.iat || 0);

  if (ageMs > 10 * 60 * 1000) {
    throw new Error("OAuth state expired. Start the connection again.");
  }

  return payload;
}

function buildGoogleAuthUrl({ provider, userId, connectionId }) {
  assertGoogleConfigured();

  const scopes = GOOGLE_SCOPES[provider];

  if (!scopes) {
    throw new Error("Unsupported Google provider.");
  }

  const params = new URLSearchParams({
    client_id: appConfig.googleClientId,
    redirect_uri: appConfig.googleRedirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: scopes.join(" "),
    state: signState({
      userId: String(userId),
      provider,
      connectionId: connectionId ? String(connectionId) : "",
      iat: Date.now(),
      nonce: crypto.randomBytes(12).toString("hex")
    })
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  assertGoogleConfigured();

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      code,
      client_id: appConfig.googleClientId,
      client_secret: appConfig.googleClientSecret,
      redirect_uri: appConfig.googleRedirectUri,
      grant_type: "authorization_code"
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Google OAuth token exchange failed.");
  }

  return payload;
}

async function refreshGoogleAccessToken(connection) {
  assertGoogleConfigured();

  const refreshToken = decryptSecret(connection.encryptedRefreshToken);

  if (!refreshToken) {
    const error = new Error("Google refresh token is missing. Reconnect this provider.");
    error.code = "TOKEN_REFRESH_REQUIRED";
    throw error;
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: appConfig.googleClientId,
      client_secret: appConfig.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Google token refresh failed.");
  }

  connection.encryptedAccessToken = encryptSecret(payload.access_token);
  connection.tokenExpiresAt = new Date(Date.now() + Number(payload.expires_in || 3600) * 1000);
  await connection.save();

  return payload.access_token;
}

async function getValidGoogleAccessToken(connection) {
  const currentToken = decryptSecret(connection.encryptedAccessToken);
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0;

  if (currentToken && expiresAt > Date.now() + 60 * 1000) {
    return currentToken;
  }

  return refreshGoogleAccessToken(connection);
}

async function fetchGoogleUserInfo(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Failed to fetch Google profile.");
  }

  return payload;
}

module.exports = {
  GOOGLE_SCOPES,
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  getValidGoogleAccessToken,
  verifyState
};
