const appConfig = require("../config/appConfig");
const logger = require("../utils/logger");

const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

const WEEKDAYS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

const ACADEMIC_INTENT_PATTERNS = [
  "submit by",
  "due on",
  "complete by",
  "turn in before",
  "upload before",
  "present on",
  "demo on",
  "viva on",
  "exam on",
  "lab on",
  "deadline",
  "last date",
  "without fail",
  "compulsory submission",
  "assignment",
  "submission",
  "due",
  "submit",
  "upload",
  "turn in"
];

const URGENCY_BOOSTERS = [
  "without fail",
  "mandatory",
  "compulsory",
  "urgent",
  "final deadline"
];

function extractDeadlineFromText(text = "", baseDate = new Date(), timezone = appConfig.defaultTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const sourceText = String(text || "");
  const lowerText = sourceText.toLowerCase();
  const ambiguityFlags = [];
  const matchedIntentPhrases = findMatches(lowerText, ACADEMIC_INTENT_PATTERNS);
  const urgencyBoosters = findMatches(lowerText, URGENCY_BOOSTERS);
  const hasAcademicIntent = matchedIntentPhrases.length > 0;
  const rawDetectedDeadlineText = extractContextSnippet(sourceText);
  const dateCandidate = findDateCandidate(sourceText, baseDate, ambiguityFlags);
  const timeCandidate = findTimeCandidate(sourceText, ambiguityFlags);
  let dateParts = dateCandidate ? dateCandidate.dateParts : null;
  let timeParts = timeCandidate ? timeCandidate.timeParts : null;
  let defaultTimeApplied = false;

  if (!dateParts && /\btonight\b/i.test(sourceText)) {
    dateParts = dateToParts(nearestDateForTime(baseDate, { hours: 21, minutes: 0 }));
  }

  if (!dateParts && timeParts && hasAcademicIntent) {
    dateParts = dateToParts(nearestDateForTime(baseDate, timeParts));
    addFlag(ambiguityFlags, "missing-date");
  }

  if (!dateParts && /\bsoon\b/i.test(sourceText)) {
    addFlag(ambiguityFlags, "vague-deadline");
  }

  if (dateParts && !timeParts) {
    timeParts = { hours: 23, minutes: 59, source: "default-end-of-day" };
    defaultTimeApplied = true;
    addFlag(ambiguityFlags, "default-time-applied");
  }

  const resolvedDateTime = dateParts && timeParts
    ? buildResolvedDateTime(dateParts, timeParts)
    : null;
  const confidence = scoreConfidence({
    dateCandidate,
    timeCandidate,
    resolvedDateTime,
    hasAcademicIntent,
    urgencyBoosters,
    ambiguityFlags
  });

  return {
    dueDate: resolvedDateTime ? formatDateOnly(resolvedDateTime) : "",
    dueTime: timeParts ? formatTime(timeParts) : "",
    resolvedDateTime,
    confidence,
    extractionSource: "natural-language",
    ambiguityFlags,
    needsUserReview: confidence === "low" || ambiguityFlags.some((flag) => [
      "ambiguous-date-format",
      "missing-date",
      "missing-meridiem",
      "broad-relative-phrase",
      "vague-deadline"
    ].includes(flag)),
    rawDetectedDeadlineText,
    rawDateToken: dateCandidate ? dateCandidate.raw : "",
    rawTimeToken: timeCandidate ? timeCandidate.raw : "",
    matchedIntentPhrases,
    urgencyBoosters,
    defaultTimeApplied,
    timezone
  };
}

function findDateCandidate(text, baseDate, ambiguityFlags) {
  return findIsoDate(text, baseDate, ambiguityFlags) ||
    findNumericDate(text, baseDate, ambiguityFlags) ||
    findMonthNameDate(text, baseDate, ambiguityFlags) ||
    findRelativeDate(text, baseDate, ambiguityFlags) ||
    findWeekdayDate(text, baseDate, ambiguityFlags);
}

