const logger = require("../utils/logger");

module.exports = function requestLogger(req, res, next) {
  if (!req.path.startsWith("/api")) {
    return next();
  }

  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const level =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    logger[level]("request.completed", {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip,
      userId: req.user ? req.user._id : null
    });
  });

  next();
};
