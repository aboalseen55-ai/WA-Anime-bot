import mongoose from "mongoose";

const samBotUsageSchema = new mongoose.Schema({
  dateKey: {
    type: String,
    required: true,
    index: true
  },
  provider: {
    type: String,
    default: "gemini",
    index: true
  },
  model: {
    type: String,
    default: "unknown",
    index: true
  },
  requests: {
    type: Number,
    default: 0,
    min: 0
  },
  successfulRequests: {
    type: Number,
    default: 0,
    min: 0
  },
  failedRequests: {
    type: Number,
    default: 0,
    min: 0
  },
  promptTokens: {
    type: Number,
    default: 0,
    min: 0
  },
  completionTokens: {
    type: Number,
    default: 0,
    min: 0
  },
  totalTokens: {
    type: Number,
    default: 0,
    min: 0
  },
  thinkingTokens: {
    type: Number,
    default: 0,
    min: 0
  },
  cachedTokens: {
    type: Number,
    default: 0,
    min: 0
  },
  toolUseTokens: {
    type: Number,
    default: 0,
    min: 0
  },
  lastError: {
    type: String,
    default: ""
  },
  lastUsedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

samBotUsageSchema.index({ dateKey: 1, provider: 1, model: 1 }, { unique: true });

export default mongoose.models.SamBotUsage || mongoose.model("SamBotUsage", samBotUsageSchema);
