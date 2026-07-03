const logger = require("../utils/logger");

function normalizeError(error) {
  if (error && error.name === "ValidationError") {
    return {
      statusCode: 400,
      message: Object.values(error.errors)
        .map((item) => item.message)
        .join(" ")
    };
  }

  if (error && error.code === 11000) {
    return {
      statusCode: 409,
      message: "A record with that value already exists."
    };
  }

  return {
    statusCode: error.statusCode || 500,
    message: error.message || "Something went wrong."
  };
}

module.exports = function errorHandler(err, req, res, next) {
  const normalized = normalizeError(err);

  logger[normalized.statusCode >= 500 ? "error" : "warn"]("request.failed", {
    method: req.method,
    path: req.originalUrl,
    statusCode: normalized.statusCode,
    message: normalized.message,
    stack: normalized.statusCode >= 500 ? err.stack : undefined,
    userId: req.user ? req.user._id : null
  });

  if (res.headersSent) {
    return next(err);
  }

  res.status(normalized.statusCode).json({
    success: false,
    message: normalized.message,
    code: err && err.code ? err.code : undefined
  });
};
