const mongoose = require("mongoose");

const sourceConnectionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    type: {
      type: String,
      enum: ["telegram", "gmail", "google-classroom"],
      required: true
    },
    provider: {
      type: String,
      enum: ["telegram", "gmail", "google-classroom"],
      required: true
    },
    label: {
      type: String,
      required: true,
      trim: true
    },
    selectors: {
      type: [String],
      default: []
    },
    status: {
      type: String,
      enum: ["connected", "needs-auth", "setup-required", "paused", "error", "disconnected"],
      default: "setup-required"
    },
    syncMode: {
      type: String,
      enum: ["api", "webhook"],
      default: "api"
    },
    encryptedAccessToken: {
      type: String,
      default: "",
      select: false
    },
    encryptedRefreshToken: {
      type: String,
      default: "",
      select: false
    },
    tokenExpiresAt: {
      type: Date,
      default: null
    },
    scopes: {
      type: [String],
      default: []
    },
    providerAccountId: {
      type: String,
      default: ""
    },
    providerEmail: {
      type: String,
      default: ""
    },
    settings: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    lastSyncResult: {
      importedCount: {
        type: Number,
        default: 0
      },
      skippedDuplicates: {
        type: Number,
        default: 0
      },
      updatedCount: {
        type: Number,
        default: 0
      },
      failedRecords: {
        type: Number,
        default: 0
      },
      message: {
        type: String,
        default: ""
      }
    },
    errorState: {
      code: {
        type: String,
        default: ""
      },
      message: {
        type: String,
        default: ""
      },
      occurredAt: {
        type: Date,
        default: null
      }
    },
    health: {
      type: String,
      enum: ["healthy", "action-required", "limited", "error", "disconnected"],
      default: "action-required"
    },
    lastSyncedAt: {
      type: Date
    },
    lastSuccessfulSyncAt: {
      type: Date,
      default: null
    },
    lastFailedSyncAt: {
      type: Date,
      default: null
    },
    syncCursor: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true
  }
);

sourceConnectionSchema.index({
  user: 1,
  createdAt: -1
});

sourceConnectionSchema.index({
  user: 1,
  type: 1
});

sourceConnectionSchema.index({
  user: 1,
  provider: 1,
  providerAccountId: 1
});

sourceConnectionSchema.index({
  provider: 1,
  "settings.chatIds": 1
});

sourceConnectionSchema.pre("validate", function syncProviderAlias(next) {
  if (!this.provider && this.type) {
    this.provider = this.type;
  }

  if (!this.type && this.provider) {
    this.type = this.provider;
  }

  next();
});

module.exports = mongoose.model("SourceConnection", sourceConnectionSchema);
