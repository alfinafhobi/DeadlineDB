const assert = require("assert");

const { buildGmailQuery } = require("../src/services/gmailAdapter");
const { filterCourses } = require("../src/services/googleClassroomAdapter");
const { extractVisibleChatsFromUpdates } = require("../src/services/telegramAdapter");
const {
  classifyGmailMessage,
  normalizeClassroomAnnouncement,
  normalizeClassroomItem
} = require("../src/services/providerNormalizationService");

function runGoogleClassroomFilterTests() {
  const courses = [
    { id: "1", name: "Cloud Computing" },
    { id: "2", name: "DBMS" },
    { id: "3", name: "Software Engineering" }
  ];

  let result = filterCourses(courses, { courseNames: ["cloud computing"] }, []);
  assert.strictEqual(result.matchedCourses.length, 1, "should match one course by normalized name");
  assert.strictEqual(result.matchedCourses[0].id, "1");

  result = filterCourses(courses, { courseNames: ["cloud computing", "dbms"] }, []);
  assert.strictEqual(result.matchedCourses.length, 2, "should match multiple selected course names");

  result = filterCourses(courses, { courseIds: ["2"] }, []);
  assert.strictEqual(result.matchedCourses.length, 1, "should match exact course ID");
  assert.strictEqual(result.matchedCourses[0].name, "DBMS");

  result = filterCourses(courses, { courseNames: ["  software   engineering  "] }, []);
  assert.strictEqual(result.matchedCourses.length, 1, "should ignore case and extra spaces in course names");
  assert.strictEqual(result.matchedCourses[0].id, "3");

  result = filterCourses(courses, {}, []);
  assert.strictEqual(result.matchedCourses.length, 3, "should return all courses when no filters are set");

  const normalizedCoursework = normalizeClassroomItem({
    resourceType: "courseWork",
    course: { id: "1", name: "Cloud Computing" },
    item: {
      id: "cw1",
      title: "Assignment 1",
      description: "Submit by 18 Apr 2026 at 10 AM",
      dueDate: { year: 2026, month: 4, day: 18 },
      dueTime: { hours: 10, minutes: 0 },
      creationTime: "2026-04-14T09:00:00.000Z",
      workType: "ASSIGNMENT",
      alternateLink: "https://classroom.google.com/test"
    },
    connection: {
      providerAccountId: "acct-1",
      providerEmail: "student@example.com",
      label: "Google Classroom"
    }
  });

  assert(normalizedCoursework, "courseWork should normalize successfully");
  assert.strictEqual(normalizedCoursework.importType, "assignment", "courseWork should import as assignment");

  const normalizedAnnouncement = normalizeClassroomItem({
    resourceType: "announcement",
    course: { id: "1", name: "Cloud Computing" },
    item: {
      id: "ann1",
      text: "Class cancelled tomorrow"
    },
    connection: {
      providerAccountId: "acct-1",
      providerEmail: "student@example.com",
      label: "Google Classroom"
    }
  });

  assert.strictEqual(normalizedAnnouncement, null, "non-instruction announcements should stay skipped");

  const instructionAnnouncement = normalizeClassroomAnnouncement(
    { id: "1", name: "Cloud Computing" },
    {
      id: "ann2",
      text: "All students are requested to upload the videos and E-report before this Wednesday for correction.",
      creationTime: "2026-04-14T09:00:00.000Z",
      alternateLink: "https://classroom.google.com/a/test"
    },
    {
      providerAccountId: "acct-1",
      providerEmail: "student@example.com",
      label: "Google Classroom"
    }
  );

  assert(instructionAnnouncement, "instruction-based announcements should import");
  assert.strictEqual(instructionAnnouncement.importType, "announcement", "instruction-based announcement should classify as announcement");
}

