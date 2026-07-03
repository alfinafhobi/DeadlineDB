const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Assignment = require("../src/models/Assignment");
const Reminder = require("../src/models/Reminder");
const SourceConnection = require("../src/models/SourceConnection");
const User = require("../src/models/User");
const { encryptSecret } = require("../src/services/secureTokenService");
const { syncConnection } = require("../src/services/sourceSyncService");
const telegramAdapter = require("../src/services/telegramAdapter");

function buildSuccessDiagnostics(method) {
  return {
    endpoint: `https://api.telegram.org/bot<redacted>/${method}`,
    host: "api.telegram.org",
    port: 443,
    ipFamily: 0,
    requestTimeoutMs: 15000,
    proxy: {
      configured: false,
      supported: true,
      url: ""
    },
    dns: {
      ok: true,
      addresses: [{ address: "149.154.166.110", family: 4 }],
      errorCode: "",
      errorMessage: ""
    },
    tcp: {
      attempted: true,
      ok: true,
      remoteAddress: "149.154.166.110",
      remotePort: 443,
      family: "IPv4",
      errorCode: "",
      errorMessage: ""
    },
    tls: {
      attempted: true,
      ok: true,
      authorized: true,
      authorizationError: "",
      errorCode: "",
      errorMessage: ""
    },
    request: {
      ok: true,
      httpStatus: 200,
      telegramOk: true,
      errorCode: "",
      errorMessage: "",
      responseDescription: "",
      socketLookup: "149.154.166.110 family=4 host=api.telegram.org",
      tcpConnected: true,
      tlsEstablished: true,
      timeout: false
    },
    token: {
      valid: true,
      formatValid: true,
      botIdPrefix: "7496866164"
    }
  };
}

function buildTlsFailure() {
  const error = new Error(
    "TCP reached 149.154.166.110:443, but the TLS handshake with api.telegram.org did not complete. This usually indicates Telegram HTTPS is being blocked or intercepted on the current network."
  );
  error.code = "TELEGRAM_TLS_HANDSHAKE_FAILED";
  error.diagnostics = {
    endpoint: "https://api.telegram.org/bot<redacted>/getMe",
    host: "api.telegram.org",
    port: 443,
    ipFamily: 0,
    requestTimeoutMs: 15000,
    proxy: {
      configured: false,
      supported: true,
      url: ""
    },
    dns: {
      ok: true,
      addresses: [{ address: "149.154.166.110", family: 4 }],
      errorCode: "",
      errorMessage: ""
    },
    tcp: {
      attempted: true,
      ok: true,
      remoteAddress: "149.154.166.110",
      remotePort: 443,
      family: "IPv4",
      errorCode: "",
      errorMessage: ""
    },
    tls: {
      attempted: true,
      ok: false,
      authorized: false,
      authorizationError: "",
      errorCode: "TLS_TIMEOUT",
      errorMessage: "TLS handshake with api.telegram.org:443 timed out."
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
    },
    token: {
      valid: true,
      formatValid: true,
      botIdPrefix: "7496866164"
    }
  };
  return error;
}

function createExecutor(handlers) {
  return async (connection, method, body) => {
    const handler = handlers[method];

    if (!handler) {
      throw new Error(`No handler configured for Telegram method ${method}`);
    }

    if (typeof handler === "function") {
      return handler({ connection, method, body });
    }

    return handler;
  };
}

function buildGetMeResponse() {
  return {
    result: {
      id: 7496866164,
      username: "deadlinedb_test_bot",
      first_name: "DeadlineDB",
      can_join_groups: true,
      can_read_all_group_messages: true
    },
    diagnostics: buildSuccessDiagnostics("getMe"),
    payload: { ok: true },
    statusCode: 200
  };
}

function buildGetUpdatesResponse(updates = []) {
  return {
    result: updates,
    diagnostics: buildSuccessDiagnostics("getUpdates"),
    payload: { ok: true },
    statusCode: 200
  };
}

async function clearCollections() {
  await Promise.all([
    Assignment.deleteMany({}),
    Reminder.deleteMany({}),
    SourceConnection.deleteMany({}),
    User.deleteMany({})
  ]);
}

