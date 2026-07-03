const express = require("express");

const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const Note = require("../models/Note");
const Reminder = require("../models/Reminder");
const { invalidateUserViewCaches } = require("../services/cacheService");
const { logDeadlineExtraction } = require("../services/deadlineExtractionService");
const { scanForKeywords, buildReminderPayload } = require("../services/keywordScanner");
const { noteCreateSchema } = require("../validation/schemas");

const router = express.Router();

router.use(auth);

router.get("/", async (req, res, next) => {
  try {
    const notes = await Note.find({ user: req.user._id }).sort({ createdAt: -1 });

    res.json({
      success: true,
      notes
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", validate(noteCreateSchema), async (req, res, next) => {
  try {
    const { subject, course, content } = req.body;

    if (!subject || !content) {
      return res.status(400).json({
        success: false,
        message: "Subject and note content are required."
      });
    }

    const detectedKeywords = scanForKeywords(content);
    const note = await Note.create({
      user: req.user._id,
      subject,
      course,
      content,
      detectedKeywords
    });

    let reminder = null;
    const reminderPayload = buildReminderPayload(subject, course, content, note._id);

    if (reminderPayload) {
      reminder = await Reminder.create({
        user: req.user._id,
        title: reminderPayload.title,
        description: reminderPayload.description,
        subject,
        course,
        dueDate: reminderPayload.dueDate,
        dueTime: reminderPayload.dueTime,
        dueDateTime: reminderPayload.dueDateTime,
        rawDetectedDeadlineText: reminderPayload.rawDetectedDeadlineText,
        parseConfidence: reminderPayload.parseConfidence,
        ambiguityFlags: reminderPayload.ambiguityFlags,
        parseSource: reminderPayload.parseSource,
        needsUserReview: reminderPayload.needsUserReview,
        deadlineExtraction: reminderPayload.deadlineExtraction,
        source: reminderPayload.source,
        priorityBand: reminderPayload.priorityBand,
        note: note._id
      });
      logDeadlineExtraction(reminderPayload.deadlineExtractionResult || {
        rawDateToken: reminderPayload.deadlineExtraction ? reminderPayload.deadlineExtraction.rawDateToken : "",
        rawTimeToken: reminderPayload.deadlineExtraction ? reminderPayload.deadlineExtraction.rawTimeToken : "",
        resolvedDateTime: reminderPayload.dueDateTime || reminderPayload.dueDate || null,
        confidence: reminderPayload.parseConfidence || "low",
        ambiguityFlags: reminderPayload.ambiguityFlags || []
      }, {
        entity: "note-reminder",
        route: "note.create",
        userId: req.user._id,
        noteId: note._id
      });
    }

    invalidateUserViewCaches([req.user._id]);

    res.status(201).json({
      success: true,
      note,
      reminder
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
