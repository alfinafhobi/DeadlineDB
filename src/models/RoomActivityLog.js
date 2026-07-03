const mongoose = require("mongoose");

const roomActivityLogSchema = new mongoose.Schema(
  {
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    type: {
      type: String,
      enum: [
        "room-created",
        "room-joined",
        "room-left",
        "assignment-posted",
        "assignment-progress",
        "announcement-posted",
        "note-shared",
        "note-pinned"
      ],
      required: true
    },
    message: {
      type: String,
      required: true
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

roomActivityLogSchema.index({
  room: 1,
  createdAt: -1
});

module.exports = mongoose.model("RoomActivityLog", roomActivityLogSchema);
