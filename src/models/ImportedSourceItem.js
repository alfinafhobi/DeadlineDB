const mongoose = require("mongoose");

const importedSourceItemSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    connection: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SourceConnection",
      required: true
    },
    sourceProvider: {
      type: String,
      enum: ["google-classroom", "gmail", "telegram"],
      required: true
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
      type: Date,
      default: null
    },
    dueTime: {
      type: String,
      default: ""
    },
    dueDateTime: {
      type: Date,
      default: null
    },
    postedAt: {
      type: Date,
      default: null
    },
    sourceUrl: {
      type: String,
      default: ""
    },
    rawMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
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
    importType: {
      type: String,
      enum: ["assignment", "reminder", "announcement"],
      required: true
    },
    syncHash: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ["imported", "skipped", "failed", "updated"],
      default: "imported"
    },
    assignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assignment"
    },
    reminder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reminder"
    },
    errorMessage: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true
  }
);

importedSourceItemSchema.index(
  {
    user: 1,
    sourceProvider: 1,
    syncHash: 1
  },
  {
    unique: true
  }
);

importedSourceItemSchema.index({
  user: 1,
  connection: 1,
  createdAt: -1
});

module.exports = mongoose.model("ImportedSourceItem", importedSourceItemSchema);
