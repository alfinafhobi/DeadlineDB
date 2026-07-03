const express = require("express");

const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const Assignment = require("../models/Assignment");
const { applyAssignmentLifecycle } = require("../services/assignmentLifecycleService");
const { invalidateUserViewCaches } = require("../services/cacheService");
const {
  logDeadlineExtraction,
  resolveDeadlineForRecord
} = require("../services/deadlineExtractionService");
const { calculatePriorityMetrics } = require("../services/priorityService");
const { assignmentCreateSchema, assignmentUpdateSchema } = require("../validation/schemas");

const router = express.Router();

router.use(auth);

router.get("/", async (req, res, next) => {
  try {
    const filters = { user: req.user._id };

    if (req.query.status) {
      filters.status = req.query.status;
    }

    if (req.query.subject) {
      filters.subject = req.query.subject;
    }

    const assignments = await Assignment.find(filters).sort({
      dueDate: 1,
      createdAt: -1
    });

    res.json({
      success: true,
      assignments
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", validate(assignmentCreateSchema), async (req, res, next) => {
  try {
    const {
      title,
      description,
      dueDate,
      difficulty,
      weight,
      subject,
      course,
      source,
      status
    } = req.body;

    if (!title || !dueDate || !subject) {
      return res.status(400).json({
        success: false,
        message: "Title, due date, and subject are required."
      });
    }

    const deadline = resolveDeadlineForRecord({
      text: `${title}\n${description || ""}`,
      providedDueDate: dueDate,
      parseSource: "manual-assignment"
    });
    const metrics = calculatePriorityMetrics({ dueDate: deadline.dueDate || dueDate, difficulty, weight });
    const assignmentPayload = applyAssignmentLifecycle({
      user: req.user._id,
      title,
      description,
      dueDate: deadline.dueDate || dueDate,
      difficulty,
      weight,
      subject,
      course,
      source: source || "Manual",
      status: status || "todo",
      ...deadline.fields,
      ...metrics
    });
    const assignment = await Assignment.create(assignmentPayload);
    logDeadlineExtraction(deadline.extraction, {
      entity: "assignment",
      route: "assignment.create",
      userId: req.user._id
    });
    invalidateUserViewCaches([req.user._id]);

    res.status(201).json({
      success: true,
      assignment
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const assignment = await Assignment.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found."
      });
    }

    res.json({
      success: true,
      assignment
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", validate(assignmentUpdateSchema), async (req, res, next) => {
  try {
    const assignment = await Assignment.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found."
      });
    }

    const nextValues = {
      title: req.body.title ?? assignment.title,
      description: req.body.description ?? assignment.description,
      dueDate: req.body.dueDate ?? assignment.dueDate,
      difficulty: req.body.difficulty ?? assignment.difficulty,
      weight: req.body.weight ?? assignment.weight,
      subject: req.body.subject ?? assignment.subject,
      course: req.body.course ?? assignment.course,
      source: req.body.source ?? assignment.source,
      status: req.body.status ?? assignment.status
    };

    const deadline = resolveDeadlineForRecord({
      text: `${nextValues.title}\n${nextValues.description || ""}`,
      providedDueDate: nextValues.dueDate,
      parseSource: "manual-assignment"
    });
    nextValues.dueDate = deadline.dueDate || nextValues.dueDate;
    const metrics = calculatePriorityMetrics(nextValues);
    const lifecycleValues = applyAssignmentLifecycle(
      {
        ...nextValues,
        ...deadline.fields,
        ...metrics
      },
      assignment
    );

    Object.assign(assignment, lifecycleValues);
    await assignment.save();
    logDeadlineExtraction(deadline.extraction, {
      entity: "assignment",
      route: "assignment.update",
      userId: req.user._id,
      assignmentId: assignment._id
    });
    invalidateUserViewCaches([req.user._id]);

    res.json({
      success: true,
      assignment
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const assignment = await Assignment.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found."
      });
    }

    invalidateUserViewCaches([req.user._id]);

    res.json({
      success: true,
      message: "Assignment deleted."
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
