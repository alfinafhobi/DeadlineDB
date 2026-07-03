const mongoose = require("mongoose");

const roomAnnouncementSchema = new mongoose.Schema(
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
    message: {
      type: String,
      required: true
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
    category: {
      type: String,
      enum: ["assignment", "exam", "event", "general", "urgent"],
      default: "general"
    },
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    showOnDashboard: {
      type: Boolean,
      default: true
    },
    pinned: {
      type: Boolean,
      default: false
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

roomAnnouncementSchema.index({
  room: 1,
  archived: 1,
  createdAt: -1
});

roomAnnouncementSchema.index({
  room: 1,
  showOnDashboard: 1,
  archived: 1,
  createdAt: -1
});

module.exports = mongoose.model("RoomAnnouncement", roomAnnouncementSchema);
