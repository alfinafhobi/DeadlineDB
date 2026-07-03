const assert = require("assert");

const {
  extractDeadlineFromText
} = require("../src/services/deadlineExtractionService");

const baseDate = new Date(2026, 3, 7, 9, 0, 0, 0);

function expectDateTime(input, expectedDate, expectedTime, extraAssertions = () => {}) {
  const result = extractDeadlineFromText(input, baseDate);
  assert.strictEqual(result.dueDate, expectedDate, `${input} date mismatch`);
  assert.strictEqual(result.dueTime, expectedTime, `${input} time mismatch`);
  assert.ok(result.resolvedDateTime, `${input} should resolve to a datetime`);
  extraAssertions(result);
}

function expectNeedsReview(input, extraAssertions = () => {}) {
  const result = extractDeadlineFromText(input, baseDate);
  assert.ok(result.needsUserReview, `${input} should need review`);
  extraAssertions(result);
}

expectDateTime("submit it on 12-04-2026 without fail", "2026-04-12", "23:59", (result) => {
  assert.ok(result.urgencyBoosters.includes("without fail"));
});

expectDateTime("submit it on 13.04.2026 at 10 AM", "2026-04-13", "10:00", (result) => {
  assert.strictEqual(result.confidence, "high");
});

expectDateTime("lab record submission on 15/04/2026 at 14:30", "2026-04-15", "14:30");

expectDateTime("submit by 13.04.2026 10:30 AM", "2026-04-13", "10:30");

expectDateTime("assignment due tomorrow", "2026-04-08", "23:59");

expectDateTime("upload before Friday", "2026-04-10", "23:59");

expectDateTime("submit before 11:59 PM", "2026-04-07", "23:59", (result) => {
  assert.ok(result.ambiguityFlags.includes("missing-date"));
});

expectDateTime("submit before EOD", "2026-04-07", "23:59", (result) => {
  assert.ok(result.ambiguityFlags.includes("missing-date"));
});

expectDateTime("demo on Apr 18 at noon", "2026-04-18", "12:00");

expectDateTime("assignment by evening", "2026-04-07", "18:00", (result) => {
  assert.ok(result.ambiguityFlags.includes("missing-date"));
});

expectDateTime("lab record due next Monday", "2026-04-13", "23:59");

expectDateTime("complete within 2 days", "2026-04-09", "23:59", (result) => {
  assert.ok(result.ambiguityFlags.includes("default-time-applied"));
});

expectNeedsReview("meeting at 5", (result) => {
  assert.strictEqual(result.dueTime, "17:00");
  assert.strictEqual(result.resolvedDateTime, null);
  assert.ok(result.ambiguityFlags.includes("missing-meridiem"));
});

expectDateTime("deadline 04/05", "2026-05-04", "23:59", (result) => {
  assert.ok(result.ambiguityFlags.includes("ambiguous-date-format"));
  assert.ok(result.ambiguityFlags.includes("missing-year"));
  assert.ok(result.needsUserReview);
});

expectDateTime("submit by tonight", "2026-04-07", "21:00");

process.stdout.write("deadline parser tests passed\n");
