const cron = require("node-cron");

const appConfig = require("../config/appConfig");
const SourceConnection = require("../models/SourceConnection");
const User = require("../models/User");
const { syncConnection } = require("./sourceSyncService");
const logger = require("../utils/logger");

let scheduledTask;

async function runSourceSyncSweep() {
  const connections = await SourceConnection.find({
    status: "connected",
    syncMode: "api",
    provider: { $in: ["google-classroom", "gmail", "telegram"] }
  })
    .select("+encryptedAccessToken +encryptedRefreshToken")
    .sort({ lastSyncedAt: 1, createdAt: 1 })
    .limit(appConfig.sourceSyncBatchSize);
  let synced = 0;
  let failed = 0;

  for (const connection of connections) {
    const user = await User.findById(connection.user).select("name email role");

    if (!user) {
      continue;
    }

    try {
      await syncConnection(connection, user, { scheduled: true });
      synced += 1;
    } catch (error) {
      failed += 1;
      logger.warn("scheduler.source-sync.connection-failed", {
        connectionId: connection._id,
        provider: connection.provider,
        message: error.message
      });
    }
  }

  logger.info("scheduler.source-sync.completed", {
    synced,
    failed
  });

  return {
    synced,
    failed
  };
}

function startSourceSyncScheduler() {
  if (!appConfig.sourceSyncSchedulerEnabled) {
    logger.info("scheduler.source-sync.disabled");
    return null;
  }

  if (scheduledTask) {
    return scheduledTask;
  }

  scheduledTask = cron.schedule(
    appConfig.sourceSyncCron,
    async () => {
      try {
        await runSourceSyncSweep();
      } catch (error) {
        logger.error("scheduler.source-sync.failed", {
          message: error.message
        });
      }
    },
    {
      scheduled: false
    }
  );

  scheduledTask.start();
  logger.info("scheduler.source-sync.started", {
    cronExpression: appConfig.sourceSyncCron
  });

  return scheduledTask;
}

module.exports = {
  runSourceSyncSweep,
  startSourceSyncScheduler
};
