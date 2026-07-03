const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: true
    },
    role: {
      type: String,
      enum: ["student", "professor", "coordinator", "study-group", "room-admin"],
      default: "student"
    },
    resetPasswordTokenHash: {
      type: String,
      default: ""
    },
    resetPasswordExpiresAt: {
      type: Date,
      default: null
    },
    resetPasswordRequestedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

userSchema.index({ resetPasswordTokenHash: 1, resetPasswordExpiresAt: 1 });

module.exports = mongoose.model("User", userSchema);
