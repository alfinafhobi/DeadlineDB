const mongoose = require("mongoose");

const roomAssignmentSchema = new mongoose.Schema(
  {
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    instructions: {
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
      default: "Room"
    },
    referenceLinks: {
      type: [String],
      default: []
    },
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    archived: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

roomAssignmentSchema.index({
  room: 1,
  archived: 1,
  dueDate: 1
});

module.exports = mongoose.model("RoomAssignment", roomAssignmentSchema);
