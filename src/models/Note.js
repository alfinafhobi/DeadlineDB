const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
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
    content: {
      type: String,
      required: true
    },
    detectedKeywords: {
      type: [String],
      default: []
    },
    isShared: {
      type: Boolean,
      default: false
    },
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      default: null
    },
    sharedAt: {
      type: Date,
      default: null
    },
    pinned: {
      type: Boolean,
      default: false
    },
    pinnedAt: {
      type: Date,
      default: null
    },
    pinnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    }
  },
  {
    timestamps: true
  }
);

noteSchema.index({
  user: 1,
  room: 1,
  isShared: 1
});

noteSchema.index({
  user: 1,
  createdAt: -1
});

noteSchema.index({
  room: 1,
  isShared: 1,
  sharedAt: -1
});

module.exports = mongoose.model("Note", noteSchema);
