const cron = require("node-cron");

const appConfig = require("../config/appConfig");
const Assignment = require("../models/Assignment");
const Reminder = require("../models/Reminder");
const { sendNotification } = require("./notificationService");
const { toDateKey } = require("./streakService");
const logger = require("../utils/logger");

let scheduledTask;

function notificationWindows(diffMs) {
  const sixHours = 6 * 60 * 60 * 1000;
  const day = 24 * 60 * 60 * 1000;

  if (diffMs > sixHours && diffMs <= day) {
    return {
      triggerType: "due-in-24-hours",
      triggerKey: "due-24h"
    };
  }

  if (diffMs > 0 && diffMs <= sixHours) {
    return {
      triggerType: "due-in-6-hours",
      triggerKey: "due-6h"
    };
  }

  if (diffMs <= -day) {
    return {
      triggerType: "overdue-by-1-day",
      triggerKey: "overdue-1d"
    };
  }

  return null;
}

function entityHasSentKey(entity, key) {
  return Boolean(
    entity.notificationState &&
      Array.isArray(entity.notificationState.sentKeys) &&
      entity.notificationState.sentKeys.includes(key)
  );
}

async function markEntityKeySent(entity, key) {
  if (!entity.notificationState) {
    entity.notificationState = { sentKeys: [] };
  }

  if (!Array.isArray(entity.notificationState.sentKeys)) {
    entity.notificationState.sentKeys = [];
  }

  if (!entity.notificationState.sentKeys.includes(key)) {
    entity.notificationState.sentKeys.push(key);
  }

  entity.notificationState.lastNotificationAt = new Date();
  await entity.save();
}

function buildAssignmentNotificationPayload(assignment, user, windowInfo) {
  return {
    user,
    entityType: "assignment",
    entityId: assignment._id,
    title: assignment.title,
    subject: assignment.subject,
    course: assignment.course,
    dueDate: assignment.dueDate,
    priorityBand: assignment.priorityBand,
    source: assignment.source,
    triggerType: windowInfo.triggerType,
    triggerKey: `assignment:${assignment._id}:${windowInfo.triggerKey}`
  };
}

function buildReminderNotificationPayload(reminder, user, windowInfo, linkedAssignment = null) {
  return {
    user,
    entityType: "reminder",
    entityId: reminder._id,
    title: reminder.title,
    subject: reminder.subject || (linkedAssignment ? linkedAssignment.subject : ""),
    course: reminder.course || (linkedAssignment ? linkedAssignment.course : ""),
    dueDate: reminder.dueDate,
    priorityBand: reminder.priorityBand || (linkedAssignment ? linkedAssignment.priorityBand : "medium"),
    source: reminder.source || (linkedAssignment ? linkedAssignment.source : "manual"),
    triggerType: windowInfo.triggerType,
    triggerKey: `reminder:${reminder._id}:${windowInfo.triggerKey}`
  };
}

async function processAssignments(now) {
  const assignments = await Assignment.find({
    status: { $ne: "completed" },
    dueDate: { $ne: null }
  })
    .sort({ dueDate: 1 })
    .limit(appConfig.reminderSweepBatchSize)
    .populate("user", "name email");

  let sentCount = 0;

  for (const assignment of assignments) {
    const diffMs = new Date(assignment.dueDate).getTime() - now.getTime();
    const windowInfo = notificationWindows(diffMs);

    if (!windowInfo) {
      continue;
    }

    const sentKey = `assignment:${assignment._id}:${windowInfo.triggerKey}`;

    if (entityHasSentKey(assignment, sentKey)) {
      continue;
    }

    await sendNotification(buildAssignmentNotificationPayload(assignment, assignment.user, windowInfo));
    await markEntityKeySent(assignment, sentKey);
    sentCount += 1;
  }

  return sentCount;
}

async function processReminders(now) {
  const reminders = await Reminder.find({
    status: "pending"
  })
    .sort({ dueDate: 1, createdAt: -1 })
    .limit(appConfig.reminderSweepBatchSize)
    .populate("user", "name email")
    .populate("assignment", "subject course priorityBand source");

  let sentCount = 0;

  for (const reminder of reminders) {
    let windowInfo = null;

    if (reminder.dueDate) {
      const diffMs = new Date(reminder.dueDate).getTime() - now.getTime();
      windowInfo = notificationWindows(diffMs);
    } else if (["manual", "auto-note"].includes(reminder.source)) {
      windowInfo = {
        triggerType: "pending-reminder-digest",
        triggerKey: `pending-${toDateKey(now)}`
      };
    }

    if (!windowInfo) {
      continue;
    }

    const sentKey = `reminder:${reminder._id}:${windowInfo.triggerKey}`;

    if (entityHasSentKey(reminder, sentKey)) {
      continue;
    }

    await sendNotification(
      buildReminderNotificationPayload(reminder, reminder.user, windowInfo, reminder.assignment)
    );
    await markEntityKeySent(reminder, sentKey);
    sentCount += 1;
  }

  return sentCount;
}

async function runReminderSweep() {
  const now = new Date();
  // The sweep uses coarse windows so the job can run frequently without sending duplicates.
  const [assignmentNotifications, reminderNotifications] = await Promise.all([
    processAssignments(now),
    processReminders(now)
  ]);

  logger.info("scheduler.reminder-sweep.completed", {
    ranAt: now.toISOString(),
    assignmentNotifications,
    reminderNotifications
  });

  return {
    ranAt: now.toISOString(),
    assignmentNotifications,
    reminderNotifications
  };
}

function startReminderScheduler() {
  const isEnabled = appConfig.reminderSchedulerEnabled;

  if (!isEnabled) {
    logger.info("scheduler.reminder-sweep.disabled");
    return null;
  }

  if (scheduledTask) {
    return scheduledTask;
  }

  const cronExpression = appConfig.reminderCron;
  scheduledTask = cron.schedule(
    cronExpression,
    async () => {
      try {
        await runReminderSweep();
      } catch (error) {
        logger.error("scheduler.reminder-sweep.failed", {
          message: error.message
        });
      }
    },
    {
      scheduled: false
    }
  );

  scheduledTask.start();
  logger.info("scheduler.reminder-sweep.started", {
    cronExpression
  });
  runReminderSweep().catch((error) => {
    logger.error("scheduler.reminder-sweep.initial-failed", {
      message: error.message
    });
  });

  return scheduledTask;
}

module.exports = {
  runReminderSweep,
  startReminderScheduler
};
