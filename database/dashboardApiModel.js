import mongoose from "mongoose";

const dashboardApiSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
  endpoint: { type: String, required: true, trim: true, maxlength: 1200 },
  queryTemplate: { type: String, default: "", maxlength: 500 },
  method: { type: String, enum: ["GET", "POST"], default: "GET" },
  encryptedHeaders: { type: String, default: "" },
  encryptedBody: { type: String, default: "" },
  timeoutMs: { type: Number, default: 12000, min: 1000, max: 30000 },
  enabled: { type: Boolean, default: true },
  responseType: { type: String, enum: ["text", "image", "image_url", "video", "video_url", "audio", "audio_url"], default: "text" },
  createdBy: { type: String, default: "dashboard" },
  updatedBy: { type: String, default: "dashboard" }
}, { timestamps: true });

export default mongoose.models.DashboardApi || mongoose.model("DashboardApi", dashboardApiSchema);
