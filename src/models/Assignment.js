const mongoose = require("mongoose");

const assignmentSchema = new mongoose.Schema(
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
    dueDate: {
      type: Date,
      required: true
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
    difficulty: {
      type: Number,
      min: 1,
      max: 5,
      default: 3
    },
    weight: {
      type: Number,
      min: 1,
      max: 5,
      default: 3
    },
    urgency: {
      type: Number,
      min: 1,
      max: 5,
      default: 1
    },
    priorityScore: {
      type: Number,
      default: 1
    },
    priorityBand: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "low"
    },
    subject: {
      type: String,
      required: true,
      trim: true
    },
    course: {
      type: String,
      default: ""
    },
    source: {
      type: String,
      enum: ["Telegram", "Gmail", "Email", "Google Classroom", "Manual"],
      default: "Manual"
    },
    status: {
      type: String,
      enum: ["todo", "in-progress", "completed"],
      default: "todo"
    },
    completedAt: {
      type: Date,
      default: null
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
    sourceRef: {
      externalKey: {
        type: String,
        default: ""
      },
      selector: {
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
      sourceCourseId: {
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

assignmentSchema.index({
  user: 1,
  "sourceRef.externalKey": 1
});

assignmentSchema.index({
  user: 1,
  status: 1,
  dueDate: 1
});

assignmentSchema.index({
  status: 1,
  dueDate: 1
});

assignmentSchema.index({
  user: 1,
  needsUserReview: 1,
  dueDate: 1
});

module.exports = mongoose.model("Assignment", assignmentSchema);
