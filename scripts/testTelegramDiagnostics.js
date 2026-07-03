const assert = require("assert");

const {
  buildConnectivityMessage,
  buildTelegramEndpoint,
  extractVisibleChatsFromUpdates,
  validateTelegramTokenFormat
} = require("../src/services/telegramAdapter");

function runTokenValidationTests() {
  let result = validateTelegramTokenFormat("");
  assert.strictEqual(result.valid, false, "missing token should be rejected");
  assert.strictEqual(result.code, "TELEGRAM_TOKEN_REQUIRED");

  result = validateTelegramTokenFormat(" 7496866164:AAG5kkGM81CIYPzKsMSQZT2qHQTffZSewFw ");
  assert.strictEqual(result.valid, true, "well-formed token should be accepted after trimming");

  result = validateTelegramTokenFormat("bad token value");
  assert.strictEqual(result.valid, false, "malformed token should be rejected");
  assert.strictEqual(result.code, "TELEGRAM_TOKEN_WHITESPACE");
}

function runEndpointMaskingTests() {
  const endpoint = buildTelegramEndpoint(
    "7496866164:AAG5kkGM81CIYPzKsMSQZT2qHQTffZSewFw",
    "getMe"
  );

  assert.strictEqual(endpoint.hostname, "api.telegram.org", "telegram endpoint should target the official API host");
  assert(endpoint.pathname.endsWith("/getMe"), "telegram endpoint should include the requested method path");
}

function runDiagnosticsMessageTests() {
  const message = buildConnectivityMessage({
    host: "api.telegram.org",
    port: 443,
    token: {
      valid: true,
      formatValid: true
    },
    proxy: {
      configured: false,
      supported: true
    },
    dns: {
      ok: true
    },
    tcp: {
      attempted: true,
      ok: true,
      remoteAddress: "149.154.166.110"
    },
    tls: {
      attempted: true,
      ok: false
    }
  });

  assert(message.includes("TLS handshake"), "TLS failures should mention the handshake stage");
}

function runVisibleChatsTests() {
  const chats = extractVisibleChatsFromUpdates([
    {
      update_id: 1,
      message: {
        message_id: 10,
        date: 1776200000,
        text: "Submit DBMS lab record by tomorrow at 5 PM",
        chat: {
          id: -100123,
          title: "DBMS Lab Section 3",
          type: "supergroup"
        },
        from: {
          first_name: "Faculty",
          username: "faculty_bot"
        }
      }
    },
    {
      update_id: 2,
      channel_post: {
        message_id: 11,
        date: 1776201000,
        text: "Exam reminder tonight",
        chat: {
          id: -100456,
          title: "Dept Notices",
          type: "channel"
        },
        sender_chat: {
          title: "Dept Notices"
        }
      }
    }
  ]);

  assert.strictEqual(chats.length, 2, "two unique chats should be discovered");
  assert.strictEqual(chats[0].chatId, "-100456", "latest chat should sort first");
}

function main() {
  runTokenValidationTests();
  runEndpointMaskingTests();
  runDiagnosticsMessageTests();
  runVisibleChatsTests();
  process.stdout.write("telegram diagnostics tests passed\n");
}

main();
