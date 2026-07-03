const express = require("express");

const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const NotificationLog = require("../models/NotificationLog");
const { notificationQuerySchema } = require("../validation/schemas");

const router = express.Router();

router.use(auth);

router.get("/", validate(notificationQuerySchema, "query"), async (req, res, next) => {
  try {
    const limit = req.query.limit;
    const notifications = await NotificationLog.find({ user: req.user._id })
      .sort({ sentAt: -1, createdAt: -1 })
      .limit(limit);

    res.json({
      success: true,
      notifications
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
