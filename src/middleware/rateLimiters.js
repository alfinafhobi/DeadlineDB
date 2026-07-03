const rateLimit = require("express-rate-limit");

const appConfig = require("../config/appConfig");

function handler(req, res) {
  res.status(429).json({
    success: false,
    message: "Too many requests. Please try again shortly."
  });
}

const apiLimiter = rateLimit({
  windowMs: appConfig.rateLimitWindowMs,
  max: appConfig.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler
});

const authLimiter = rateLimit({
  windowMs: appConfig.rateLimitWindowMs,
  max: appConfig.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler
});

module.exports = {
  apiLimiter,
  authLimiter
};