function findIsoDate(text, baseDate, ambiguityFlags) {
  const match = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const dateParts = normalizeDateToken(Number(year), Number(month), Number(day));

  if (!dateParts) {
    addFlag(ambiguityFlags, "invalid-date");
    return null;
  }

  return {
    raw: match[0],
    dateParts,
    type: "absolute-iso"
  };
}

function findNumericDate(text, baseDate, ambiguityFlags) {
  const regex = /\b(\d{1,2})([./-])(\d{1,2})(?:\2(\d{2,4}))?\b/g;
  let match;

  while ((match = regex.exec(text))) {
    const fullMatch = match[0];
    const after = text.slice(match.index + fullMatch.length, match.index + fullMatch.length + 6);

    if (!match[4] && /^(?:\s*)(?:am|pm|a\.m\.|p\.m\.)\b/i.test(after)) {
      continue;
    }

    const first = Number(match[1]);
    const second = Number(match[3]);
    const rawYear = match[4] ? Number(normalizeYear(match[4])) : null;

    if (second < 1 || second > 12 || first < 1 || first > 31) {
      continue;
    }

    if (!rawYear) {
      addFlag(ambiguityFlags, "missing-year");
    }

    if (first <= 12 && second <= 12) {
      addFlag(ambiguityFlags, "ambiguous-date-format");
    }

    const inferredYear = rawYear || inferYear(second, first, baseDate);
    const dateParts = normalizeDateToken(inferredYear, second, first);

    if (!dateParts) {
      addFlag(ambiguityFlags, "invalid-date");
      continue;
    }

    return {
      raw: fullMatch,
      dateParts,
      type: "absolute-numeric"
    };
  }

  return null;
}

function findMonthNameDate(text, baseDate, ambiguityFlags) {
  const monthNames = Object.keys(MONTHS).join("|");
  const monthFirst = new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`, "i");
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})(?:\\s+(\\d{2,4}))?\\b`, "i");
  const match = text.match(monthFirst) || text.match(dayFirst);

  if (!match) {
    return null;
  }

  const isMonthFirst = Number.isNaN(Number(match[1]));
  const month = isMonthFirst ? MONTHS[match[1].toLowerCase()] : MONTHS[match[2].toLowerCase()];
  const day = Number(isMonthFirst ? match[2] : match[1]);
  const rawYear = match[3] ? Number(normalizeYear(match[3])) : null;

  if (!rawYear) {
    addFlag(ambiguityFlags, "missing-year");
  }

  const year = rawYear || inferYear(month, day, baseDate);
  const dateParts = normalizeDateToken(year, month, day);

  if (!dateParts) {
    addFlag(ambiguityFlags, "invalid-date");
    return null;
  }

  return {
    raw: match[0],
    dateParts,
    type: "absolute-month-name"
  };
}

function findRelativeDate(text, baseDate, ambiguityFlags) {
  const lower = text.toLowerCase();

  if (/\bday after tomorrow\b/.test(lower)) {
    return relativeCandidate("day after tomorrow", addDays(baseDate, 2), "relative-day");
  }

  if (/\btomorrow\b/.test(lower)) {
    return relativeCandidate("tomorrow", addDays(baseDate, 1), "relative-day");
  }

  if (/\btoday\b/.test(lower)) {
    return relativeCandidate("today", baseDate, "relative-day");
  }

  const daysMatch = lower.match(/\b(?:within|in|after)\s+(\d{1,2})\s+days?\b/);

  if (daysMatch) {
    return relativeCandidate(daysMatch[0], addDays(baseDate, Number(daysMatch[1])), "relative-offset");
  }

  if (/\bthis weekend\b/.test(lower)) {
    addFlag(ambiguityFlags, "broad-relative-phrase");
    return relativeCandidate("this weekend", nextWeekday(baseDate, 6, false), "relative-weekend");
  }

  if (/\bnext week\b/.test(lower)) {
    addFlag(ambiguityFlags, "broad-relative-phrase");
    return relativeCandidate("next week", nextWeekday(baseDate, 1, true), "relative-week");
  }

  return null;
}

