const appConfig = require("../config/appConfig");

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

function shouldLog(level) {
  const configuredLevel = levels[appConfig.logLevel] ?? levels.info;
  return (levels[level] ?? levels.info) <= configuredLevel;
}

function write(level, event, meta = {}) {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...meta,
    message: meta.message || event
  };

  const serialized = JSON.stringify(payload);

  if (level === "error") {
    process.stderr.write(`${serialized}\n`);
    return;
  }

  process.stdout.write(`${serialized}\n`);
}

module.exports = {
  error(message, meta) {
    write("error", message, meta);
  },
  warn(message, meta) {
    write("warn", message, meta);
  },
  info(message, meta) {
    write("info", message, meta);
  },
  debug(message, meta) {
    write("debug", message, meta);
  }
};