async function createUserAndConnection(overrides = {}) {
  const user = await User.create({
    name: "Telegram Verifier",
    email: `telegram-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    password: "password123"
  });

  const connection = await SourceConnection.create({
    user: user._id,
    type: "telegram",
    provider: "telegram",
    label: "Telegram Academic Notices",
    status: "connected",
    health: "limited",
    syncMode: "api",
    encryptedAccessToken: encryptSecret("7496866164:AAG5kkGM81CIYPzKsMSQZT2qHQTffZSewFw"),
    settings: {
      pollingEnabled: true,
      chatIds: [],
      courseKeywords: ["DBMS", "Lab Section 3"]
    },
    ...overrides
  });

  return { user, connection };
}

async function expectAsyncError(action, code) {
  let caught = null;

  try {
    await action();
  } catch (error) {
    caught = error;
  }

  assert(caught, `Expected async error ${code}`);
  assert.strictEqual(caught.code, code);
  return caught;
}

async function runConnectionValidationTests() {
  await expectAsyncError(
    () => telegramAdapter.testTelegramConnection({ encryptedAccessToken: "", settings: {} }),
    "TELEGRAM_TOKEN_REQUIRED"
  );

  await expectAsyncError(
    () => telegramAdapter.testTelegramConnection({
      encryptedAccessToken: encryptSecret("bad token"),
      settings: {}
    }),
    "TELEGRAM_TOKEN_WHITESPACE"
  );

  telegramAdapter.setTelegramRequestExecutorForTests(createExecutor({
    getMe: buildGetMeResponse()
  }));

  const success = await telegramAdapter.testTelegramConnection({
    encryptedAccessToken: encryptSecret("7496866164:AAG5kkGM81CIYPzKsMSQZT2qHQTffZSewFw"),
    settings: {}
  });

  assert.strictEqual(success.botProfile.username, "deadlinedb_test_bot");

  telegramAdapter.setTelegramRequestExecutorForTests(createExecutor({
    getMe() {
      throw buildTlsFailure();
    }
  }));

  await expectAsyncError(
    () => telegramAdapter.testTelegramConnection({
      encryptedAccessToken: encryptSecret("7496866164:AAG5kkGM81CIYPzKsMSQZT2qHQTffZSewFw"),
      settings: {}
    }),
    "TELEGRAM_TLS_HANDSHAKE_FAILED"
  );
}

async function runDiscoverChatsTests() {
  telegramAdapter.setTelegramRequestExecutorForTests(createExecutor({
    getMe: buildGetMeResponse(),
    getUpdates: buildGetUpdatesResponse([])
  }));

  const emptyDiscovery = await telegramAdapter.discoverVisibleChats({
    encryptedAccessToken: encryptSecret("7496866164:AAG5kkGM81CIYPzKsMSQZT2qHQTffZSewFw"),
    settings: {
      pollingEnabled: true
    }
  });

  assert.strictEqual(emptyDiscovery.chats.length, 0);
  assert(
    String(emptyDiscovery.providerMetadata.message || "").includes("no bot-visible chats"),
    "discover chats should explain the empty-updates case"
  );

  telegramAdapter.setTelegramRequestExecutorForTests(createExecutor({
    getMe: buildGetMeResponse(),
    getUpdates: buildGetUpdatesResponse([
      {
        update_id: 100,
        message: {
          message_id: 1,
          date: 1776381000,
          text: "Submit DBMS lab record by tomorrow at 5 PM",
          chat: {
            id: -1001234567890,
            title: "DBMS Lab Section 3",
            type: "supergroup"
          },
          from: {
            first_name: "Faculty",
            username: "faculty_dbms"
          }
        }
      },
      {
        update_id: 101,
        channel_post: {
          message_id: 2,
          date: 1776381100,
          text: "Seminar tomorrow morning",
          chat: {
            id: -1009999999999,
            title: "Department Notices",
            type: "channel"
          },
          sender_chat: {
            title: "Department Notices"
          }
        }
      }
    ])
  }));

  const discovery = await telegramAdapter.discoverVisibleChats({
    encryptedAccessToken: encryptSecret("7496866164:AAG5kkGM81CIYPzKsMSQZT2qHQTffZSewFw"),
    settings: {
      pollingEnabled: true
    }
  });

  assert.strictEqual(discovery.chats.length, 2);
  assert.strictEqual(discovery.chats[0].chatId, "-1009999999999");

  telegramAdapter.setTelegramRequestExecutorForTests(createExecutor({
    getMe() {
      throw buildTlsFailure();
    }
  }));

  await expectAsyncError(
    () => telegramAdapter.discoverVisibleChats({
      encryptedAccessToken: encryptSecret("7496866164:AAG5kkGM81CIYPzKsMSQZT2qHQTffZSewFw"),
      settings: {
        pollingEnabled: true
      }
    }),
    "TELEGRAM_TLS_HANDSHAKE_FAILED"
  );
}

async function runSyncBehaviorTests() {
  await clearCollections();
  const { user, connection } = await createUserAndConnection({
    settings: {
      pollingEnabled: true,
      chatIds: ["-1001234567890"],
      courseKeywords: ["DBMS", "Lab Section 3"]
    }
  });

  telegramAdapter.setTelegramRequestExecutorForTests(createExecutor({
    getMe() {
      throw buildTlsFailure();
    }
  }));

  await expectAsyncError(() => syncConnection(connection, user, {}), "TELEGRAM_TLS_HANDSHAKE_FAILED");
  const failedConnection = await SourceConnection.findById(connection._id);
  assert.strictEqual(failedConnection.status, "error");
  assert.strictEqual(failedConnection.errorState.code, "TELEGRAM_TLS_HANDSHAKE_FAILED");

  await clearCollections();
  const zeroMatchScenario = await createUserAndConnection({
    settings: {
      pollingEnabled: true,
      chatIds: ["-1001234567890"],
      courseKeywords: ["DBMS", "Lab Section 3"]
    }
  });

  telegramAdapter.setTelegramRequestExecutorForTests(createExecutor({
    getMe: buildGetMeResponse(),
    getUpdates: buildGetUpdatesResponse([
      {
        update_id: 200,
        message: {
          message_id: 10,
          date: 1776381200,
          text: "Submit DBMS lab record by tomorrow at 5 PM",
          chat: {
            id: -1001111111111,
            title: "Other Section",
            type: "supergroup"
          },
          from: {
            first_name: "Faculty",
            username: "faculty_dbms"
          }
        }
      }
    ])
  }));

  const zeroMatchResult = await syncConnection(zeroMatchScenario.connection, zeroMatchScenario.user, {});
  assert.strictEqual(zeroMatchResult.importedCount, 0);
  assert.strictEqual(zeroMatchResult.providerMetadata.ignoredUnapprovedChats, 1);
  assert.strictEqual(await Assignment.countDocuments({}), 0);
  assert.strictEqual(await Reminder.countDocuments({}), 0);

  await clearCollections();
  const importScenario = await createUserAndConnection({
    settings: {
      pollingEnabled: true,
      chatIds: ["-1001234567890"],
      courseKeywords: ["DBMS", "Lab Section 3"]
    }
  });

  const approvedUpdates = [
    {
      update_id: 300,
      message: {
        message_id: 20,
        date: 1776381300,
        text: "Submit DBMS assignment by tomorrow at 5 PM without fail.",
        chat: {
          id: -1001234567890,
          title: "DBMS Lab Section 3",
          type: "supergroup"
        },
        from: {
          first_name: "Faculty",
          username: "faculty_dbms"
        }
      }
    }
  ];

  telegramAdapter.setTelegramRequestExecutorForTests(createExecutor({
    getMe: buildGetMeResponse(),
    getUpdates: buildGetUpdatesResponse(approvedUpdates)
  }));

  const importResult = await syncConnection(importScenario.connection, importScenario.user, {});
  assert.strictEqual(importResult.importedCount, 1);
  assert.strictEqual(importResult.assignmentImports, 1);
  assert.strictEqual(await Assignment.countDocuments({}), 1);
  assert.strictEqual(await Reminder.countDocuments({}), 1);

  telegramAdapter.setTelegramRequestExecutorForTests(createExecutor({
    getMe: buildGetMeResponse(),
    getUpdates: buildGetUpdatesResponse(approvedUpdates)
  }));

  const duplicateResult = await syncConnection(importScenario.connection, importScenario.user, {});
  assert.strictEqual(duplicateResult.importedCount, 0);
  assert.strictEqual(duplicateResult.skippedDuplicates, 1);
  assert.strictEqual(await Assignment.countDocuments({}), 1);
  assert.strictEqual(await Reminder.countDocuments({}), 1);

  await clearCollections();
  const reminderScenario = await createUserAndConnection({
    settings: {
      pollingEnabled: true,
      chatIds: ["-1001234567890"],
      courseKeywords: ["DBMS", "Lab Section 3"]
    }
  });

  telegramAdapter.setTelegramRequestExecutorForTests(createExecutor({
    getMe: buildGetMeResponse(),
    getUpdates: buildGetUpdatesResponse([
      {
        update_id: 400,
        message: {
          message_id: 30,
          date: 1776381400,
          text: "Reminder: submit the DBMS seminar attendance note in Lab Section 3.",
          chat: {
            id: -1001234567890,
            title: "DBMS Lab Section 3",
            type: "supergroup"
          },
          from: {
            first_name: "Faculty",
            username: "faculty_dbms"
          }
        }
      }
    ])
  }));

  const reminderResult = await syncConnection(reminderScenario.connection, reminderScenario.user, {});
  assert.strictEqual(reminderResult.importedCount, 1);
  assert.strictEqual(reminderResult.reminderImports, 1);
  assert.strictEqual(await Assignment.countDocuments({}), 0);
  assert.strictEqual(await Reminder.countDocuments({}), 1);
}

async function main() {
  const mongoServer = await MongoMemoryServer.create({
    instance: {
      dbName: "deadlinedb-telegram-flow-tests"
    }
  });

  try {
    await mongoose.connect(mongoServer.getUri());
    await runConnectionValidationTests();
    await runDiscoverChatsTests();
    await runSyncBehaviorTests();
    process.stdout.write("telegram flow behavior tests passed\n");
  } finally {
    telegramAdapter.resetTelegramRequestExecutorForTests();
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

main().catch((error) => {
  telegramAdapter.resetTelegramRequestExecutorForTests();
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