function findWeekdayDate(text, baseDate, ambiguityFlags) {
  const weekdayNames = Object.keys(WEEKDAYS).join("|");
  const regex = new RegExp(`\\b(?:(by|before|this|next|coming|on)\\s+)?(${weekdayNames})\\b`, "i");
  const match = text.match(regex);

  if (!match) {
    return null;
  }

  const qualifier = (match[1] || "").toLowerCase();
  const weekday = match[2].toLowerCase();

  if (!qualifier) {
    addFlag(ambiguityFlags, "relative-weekday");
  }

  return {
    raw: match[0],
    dateParts: dateToParts(resolveWeekday(baseDate, WEEKDAYS[weekday], qualifier)),
    type: "relative-weekday"
  };
}

function findTimeCandidate(text, ambiguityFlags) {
  return findNamedTime(text) ||
    findClockTime(text, ambiguityFlags) ||
    findBareHourTime(text, ambiguityFlags);
}

function findNamedTime(text) {
  const patterns = [
    [/\b(?:eod|end of day)\b/i, { hours: 23, minutes: 59, source: "end-of-day" }],
    [/\bnoon\b/i, { hours: 12, minutes: 0, source: "noon" }],
    [/\bmidnight\b/i, { hours: 0, minutes: 0, source: "midnight" }],
    [/\btonight\b/i, { hours: 21, minutes: 0, source: "tonight" }],
    [/\bmorning\b/i, { hours: 9, minutes: 0, source: "morning" }],
    [/\bafternoon\b/i, { hours: 15, minutes: 0, source: "afternoon" }],
    [/\bevening\b/i, { hours: 18, minutes: 0, source: "evening" }]
  ];

  for (const [regex, timeParts] of patterns) {
    const match = text.match(regex);

    if (match) {
      return {
        raw: match[0],
        timeParts,
        type: "named-time"
      };
    }
  }

  return null;
}

function findClockTime(text, ambiguityFlags) {
  const regex = /\b(\d{1,2})([:.])(\d{2})\s*(a\.?m\.?|p\.?m\.?|am|pm)?\b/gi;
  let match;

  while ((match = regex.exec(text))) {
    const fullMatch = match[0];
    const after = text.slice(match.index + fullMatch.length, match.index + fullMatch.length + 6);

    if (match[2] === "." && /^\.\d{2,4}/.test(after)) {
      continue;
    }

    const hour = Number(match[1]);
    const minute = Number(match[3]);
    const meridiem = normalizeMeridiem(match[4] || "");

    if (hour > 23 || minute > 59 || (meridiem && hour > 12)) {
      continue;
    }

    if (!meridiem && hour <= 12) {
      addFlag(ambiguityFlags, "missing-meridiem");
    }

    return {
      raw: fullMatch,
      timeParts: normalizeTimeToken(hour, minute, meridiem),
      type: meridiem ? "clock-meridiem" : "clock-24h"
    };
  }

  const meridiemOnly = text.match(/\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?|am|pm)\b/i);

  if (!meridiemOnly) {
    return null;
  }

  const hour = Number(meridiemOnly[1]);

  if (hour < 1 || hour > 12) {
    return null;
  }

  return {
    raw: meridiemOnly[0],
    timeParts: normalizeTimeToken(hour, 0, normalizeMeridiem(meridiemOnly[2])),
    type: "hour-meridiem"
  };
}

function findBareHourTime(text, ambiguityFlags) {
  const match = text.match(/\b(?:at|by|before|around|@)\s+(\d{1,2})(?!\s*(?:st|nd|rd|th)?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)|[./:-]\d)/i);

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);

  if (hour < 1 || hour > 12) {
    return null;
  }

  addFlag(ambiguityFlags, "missing-meridiem");

  return {
    raw: match[0],
    timeParts: normalizeTimeToken(hour <= 7 ? hour + 12 : hour, 0, ""),
    type: "bare-hour"
  };
}

function normalizeDateToken(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return { year, month, day };
}

