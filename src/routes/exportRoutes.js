const express = require("express");

const appConfig = require("../config/appConfig");
const auth = require("../middleware/auth");
const Assignment = require("../models/Assignment");
const Reminder = require("../models/Reminder");
const { getOrSetCache } = require("../services/cacheService");
const { buildCalendarExport } = require("../services/calendarExportService");
const { buildSharedWorkspace } = require("../services/dashboardService");

const router = express.Router();

router.use(auth);

router.get("/calendar", async (req, res, next) => {
  try {
    const exportPayload = await getOrSetCache(
      `export:${req.user._id}`,
      appConfig.dashboardCacheTtlMs,
      async () => {
        const [assignments, reminders, sharedWorkspace] = await Promise.all([
          Assignment.find({ user: req.user._id }).sort({ dueDate: 1 }),
          Reminder.find({ user: req.user._id }).sort({ dueDate: 1, createdAt: -1 }),
          buildSharedWorkspace(req.user)
        ]);

        return buildCalendarExport(
          [
            ...assignments,
            ...sharedWorkspace.sharedAssignments.map((assignment) => ({
              _id: assignment.id,
              title: assignment.title,
              description: assignment.instructions,
              dueDate: assignment.dueDate,
              course: assignment.course,
              subject: assignment.subject,
              source: `${assignment.source}:${assignment.room ? assignment.room.name : "room"}`,
              priorityBand: assignment.priorityBand,
              status: assignment.userStatus === "completed" ? "completed" : "todo"
            }))
          ],
          reminders
        );
      }
    );

    res.json({
      success: true,
      ...exportPayload
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
