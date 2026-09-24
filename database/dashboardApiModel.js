import mongoose from "mongoose";

const dashboardApiSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
  endpoint: { type: String, required: function () { return (this.type ?? this.get('type')) !== 'series'; }, trim: true, maxlength: 1200 },
  queryTemplate: { type: String, default: "", maxlength: 500 },
  method: { type: String, enum: ["GET", "POST"], default: "GET" },
  encryptedHeaders: { type: String, default: "" },
  encryptedBody: { type: String, default: "" },
  timeoutMs: { type: Number, default: 12000, min: 1000, max: 30000 },
  enabled: { type: Boolean, default: true },
  responseType: { type: String, enum: ["text", "image", "image_url", "video", "video_url", "audio", "audio_url"], default: "text" },
  // type: normal API or series service
  type: { type: String, enum: ["api", "series"], default: "api" },
  // series-specific configuration (optional)
  seriesConfig: {
    general: {
      resultLimit: { type: Number, default: 6 },
      showThumbnails: { type: Boolean, default: false },
      targetQuality: { type: String, default: "480" }
    },
    searchRequest: {
      endpoint: { type: String, default: "" },
      queryTemplate: { type: String, default: "" },
      method: { type: String, enum: ["GET", "POST"], default: "GET" },
      encryptedHeaders: { type: String, default: "" },
      encryptedBody: { type: String, default: "" },
      timeoutMs: { type: Number, default: 12000 }
    },
    searchResponseMapping: { type: Object, default: {} },
    downloadRequest: {
      endpoint: { type: String, default: "" },
      queryTemplate: { type: String, default: "" },
      method: { type: String, enum: ["GET", "POST"], default: "GET" },
      encryptedHeaders: { type: String, default: "" },
      encryptedBody: { type: String, default: "" },
      timeoutMs: { type: Number, default: 12000 }
    },
    downloadResponseMapping: { type: Object, default: {} },
    processing: {
      initialWaitMs: { type: Number, default: 20000 },
      pollIntervalMs: { type: Number, default: 10000 },
      maxPreparationMs: { type: Number, default: 300000 },
      generatedUrlLifetimeMs: { type: Number, default: 600000 },
      pendingStatusCodes: { type: [Number], default: [404] },
      qualityMatchField: { type: String, default: "id" }
    }
  },
  createdBy: { type: String, default: "dashboard" },
  updatedBy: { type: String, default: "dashboard" }
}, { timestamps: true });

export default mongoose.models.DashboardApi || mongoose.model("DashboardApi", dashboardApiSchema);
