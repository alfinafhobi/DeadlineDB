const mongoose = require("mongoose");

const reminderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      default: ""
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
      type: Date
    },
    dueTime: {
      type: String,
      default: ""
    },
    dueDateTime: {
      type: Date,
      default: null
    },
    rawDetectedDeadlineText: {
      type: String,
      default: ""
    },
    parseConfidence: {
      type: String,
      enum: ["high", "medium", "low", ""],
      default: ""
    },
    ambiguityFlags: {
      type: [String],
      default: []
    },
    parseSource: {
      type: String,
      default: ""
    },
    needsUserReview: {
      type: Boolean,
      default: false
    },
    deadlineExtraction: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    source: {
      type: String,
      enum: ["auto-note", "manual", "integration"],
      default: "manual"
    },
    status: {
      type: String,
      enum: ["pending", "done", "dismissed"],
      default: "pending"
    },
    priorityBand: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium"
    },
    notificationState: {
      sentKeys: {
        type: [String],
        default: []
      },
      lastNotificationAt: {
        type: Date,
        default: null
      }
    },
    note: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Note"
    },
    assignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assignment"
    },
    sourceRef: {
      externalKey: {
        type: String,
        default: ""
      },
      connection: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SourceConnection"
      },
      provider: {
        type: String,
        default: ""
      },
      sourceAccountId: {
        type: String,
        default: ""
      },
      sourceItemId: {
        type: String,
        default: ""
      },
      sourceMessageId: {
        type: String,
        default: ""
      },
      sourceUrl: {
        type: String,
        default: ""
      },
      rawMetadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      }
    }
  },
  {
    timestamps: true
  }
);

reminderSchema.index({
  user: 1,
  status: 1,
  dueDate: 1
});

reminderSchema.index({
  status: 1,
  dueDate: 1
});

reminderSchema.index({
  user: 1,
  "sourceRef.externalKey": 1
});

reminderSchema.index({
  user: 1,
  needsUserReview: 1,
  dueDate: 1
});

module.exports = mongoose.model("Reminder", reminderSchema);
