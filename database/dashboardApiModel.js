import mongoose from "mongoose";

const dashboardApiSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
  endpoint: { type: String, required: true, trim: true, maxlength: 1200 },
  method: { type: String, enum: ["GET", "POST"], default: "GET" },
  encryptedHeaders: { type: String, default: "" },
  encryptedBody: { type: String, default: "" },
  timeoutMs: { type: Number, default: 12000, min: 1000, max: 30000 },
  enabled: { type: Boolean, default: true },
  createdBy: { type: String, default: "dashboard" },
  updatedBy: { type: String, default: "dashboard" }
}, { timestamps: true });

export default mongoose.models.DashboardApi || mongoose.model("DashboardApi", dashboardApiSchema);
