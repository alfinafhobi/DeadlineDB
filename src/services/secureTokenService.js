const crypto = require("crypto");

const appConfig = require("../config/appConfig");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey() {
  return crypto
    .createHash("sha256")
    .update(String(appConfig.providerTokenEncryptionKey || appConfig.jwtSecret || "change-me"))
    .digest();
}

function encryptSecret(value) {
  if (!value) {
    return "";
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function decryptSecret(value) {
  if (!value) {
    return "";
  }

  const [ivValue, tagValue, encryptedValue] = String(value).split(".");

  if (!ivValue || !tagValue || !encryptedValue) {
    return "";
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

module.exports = {
  decryptSecret,
  encryptSecret
};