function normalizeTimeToken(hour, minute = 0, meridiem = "") {
  let normalizedHour = Number(hour);
  const normalizedMinute = Number(minute);

  if (meridiem === "am" && normalizedHour === 12) {
    normalizedHour = 0;
  } else if (meridiem === "pm" && normalizedHour < 12) {
    normalizedHour += 12;
  }

  return {
    hours: normalizedHour,
    minutes: normalizedMinute,
    source: meridiem ? "explicit-meridiem" : "explicit-24h-or-inferred"
  };
}

function resolveRelativeDate(phrase, baseDate = new Date()) {
  return findRelativeDate(phrase, baseDate, []) || findWeekdayDate(phrase, baseDate, []);
}

function buildResolvedDateTime(dateParts, timeParts) {
  return new Date(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hours,
    timeParts.minutes,
    0,
    0
  );
}

function dueDateFromDateOnly(date, defaultHour = 23, defaultMinute = 59) {
  if (!date) {
    return null;
  }

  const sourceDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10)),
        0,
        0,
        0,
        0
      )
    : new Date(date);

  if (Number.isNaN(sourceDate.getTime())) {
    return null;
  }

  return new Date(
    sourceDate.getFullYear(),
    sourceDate.getMonth(),
    sourceDate.getDate(),
    defaultHour,
    defaultMinute,
    0,
    0
  );
}

function deadlineFieldsFromExtraction(extraction, parseSource) {
  if (!extraction) {
    return {};
  }

  return {
    dueTime: extraction.dueTime || "",
    dueDateTime: extraction.resolvedDateTime || null,
    rawDetectedDeadlineText: extraction.rawDetectedDeadlineText || "",
    parseConfidence: extraction.confidence || "low",
    ambiguityFlags: extraction.ambiguityFlags || [],
    parseSource: parseSource || extraction.extractionSource || "",
    needsUserReview: Boolean(extraction.needsUserReview),
    deadlineExtraction: {
      rawDateToken: extraction.rawDateToken || "",
      rawTimeToken: extraction.rawTimeToken || "",
      matchedIntentPhrases: extraction.matchedIntentPhrases || [],
      urgencyBoosters: extraction.urgencyBoosters || [],
      defaultTimeApplied: Boolean(extraction.defaultTimeApplied),
      timezone: extraction.timezone || ""
    }
  };
}

function resolveDeadlineForRecord({ text = "", providedDueDate = null, baseDate = new Date(), parseSource = "manual" } = {}) {
  const extraction = extractDeadlineFromText(text, providedDueDate || baseDate);

  if (providedDueDate) {
    const dateOnly = dueDateFromDateOnly(providedDueDate);

    if (dateOnly && !extraction.resolvedDateTime) {
      extraction.resolvedDateTime = dateOnly;
      extraction.dueDate = formatDateOnly(dateOnly);
      extraction.dueTime = formatTime({ hours: 23, minutes: 59 });
      extraction.rawDetectedDeadlineText = extraction.rawDetectedDeadlineText || String(text || "");
      extraction.defaultTimeApplied = true;
      addFlag(extraction.ambiguityFlags, "default-time-applied");
    }

    if (dateOnly && extraction.dueTime && extraction.rawTimeToken && !extraction.rawDateToken) {
      const [hours, minutes] = String(extraction.dueTime || "23:59").split(":").map(Number);
      const mergedDate = new Date(
        dateOnly.getFullYear(),
        dateOnly.getMonth(),
        dateOnly.getDate(),
        Number.isFinite(hours) ? hours : 23,
        Number.isFinite(minutes) ? minutes : 59,
        0,
        0
      );

      extraction.resolvedDateTime = mergedDate;
      extraction.dueDate = formatDateOnly(mergedDate);
      extraction.needsUserReview = extraction.needsUserReview || !extraction.rawDateToken;
      addFlag(extraction.ambiguityFlags, "provided-date-used");
    }
  }

  return {
    extraction,
    dueDate: extraction.resolvedDateTime || null,
    fields: deadlineFieldsFromExtraction(extraction, parseSource)
  };
}

