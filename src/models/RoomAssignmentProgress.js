const mongoose = require("mongoose");

const roomAssignmentProgressSchema = new mongoose.Schema(
  {
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true
    },
    roomAssignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RoomAssignment",
      required: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    status: {
      type: String,
      enum: ["not-started", "in-progress", "completed"],
      default: "not-started"
    },
    completedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

roomAssignmentProgressSchema.index(
  {
    roomAssignment: 1,
    user: 1
  },
  {
    unique: true
  }
);

roomAssignmentProgressSchema.index({
  room: 1,
  user: 1,
  status: 1
});

module.exports = mongoose.model("RoomAssignmentProgress", roomAssignmentProgressSchema);
