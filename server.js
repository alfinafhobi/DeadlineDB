const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const dotenv = require("dotenv");

dotenv.config();

const appConfig = require("./src/config/appConfig");
const connectDB = require("./src/config/db");
const authRoutes = require("./src/routes/authRoutes");
const assignmentRoutes = require("./src/routes/assignmentRoutes");
const noteRoutes = require("./src/routes/noteRoutes");
const reminderRoutes = require("./src/routes/reminderRoutes");
const dashboardRoutes = require("./src/routes/dashboardRoutes");
const integrationRoutes = require("./src/routes/integrationRoutes");
const notificationRoutes = require("./src/routes/notificationRoutes");
const exportRoutes = require("./src/routes/exportRoutes");
const roomRoutes = require("./src/routes/roomRoutes");
const { startReminderScheduler } = require("./src/services/reminderSchedulerService");
const { startSourceSyncScheduler } = require("./src/services/sourceSyncSchedulerService");
const { seedDemoData } = require("./src/services/demoSeedService");
const errorHandler = require("./src/middleware/errorHandler");
const notFound = require("./src/middleware/notFound");
const sanitizeInputs = require("./src/middleware/sanitizeInputs");
const requestLogger = require("./src/middleware/requestLogger");
const { apiLimiter, authLimiter } = require("./src/middleware/rateLimiters");
const logger = require("./src/utils/logger");

const app = express();
const PORT = appConfig.port;

if (appConfig.trustProxy) {
  app.set("trust proxy", 1);
}

if (appConfig.isProduction && appConfig.jwtSecret === "change-me") {
  logger.warn("security.default-jwt-secret", {
    message: "JWT_SECRET is using the default value. Set a strong secret before deployment."
  });
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || !appConfig.corsOrigins.length || appConfig.corsOrigins.includes(origin)) {
        return callback(null, true);
      }

      const corsError = new Error("Origin not allowed by CORS.");
      corsError.statusCode = 403;
      return callback(corsError);
    }
  })
);
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false
  })
);
app.use(express.json({
  limit: appConfig.bodyLimit,
  verify(req, res, buffer) {
    if (req.originalUrl && req.originalUrl.includes("/api/integrations/webhooks/telegram")) {
      req.rawBody = Buffer.from(buffer);
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: appConfig.bodyLimit }));
app.use(sanitizeInputs);
app.use(requestLogger);
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: appConfig.serveStaticMaxAge
  })
);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "DeadlineDB API",
    timestamp: new Date().toISOString(),
    environment: appConfig.nodeEnv,
    demoMode: appConfig.demoMode
  });
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api", apiLimiter);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/notes", noteRoutes);
app.use("/api/reminders", reminderRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/integrations", integrationRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/exports", exportRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api", notFound);

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(errorHandler);

connectDB()
  .then(async () => {
    if (appConfig.demoMode) {
      await seedDemoData({ reset: false });
    }

    startReminderScheduler();
    startSourceSyncScheduler();
    app.listen(PORT, () => {
      logger.info("server.started", {
        port: PORT,
        url: `http://localhost:${PORT}`,
        environment: appConfig.nodeEnv
      });
    });
  })
  .catch((error) => {
    logger.error("server.database-failed", {
      message: error.message
    });
    process.exit(1);
  });
