const mongoose = require("mongoose");

const notificationLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    channel: {
      type: String,
      enum: ["in-app", "email", "push"],
      default: "email"
    },
    entityType: {
      type: String,
      enum: ["assignment", "reminder"],
      required: true
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    subject: {
      type: String,
      default: ""
    },
    course: {
      type: String,
      default: ""
    },
    dueDate: {
      type: Date,
      default: null
    },
    priorityBand: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium"
    },
    source: {
      type: String,
      default: ""
    },
    triggerType: {
      type: String,
      required: true
    },
    triggerKey: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ["sent", "simulated", "failed"],
      default: "simulated"
    },
    simulated: {
      type: Boolean,
      default: true
    },
    sentAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

notificationLogSchema.index({
  user: 1,
  sentAt: -1
});

notificationLogSchema.index({
  user: 1,
  triggerKey: 1
});

module.exports = mongoose.model("NotificationLog", notificationLogSchema);
