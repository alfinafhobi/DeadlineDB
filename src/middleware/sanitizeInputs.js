function sanitizeString(value) {
  return String(value)
    .replace(/\0/g, "")
    .replace(/[<>]/g, "")
    .trim();
}

function deepSanitize(value) {
  if (Array.isArray(value)) {
    return value.map(deepSanitize);
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.entries(value).reduce((acc, [key, nestedValue]) => {
      acc[key] = deepSanitize(nestedValue);
      return acc;
    }, {});
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  return value;
}

module.exports = function sanitizeInputs(req, res, next) {
  if (req.body && typeof req.body === "object") {
    req.body = deepSanitize(req.body);
  }

  if (req.query && typeof req.query === "object") {
    req.query = deepSanitize(req.query);
  }

  next();
};
