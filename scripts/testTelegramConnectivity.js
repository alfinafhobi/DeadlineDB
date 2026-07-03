const { encryptSecret } = require("../src/services/secureTokenService");
const { publicDiagnostics, testTelegramConnection } = require("../src/services/telegramAdapter");

async function main() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();

  if (!token) {
    process.stderr.write("Set TELEGRAM_BOT_TOKEN before running this script.\n");
    process.exit(1);
  }

  const connection = {
    encryptedAccessToken: encryptSecret(token),
    settings: {}
  };

  try {
    const result = await testTelegramConnection(connection);
    process.stdout.write(`${JSON.stringify({
      success: true,
      message: "Telegram Bot API is reachable.",
      botProfile: result.botProfile,
      diagnostics: result.diagnostics
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
