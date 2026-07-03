const {
  deadlineFieldsFromExtraction,
  extractDeadlineFromText
} = require("./deadlineExtractionService");

const PRIORITY_WORDS = ["submit", "deadline", "due", "reminder", "important", "assignment"];

function scanForKeywords(content = "") {
  const lowerContent = content.toLowerCase();
  return PRIORITY_WORDS.filter((keyword) => lowerContent.includes(keyword));
}

function extractDate(content = "") {
  return extractDeadlineFromText(content).resolvedDateTime;
}

function buildReminderPayload(subject, course, content, noteId) {
  const keywords = scanForKeywords(content);

  if (!keywords.length) {
    return null;
  }

  const firstSentence = content.split(/[\n.!?]/).find(Boolean) || content.slice(0, 80);
  const deadline = extractDeadlineFromText(content);
  const dueDate = deadline.resolvedDateTime;
  const keywordWeight = Math.min(4 + keywords.length, 5);
  const priorityBand =
    keywordWeight >= 5 || deadline.urgencyBoosters.length ? "critical" : keywordWeight >= 4 ? "high" : "medium";

  return {
    title: `${subject} note reminder`,
    description: `${firstSentence.trim()} (${course || subject})`,
    dueDate,
    deadlineExtractionResult: deadline,
    ...deadlineFieldsFromExtraction(deadline, "note"),
    source: "auto-note",
    priorityBand,
    note: noteId,
    keywords
  };
}

module.exports = {
  scanForKeywords,
  buildReminderPayload,
  extractDate
};
