const crypto = require("crypto");

const {
  deadlineFieldsFromExtraction,
  extractDeadlineFromText
} = require("./deadlineExtractionService");

const ASSIGNMENT_KEYWORDS = [
  "assignment",
  "submit",
  "deadline",
  "due",
  "quiz",
  "project",
  "lab",
  "exam",
  "demo",
  "viva",
  "presentation",
  "worksheet",
  "homework",
  "turn in",
  "turn-in",
  "upload",
  "complete by"
];

const ANNOUNCEMENT_KEYWORDS = [
  "announcement",
  "notice",
  "schedule update",
  "class update",
  "meeting",
  "seminar",
  "workshop",
  "holiday",
  "rescheduled",
  "postponed",
  "cancelled",
  "canceled"
];

const CLASSROOM_INSTRUCTION_ANNOUNCEMENT_KEYWORDS = [
  "submit",
  "upload",
  "complete",
  "bring",
  "prepare",
  "read",
  "review",
  "correct",
  "record",
  "report",
  "e-report",
  "video",
  "presentation",
  "worksheet",
  "lab",
  "experiment",
  "demo",
  "viva",
  "exam",
  "quiz",
  "mandatory",
  "compulsory",
  "without fail",
  "before",
  "by this",
  "last minute",
  "late submission"
];

const ACADEMIC_CONTEXT_KEYWORDS = [
  "course",
  "class",
  "faculty",
  "professor",
  "lecturer",
  "department",
  "semester",
  "internal",
  "practical",
  "section",
  "batch",
  "lab",
  "exam"
];

const NOISE_KEYWORDS = [
  "unsubscribe",
  "newsletter",
  "promotional",
  "promotion",
  "job alert",
  "career",
  "hiring",
  "discount",
  "coupon",
  "sale",
  "offer",
  "sponsored",
  "marketing"
];