function logDeadlineExtraction(extraction, context = {}) {
  if (!extraction) {
    return;
  }

  logger.info("deadline.extracted", {
    ...context,
    rawDateToken: extraction.rawDateToken,
    rawTimeToken: extraction.rawTimeToken,
    resolvedDateTime: extraction.resolvedDateTime ? extraction.resolvedDateTime.toISOString() : "",
    confidence: extraction.confidence,
    ambiguityFlags: extraction.ambiguityFlags
  });
}

function scoreConfidence({ dateCandidate, timeCandidate, resolvedDateTime, hasAcademicIntent, urgencyBoosters, ambiguityFlags }) {
  if (!resolvedDateTime) {
    return "low";
  }

  let score = 0;
  score += dateCandidate ? 3 : 0;
  score += timeCandidate ? 2 : 0;
  score += hasAcademicIntent ? 2 : 0;
  score += urgencyBoosters && urgencyBoosters.length ? 1 : 0;
  score -= ambiguityFlags.filter((flag) => flag !== "default-time-applied").length * 2;
  score -= ambiguityFlags.includes("default-time-applied") ? 1 : 0;

  if (score >= 6) {
    return "high";
  }

  if (score >= 3) {
    return "medium";
  }

  return "low";
}

function findMatches(lowerText, phrases) {
  return phrases.filter((phrase) => lowerText.includes(phrase));
}

function extractContextSnippet(text) {
  const match = text.match(/(?:submit|deadline|due|complete|turn in|upload|present|demo|viva|exam|lab|last date|before|by|on|at).{0,120}/i);
  return (match ? match[0] : text).trim().slice(0, 180);
}

function inferYear(month, day, baseDate) {
  const base = new Date(baseDate);
  const candidate = new Date(base.getFullYear(), month - 1, day, 23, 59, 0, 0);
  const startOfToday = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);

  return candidate < startOfToday ? base.getFullYear() + 1 : base.getFullYear();
}

function normalizeYear(value) {
  const year = String(value);

  if (year.length === 2) {
    return `20${year}`;
  }

  return year;
}

function normalizeMeridiem(value) {
  const normalized = String(value || "").toLowerCase().replace(/\./g, "");

  if (normalized === "am" || normalized === "pm") {
    return normalized;
  }

  return "";
}

function relativeCandidate(raw, date, type) {
  return {
    raw,
    dateParts: dateToParts(date),
    type
  };
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function nextWeekday(baseDate, targetWeekday, forceNextWeek) {
  const base = new Date(baseDate);
  let days = (targetWeekday - base.getDay() + 7) % 7;

  if (forceNextWeek || days === 0) {
    days += 7;
  }

  return addDays(base, days);
}

function resolveWeekday(baseDate, targetWeekday, qualifier = "") {
  const base = new Date(baseDate);
  let days = (targetWeekday - base.getDay() + 7) % 7;

  if (qualifier === "next") {
    days = days === 0 ? 7 : days;
  }

  if (qualifier === "coming") {
    days = days === 0 ? 7 : days;
  }

  return addDays(base, days);
}

function nearestDateForTime(baseDate, timeParts) {
  const base = new Date(baseDate);
  const candidate = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    timeParts.hours,
    timeParts.minutes,
    0,
    0
  );

  if (candidate < base) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate;
}

function dateToParts(date) {
  const nextDate = new Date(date);
  return {
    year: nextDate.getFullYear(),
    month: nextDate.getMonth() + 1,
    day: nextDate.getDate()
  };
}

function formatDateOnly(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatTime(timeParts) {
  return `${String(timeParts.hours).padStart(2, "0")}:${String(timeParts.minutes).padStart(2, "0")}`;
}

function addFlag(flags, flag) {
  if (!flags.includes(flag)) {
    flags.push(flag);
  }
}

module.exports = {
  buildResolvedDateTime,
  deadlineFieldsFromExtraction,
  resolveDeadlineForRecord,
  dueDateFromDateOnly,
  extractDeadlineFromText,
  logDeadlineExtraction,
  normalizeDateToken,
  normalizeTimeToken,
  resolveRelativeDate
};
