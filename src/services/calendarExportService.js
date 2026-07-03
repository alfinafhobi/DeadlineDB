const { startOfDay } = require("./streakService");

function toIsoString(value) {
  return new Date(value).toISOString();
}

function withDuration(dateValue, minutes = 60) {
  const date = new Date(dateValue);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function buildAssignmentEvent(assignment) {
  const startsAt = assignment.dueDateTime || assignment.dueDate;
  return {
    uid: `assignment-${assignment._id}@deadlinedb`,
    type: "assignment",
    summary: assignment.title,
    description: assignment.description || `Assignment for ${assignment.subject}`,
    dtstart: toIsoString(startsAt),
    dtend: withDuration(startsAt, 60),
    course: assignment.course || "",
    subject: assignment.subject || "",
    source: assignment.source || "Manual",
    status: assignment.status === "completed" ? "COMPLETED" : "CONFIRMED",
    priority: String(assignment.priorityBand || "medium").toUpperCase(),
    categories: ["ASSIGNMENT", assignment.subject, assignment.course, assignment.source].filter(Boolean),
    reminder: {
      action: "DISPLAY",
      triggerMinutesBefore: 60,
      description: `Reminder: ${assignment.title}`
    }
  };
}

function buildReminderEvent(reminder) {
  const startsAt = reminder.dueDateTime || reminder.dueDate;
  return {
    uid: `reminder-${reminder._id}@deadlinedb`,
    type: "reminder",
    summary: reminder.title,
    description: reminder.description || "DeadlineDB reminder",
    dtstart: toIsoString(startsAt),
    dtend: withDuration(startsAt, 30),
    course: reminder.course || "",
    subject: reminder.subject || "",
    source: reminder.source || "manual",
    status: reminder.status === "done" ? "COMPLETED" : "CONFIRMED",
    priority: String(reminder.priorityBand || "medium").toUpperCase(),
    categories: ["REMINDER", reminder.subject, reminder.course, reminder.source].filter(Boolean),
    reminder: {
      action: "DISPLAY",
      triggerMinutesBefore: 30,
      description: `Reminder: ${reminder.title}`
    }
  };
}

function buildCalendarExport(assignments = [], reminders = [], referenceDate = new Date()) {
  const fromDate = startOfDay(referenceDate);
  const assignmentEvents = assignments
    .filter(
      (assignment) =>
        assignment.status !== "completed" &&
        assignment.dueDate &&
        new Date(assignment.dueDate) >= fromDate
    )
    .map(buildAssignmentEvent);

  const reminderEvents = reminders
    .filter(
      (reminder) =>
        reminder.status === "pending" &&
        reminder.dueDate &&
        new Date(reminder.dueDate) >= fromDate
    )
    .map(buildReminderEvent);

  const events = [...assignmentEvents, ...reminderEvents].sort(
    (left, right) => new Date(left.dtstart) - new Date(right.dtstart)
  );

  return {
    generatedAt: new Date().toISOString(),
    eventCount: events.length,
    events
  };
}

module.exports = {
  buildCalendarExport
};