function normalizeToken(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function uniqueValues(values = []) {
  const seen = new Set();

  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeToken(value);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function countPhraseHits(text = "", phrases = []) {
  const normalizedText = normalizeToken(text);

  return uniqueValues(phrases).reduce((count, phrase) => {
    const normalizedPhrase = normalizeToken(phrase);
    return count + (normalizedPhrase && normalizedText.includes(normalizedPhrase) ? 1 : 0);
  }, 0);
}

function extractEmailAddress(value = "") {
  const match = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

function stripHtml(value = "") {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function sanitizeEmailText(value = "") {
  return stripHtml(value)
    .replace(/\r/g, "")
    .trim();
}

function isAcademicAction(text = "") {
  return countPhraseHits(text, ASSIGNMENT_KEYWORDS) > 0;
}

function isAcademicAnnouncement(text = "") {
  return countPhraseHits(text, ANNOUNCEMENT_KEYWORDS) > 0;
}

function isInstructionBasedAnnouncement(text = "") {
  const deadline = extractDeadlineFromText(text, new Date());
  const instructionHits = countPhraseHits(text, CLASSROOM_INSTRUCTION_ANNOUNCEMENT_KEYWORDS);
  return (
    instructionHits > 0 ||
    (Boolean(deadline.resolvedDateTime) && isAcademicAction(text))
  );
}

function hasAcademicContext(text = "") {
  return (
    isAcademicAction(text) ||
    isAcademicAnnouncement(text) ||
    countPhraseHits(text, ACADEMIC_CONTEXT_KEYWORDS) > 0
  );
}

function pickTitle(sourceText, fallback) {
  const line = String(sourceText || "")
    .split(/[\n.!?]/)
    .find(Boolean);

  return String(line || fallback || "Imported academic item")
    .trim()
    .slice(0, 140);
}

function createSyncHash(item) {
  const stableKey = [
    item.sourceProvider,
    item.sourceAccountId || "",
    item.sourceCourseId || "",
    item.sourceItemId || "",
    item.sourceMessageId || "",
    item.title || "",
    item.postedAt ? new Date(item.postedAt).toISOString() : ""
  ].join("|");

  return crypto.createHash("sha256").update(stableKey).digest("hex");
}

function normalizeDueDateFromText(text, baseDate) {
  return extractDeadlineFromText(text, baseDate);
}

function normalizeTextProviderItem(baseItem) {
  const body = `${baseItem.title || ""}\n${baseItem.description || ""}`;
  const deadline = baseItem.deadlineExtractionResult || normalizeDueDateFromText(body, baseItem.postedAt);
  const extractedDueDate = baseItem.dueDate || (deadline ? deadline.resolvedDateTime : null);
  const importType = baseItem.importType || (extractedDueDate ? "assignment" : "reminder");
  const allowImport = isAcademicAction(body) || importType === "announcement";

  if (!allowImport) {
    return null;
  }

  const item = {
    importType,
    ...baseItem,
    title: pickTitle(baseItem.title || baseItem.description, baseItem.title),
    dueDate: extractedDueDate,
    ...deadlineFieldsFromExtraction(deadline, baseItem.sourceProvider)
  };

  if (item.dueDate && item.importType !== "announcement") {
    item.importType = "assignment";
  }

  item.syncHash = createSyncHash(item);
  return item;
}

function normalizeClassroomCoursework(course, courseWork, connection) {
  const dueDate = classroomDueDateToDate(courseWork.dueDate, courseWork.dueTime);
  const parserBaseDate = courseWork.creationTime ? new Date(courseWork.creationTime) : new Date();
  const deadline = extractDeadlineFromText(`${courseWork.title || ""}\n${courseWork.description || ""}`, parserBaseDate);
  const resolvedDueDate = dueDate || deadline.resolvedDateTime;
  const item = {
    sourceProvider: "google-classroom",
    sourceAccountId: connection.providerAccountId || connection.providerEmail || "",
    sourceCourseId: String(course.id || courseWork.courseId || ""),
    sourceItemId: String(courseWork.id || ""),
    sourceMessageId: "",
    title: courseWork.title || "Google Classroom assignment",
    description: courseWork.description || "",
    subject: course.name || course.section || connection.label,
    course: course.name || connection.label,
    dueDate: resolvedDueDate,
    ...deadlineFieldsFromExtraction(
      resolvedDueDate
        ? {
            ...deadline,
            dueDate: formatDateOnly(resolvedDueDate),
            dueTime: formatTimeOnly(resolvedDueDate),
            resolvedDateTime: resolvedDueDate,
            confidence: dueDate ? (courseWork.dueTime ? "high" : "medium") : deadline.confidence,
            extractionSource: "google-classroom",
            ambiguityFlags: dueDate && !courseWork.dueTime ? ["default-time-applied"] : deadline.ambiguityFlags || [],
            needsUserReview: Boolean(!dueDate && deadline.needsUserReview),
            rawDetectedDeadlineText: dueDate
              ? (courseWork.dueTime ? "Google Classroom due date and time" : "Google Classroom due date")
              : deadline.rawDetectedDeadlineText,
            rawDateToken: courseWork.dueDate ? JSON.stringify(courseWork.dueDate) : deadline.rawDateToken || "",
            rawTimeToken: courseWork.dueTime ? JSON.stringify(courseWork.dueTime) : deadline.rawTimeToken || "",
            matchedIntentPhrases: deadline.matchedIntentPhrases || [],
            urgencyBoosters: deadline.urgencyBoosters || [],
            defaultTimeApplied: Boolean(dueDate && !courseWork.dueTime),
            timezone: deadline.timezone || ""
          }
        : deadline,
      "google-classroom"
    ),
    postedAt: courseWork.creationTime ? new Date(courseWork.creationTime) : null,
    sourceUrl: courseWork.alternateLink || "",
    rawMetadata: {
      course,
      courseWork,
      classification: "assignment",
      resourceType: "courseWork",
      workType: courseWork.workType || "UNKNOWN"
    },
    importType: "assignment"
  };

  item.syncHash = createSyncHash(item);
  return item;
}

function normalizeClassroomItem({ resourceType = "courseWork", course, item, connection }) {
  if (resourceType === "courseWork") {
    return normalizeClassroomCoursework(course, item, connection);
  }

  if (resourceType === "announcement") {
    return normalizeClassroomAnnouncement(course, item, connection);
  }

  return null;
}

function normalizeClassroomAnnouncement(course, announcement, connection) {
  const text = String(announcement.text || "").trim();

  if (!text || !isInstructionBasedAnnouncement(text)) {
    return null;
  }

  const parserBaseDate = announcement.creationTime ? new Date(announcement.creationTime) : new Date();
  const deadline = extractDeadlineFromText(text, parserBaseDate);
  const resolvedDueDate = deadline.resolvedDateTime || null;
  const title = pickTitle(text, `${course.name || connection.label} instruction`);
  const item = {
    sourceProvider: "google-classroom",
    sourceAccountId: connection.providerAccountId || connection.providerEmail || "",
    sourceCourseId: String(course.id || announcement.courseId || ""),
    sourceItemId: "",
    sourceMessageId: String(announcement.id || ""),
    title,
    description: text,
    subject: course.name || course.section || connection.label,
    course: course.name || connection.label,
    dueDate: resolvedDueDate,
    ...deadlineFieldsFromExtraction(deadline, "google-classroom"),
    postedAt: announcement.creationTime ? new Date(announcement.creationTime) : null,
    sourceUrl: announcement.alternateLink || "",
    rawMetadata: {
      course,
      announcement,
      classification: "announcement",
      resourceType: "announcement"
    },
    importType: "announcement"
  };

  item.syncHash = createSyncHash(item);
  return item;
}

function matchesSenderFilters(message, senderFilters = []) {
  const normalizedFilters = uniqueValues(senderFilters);

  if (!normalizedFilters.length) {
    return {
      matched: true,
      matchedFilters: [],
      senderValue: extractEmailAddress(message.from || "") || String(message.from || "")
    };
  }

  const senderValue = `${String(message.from || "")} ${extractEmailAddress(message.from || "")}`;
  const normalizedSender = normalizeToken(senderValue);
  const matchedFilters = normalizedFilters.filter((filter) => normalizedSender.includes(normalizeToken(filter)));

  return {
    matched: matchedFilters.length > 0,
    matchedFilters,
    senderValue
  };
}

function matchesKeywordFilters(text, keywordFilters = []) {
  const normalizedFilters = uniqueValues(keywordFilters);

  if (!normalizedFilters.length) {
    return {
      matched: true,
      matchedKeywords: []
    };
  }

  const normalizedText = normalizeToken(text);
  const matchedKeywords = normalizedFilters.filter((filter) => normalizedText.includes(normalizeToken(filter)));

  return {
    matched: matchedKeywords.length > 0,
    matchedKeywords
  };
}

function classifyGmailMessage(message, settings = {}, connection) {
  const cleanedBody = sanitizeEmailText(message.body || "");
  const combinedText = [
    message.subject || "",
    message.snippet || "",
    cleanedBody
  ].filter(Boolean).join("\n");
  const deadline = extractDeadlineFromText(
    combinedText,
    message.receivedAt ? new Date(message.receivedAt) : new Date()
  );
  const senderCheck = matchesSenderFilters(message, settings.senderFilters || []);
  const keywordCheck = matchesKeywordFilters(combinedText, settings.keywordFilters || []);
  const actionHits = countPhraseHits(combinedText, ASSIGNMENT_KEYWORDS);
  const announcementHits = countPhraseHits(combinedText, ANNOUNCEMENT_KEYWORDS);
  const noiseHits = countPhraseHits(combinedText, NOISE_KEYWORDS) + (message.listUnsubscribe ? 1 : 0);
  const dueDateDetected = Boolean(deadline.resolvedDateTime);
  const academicContext = hasAcademicContext(combinedText);
  let classification = "ignore";
  let skippedReason = "";

  if (!senderCheck.matched) {
    skippedReason = "sender-filter-miss";
  } else if (!keywordCheck.matched) {
    skippedReason = "keyword-filter-miss";
  } else if (noiseHits >= 2 && !dueDateDetected && actionHits < 2) {
    skippedReason = "noise-detected";
  } else if (announcementHits >= 1 && academicContext && actionHits === 0) {
    classification = "announcement";
  } else if ((dueDateDetected && academicContext) || actionHits >= 2) {
    classification = dueDateDetected ? "assignment" : "reminder";
  } else if (actionHits >= 1 && academicContext) {
    classification = "reminder";
  } else {
    skippedReason = "not-academic-enough";
  }

  const course = detectCourse(combinedText, settings) || connection.label;
  const normalizedItem = classification === "ignore"
    ? null
    : normalizeTextProviderItem({
        sourceProvider: "gmail",
        sourceAccountId: connection.providerAccountId || connection.providerEmail || "",
        sourceCourseId: "",
        sourceItemId: String(message.id || ""),
        sourceMessageId: String(message.id || ""),
        title: message.subject || "Gmail academic reminder",
        description: combinedText.trim(),
        subject: course,
        course,
        dueDate: deadline.resolvedDateTime,
        deadlineExtractionResult: deadline,
        postedAt: message.receivedAt ? new Date(message.receivedAt) : null,
        sourceUrl: message.sourceUrl || "",
        rawMetadata: {
          from: message.from,
          threadId: message.threadId,
          labelIds: message.labelIds || [],
          classification,
          matchedSenderFilters: senderCheck.matchedFilters,
          matchedKeywordFilters: keywordCheck.matchedKeywords,
          listUnsubscribe: message.listUnsubscribe || ""
        },
        importType: classification
      });

  return {
    normalizedItem,
    diagnostics: {
      classification,
      senderMatched: senderCheck.matched,
      keywordMatched: keywordCheck.matched,
      matchedSenderFilters: senderCheck.matchedFilters,
      matchedKeywordFilters: keywordCheck.matchedKeywords,
      noiseHits,
      actionHits,
      announcementHits,
      dueDateDetected,
      skippedReason
    }
  };
}

function normalizeGmailMessage(message, settings, connection) {
  return classifyGmailMessage(message, settings, connection);
}

function normalizeTelegramMessage(message, connection) {
  const deadline = extractDeadlineFromText(message.text || "", message.timestamp ? new Date(message.timestamp) : new Date());
  const detectedDueDate = deadline.resolvedDateTime;
  const topic = detectCourse(message.text || "", connection.settings || {}) || connection.label;

  return normalizeTextProviderItem({
    sourceProvider: "telegram",
    sourceAccountId: connection.providerAccountId || message.chatId || "",
    sourceCourseId: "",
    sourceItemId: String(message.id || ""),
    sourceMessageId: String(message.id || ""),
    title: pickTitle(message.text, "Telegram academic notice"),
    description: message.text || "",
    subject: topic,
    course: topic,
    dueDate: detectedDueDate,
    deadlineExtractionResult: deadline,
    postedAt: message.timestamp ? new Date(message.timestamp) : new Date(),
    sourceUrl: "",
    rawMetadata: {
      sender: message.sender,
      chatId: message.chatId,
      chatTitle: message.chatTitle,
      chatType: message.chatType,
      senderUsername: message.senderUsername,
      updateId: message.updateId
    },
    importType: detectedDueDate ? "assignment" : "reminder"
  });
}

function formatDateOnly(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatTimeOnly(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function classroomDueDateToDate(dueDate, dueTime) {
  if (!dueDate || !dueDate.year || !dueDate.month || !dueDate.day) {
    return null;
  }

  const hours = dueTime && Number.isInteger(dueTime.hours) ? dueTime.hours : 23;
  const minutes = dueTime && Number.isInteger(dueTime.minutes) ? dueTime.minutes : 59;

  return new Date(dueDate.year, dueDate.month - 1, dueDate.day, hours, minutes, 0);
}

function detectCourse(text = "", settings = {}) {
  const candidates = [
    ...(settings.courseKeywords || []),
    ...(settings.keywordFilters || []),
    ...(settings.courseNames || [])
  ].map((item) => String(item).trim()).filter(Boolean);
  const lowerText = String(text).toLowerCase();

  return candidates.find((candidate) => lowerText.includes(candidate.toLowerCase())) || "";
}

function sourceDisplayName(provider) {
  return {
    gmail: "Gmail",
    "google-classroom": "Google Classroom",
    telegram: "Telegram"
  }[provider] || "Manual";
}

module.exports = {
  classifyGmailMessage,
  createSyncHash,
  extractEmailAddress,
  isAcademicAction,
  isInstructionBasedAnnouncement,
  normalizeClassroomAnnouncement,
  normalizeClassroomCoursework,
  normalizeClassroomItem,
  normalizeGmailMessage,
  normalizeTelegramMessage,
  normalizeTextProviderItem,
  sanitizeEmailText,
  sourceDisplayName
};
