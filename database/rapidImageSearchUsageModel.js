import mongoose from "mongoose";

const rapidImageSearchUsageSchema = new mongoose.Schema({
  monthKey: {
    type: String,
    required: true,
    index: true
  },
  provider: {
    type: String,
    default: "rapidapi-google-images",
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

rapidImageSearchUsageSchema.index({ monthKey: 1, provider: 1 }, { unique: true });

export default mongoose.models.RapidImageSearchUsage || mongoose.model("RapidImageSearchUsage", rapidImageSearchUsageSchema);