function runGmailFilterTests() {
  const queryOnly = buildGmailQuery({
    query: "(assignment OR deadline OR submit OR due)"
  });
  assert(queryOnly.includes("assignment"), "query-only configuration should preserve the Gmail query");

  const queryWithFilters = buildGmailQuery({
    query: "(assignment OR deadline OR submit OR due)",
    senderFilters: ["faculty@college.edu", "professor@college.edu"],
    keywordFilters: ["assignment", "deadline", "submit", "due"]
  });
  assert(queryWithFilters.includes("from:faculty@college.edu"), "sender filters should be combined into the Gmail query");
  assert(queryWithFilters.includes("\"assignment\""), "keyword filters should be combined into the Gmail query");

  const connection = {
    providerAccountId: "gmail-account",
    providerEmail: "student@example.com",
    label: "Academic Gmail"
  };

  let outcome = classifyGmailMessage({
    id: "m1",
    threadId: "t1",
    labelIds: ["INBOX"],
    subject: "DBMS assignment 2",
    from: "Professor Xavier <faculty@college.edu>",
    snippet: "Submit before Friday",
    body: "Please submit Assignment 2 by 18 Apr 2026 at 10 AM.",
    receivedAt: new Date("2026-04-14T09:00:00+05:30"),
    sourceUrl: "https://mail.google.com/test/1"
  }, {
    senderFilters: ["faculty@college.edu"],
    keywordFilters: ["assignment", "submit", "due"]
  }, connection);
  assert(outcome.normalizedItem, "academic email with due date should import");
  assert.strictEqual(outcome.diagnostics.classification, "assignment", "due-date academic email should classify as assignment");

  outcome = classifyGmailMessage({
    id: "m2",
    threadId: "t2",
    labelIds: ["INBOX"],
    subject: "Class announcement: seminar tomorrow",
    from: "Department Office <faculty@college.edu>",
    snippet: "Department seminar notice",
    body: "Important announcement: workshop tomorrow morning in Seminar Hall.",
    receivedAt: new Date("2026-04-14T09:00:00+05:30"),
    sourceUrl: "https://mail.google.com/test/2"
  }, {
    senderFilters: ["faculty@college.edu"]
  }, connection);
  assert(outcome.normalizedItem, "academic notice should still import");
  assert.strictEqual(outcome.diagnostics.classification, "announcement", "notices should classify as announcements");

  outcome = classifyGmailMessage({
    id: "m3",
    threadId: "t3",
    labelIds: ["INBOX"],
    subject: "Weekly newsletter with assignment tips",
    from: "Marketing Team <newsletter@example.com>",
    snippet: "Special offer just for you",
    body: "<html><body><h1>Assignment success sale</h1><p>Unsubscribe here</p><p>Special offer and discount for premium users.</p></body></html>",
    receivedAt: new Date("2026-04-14T09:00:00+05:30"),
    sourceUrl: "https://mail.google.com/test/3"
  }, {
    keywordFilters: ["assignment"]
  }, connection);
  assert.strictEqual(outcome.normalizedItem, null, "newsletter noise should be skipped even if it contains a keyword coincidence");

  outcome = classifyGmailMessage({
    id: "m4",
    threadId: "t4",
    labelIds: ["INBOX"],
    subject: "Assignment reminder",
    from: "alerts@example.com",
    snippet: "submit by tonight",
    body: "Assignment reminder: submit by tonight.",
    receivedAt: new Date("2026-04-14T09:00:00+05:30"),
    sourceUrl: "https://mail.google.com/test/4"
  }, {
    senderFilters: ["faculty@college.edu"],
    keywordFilters: ["assignment", "submit"]
  }, connection);
  assert.strictEqual(outcome.normalizedItem, null, "sender filters should block non-matching senders");
  assert.strictEqual(outcome.diagnostics.skippedReason, "sender-filter-miss");
}

function runTelegramDiscoveryTests() {
  const chats = extractVisibleChatsFromUpdates([
    {
      update_id: 1001,
      message: {
        message_id: 11,
        date: 1776141000,
        text: "Submit DBMS lab record by tomorrow at 5 PM.",
        chat: {
          id: -100111,
          title: "DBMS Lab Section 3",
          type: "supergroup"
        },
        from: {
          first_name: "Faculty",
          last_name: "One",
          username: "faculty_one"
        }
      }
    },
    {
      update_id: 1002,
      message: {
        message_id: 12,
        date: 1776144600,
        text: "Reminder: seminar tomorrow morning.",
        chat: {
          id: -100111,
          title: "DBMS Lab Section 3",
          type: "supergroup"
        },
        from: {
          first_name: "Faculty",
          username: "faculty_one"
        }
      }
    },
    {
      update_id: 1003,
      channel_post: {
        message_id: 20,
        date: 1776148200,
        text: "Assignment due Friday evening.",
        chat: {
          id: -100222,
          title: "Deep Learning Notices",
          type: "channel"
        },
        sender_chat: {
          title: "Deep Learning Notices"
        }
      }
    }
  ]);

  assert.strictEqual(chats.length, 2, "telegram discovery should collapse repeated messages from the same chat");
  assert.strictEqual(chats[0].chatId, "-100222", "telegram discovery should sort chats by most recent visible update");
  assert.strictEqual(chats[1].chatId, "-100111");
  assert.strictEqual(chats[1].lastMessagePreview, "Reminder: seminar tomorrow morning.");
}

function main() {
  runGoogleClassroomFilterTests();
  runGmailFilterTests();
  runTelegramDiscoveryTests();
  process.stdout.write("integration filter tests passed\n");
}

main();
