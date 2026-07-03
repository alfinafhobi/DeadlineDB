const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const appConfig = require("./appConfig");
const logger = require("../utils/logger");

let memoryServer;

async function connectDB() {
  const mongoUri = appConfig.mongoUri;

  if (mongoUri) {
    await mongoose.connect(mongoUri);
    logger.info("db.connected", {
      engine: "mongodb"
    });
    return;
  }

  memoryServer = await MongoMemoryServer.create({
    instance: {
      dbName: "deadlinedb"
    }
  });

  const memoryUri = memoryServer.getUri();
  await mongoose.connect(memoryUri);
  logger.warn("db.connected-memory", {
    engine: "mongodb-memory-server"
  });
}

process.on("SIGINT", async () => {
  if (memoryServer) {
    await memoryServer.stop();
  }
});

module.exports = connectDB;
