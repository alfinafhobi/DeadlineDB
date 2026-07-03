const express = require("express");

const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const Reminder = require("../models/Reminder");
const { invalidateUserViewCaches } = require("../services/cacheService");
const {
  logDeadlineExtraction,
  resolveDeadlineForRecord
} = require("../services/deadlineExtractionService");
const { reminderCreateSchema, reminderUpdateSchema } = require("../validation/schemas");

const router = express.Router();

router.use(auth);

router.get("/", async (req, res, next) => {
  try {
    const reminders = await Reminder.find({ user: req.user._id }).sort({
      dueDate: 1,
      createdAt: -1
    });

    res.json({
      success: true,
      reminders
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", validate(reminderCreateSchema), async (req, res, next) => {
  try {
    const { title, description, dueDate, priorityBand, subject, course } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Reminder title is required."
      });
    }

    const deadline = resolveDeadlineForRecord({
      text: `${title}\n${description || ""}`,
      providedDueDate: dueDate || null,
      parseSource: "manual-reminder"
    });

    const reminder = await Reminder.create({
      user: req.user._id,
      title,
      description,
      subject,
      course,
      dueDate: deadline.dueDate || dueDate || null,
      ...deadline.fields,
      priorityBand: priorityBand || "medium",
      source: "manual"
    });
    logDeadlineExtraction(deadline.extraction, {
      entity: "reminder",
      route: "reminder.create",
      userId: req.user._id
    });

    invalidateUserViewCaches([req.user._id]);

    res.status(201).json({
      success: true,
      reminder
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", validate(reminderUpdateSchema), async (req, res, next) => {
  try {
    const reminder = await Reminder.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!reminder) {
      return res.status(404).json({
        success: false,
        message: "Reminder not found."
      });
    }

    reminder.title = req.body.title ?? reminder.title;
    reminder.description = req.body.description ?? reminder.description;
    reminder.subject = req.body.subject ?? reminder.subject;
    reminder.course = req.body.course ?? reminder.course;
    const deadline = resolveDeadlineForRecord({
      text: `${req.body.title ?? reminder.title}\n${req.body.description ?? reminder.description ?? ""}`,
      providedDueDate: req.body.dueDate ?? reminder.dueDate ?? null,
      parseSource: "manual-reminder"
    });
    reminder.dueDate = deadline.dueDate || (req.body.dueDate ?? reminder.dueDate);
    reminder.dueTime = deadline.fields.dueTime;
    reminder.dueDateTime = deadline.fields.dueDateTime;
    reminder.rawDetectedDeadlineText = deadline.fields.rawDetectedDeadlineText;
    reminder.parseConfidence = deadline.fields.parseConfidence;
    reminder.ambiguityFlags = deadline.fields.ambiguityFlags;
    reminder.parseSource = deadline.fields.parseSource;
    reminder.needsUserReview = deadline.fields.needsUserReview;
    reminder.deadlineExtraction = deadline.fields.deadlineExtraction;
    reminder.status = req.body.status ?? reminder.status;
    reminder.priorityBand = req.body.priorityBand ?? reminder.priorityBand;
    await reminder.save();
    logDeadlineExtraction(deadline.extraction, {
      entity: "reminder",
      route: "reminder.update",
      userId: req.user._id,
      reminderId: reminder._id
    });
    invalidateUserViewCaches([req.user._id]);

    res.json({
      success: true,
      reminder
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const reminder = await Reminder.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id
    });

    if (!reminder) {
      return res.status(404).json({
        success: false,
        message: "Reminder not found."
      });
    }

    invalidateUserViewCaches([req.user._id]);

    res.json({
      success: true,
      message: "Reminder deleted."
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
