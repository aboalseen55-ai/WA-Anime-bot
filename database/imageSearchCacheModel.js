import mongoose from "mongoose";

const imageSearchCacheSchema = new mongoose.Schema({
  cacheKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  query: {
    type: String,
    required: true,
    trim: true
  },
  source: {
    type: String,
    default: "unknown",
    index: true
  },
  imageUrls: [{
    type: String,
    trim: true
  }],
  expiresAt: {
    type: Date,
    required: true,
    index: true
  }
}, {
  timestamps: true
});

export default mongoose.models.ImageSearchCache || mongoose.model("ImageSearchCache", imageSearchCacheSchema);
