const { encryptSecret } = require("../src/services/secureTokenService");
const { discoverVisibleChats, publicDiagnostics } = require("../src/services/telegramAdapter");

async function main() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatIds = String(process.env.TELEGRAM_CHAT_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!token) {
    process.stderr.write("Set TELEGRAM_BOT_TOKEN before running this script.\n");
    process.exit(1);
  }

  const connection = {
    encryptedAccessToken: encryptSecret(token),
    settings: {
      pollingEnabled: true,
      chatIds
    }
  };

  try {
    const result = await discoverVisibleChats(connection, { limit: 20 });
    process.stdout.write(`${JSON.stringify({
      success: true,
      message: result.providerMetadata && result.providerMetadata.message
        ? result.providerMetadata.message
        : "Telegram updates fetched successfully.",
      chats: result.chats,
      diagnostics: result.providerMetadata && result.providerMetadata.telegramDiagnostics
        ? result.providerMetadata.telegramDiagnostics
        : null
    }, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      success: false,
      message: error.message,
      code: error.code || "",
      diagnostics: error.diagnostics ? publicDiagnostics(error.diagnostics) : null
    }, null, 2)}\n`);
    process.exit(1);
  }
}

main();
