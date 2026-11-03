import mongoose from "mongoose";

const dashboardCommandSchema = new mongoose.Schema({
  trigger: { type: String, required: true, unique: true, trim: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, default: "", maxlength: 300 },
  responseTemplate: { type: String, default: "", maxlength: 4000 },
  permission: { type: String, enum: ["everyone", "moderator", "developer", "numbers"], default: "everyone" },
  // لما الصلاحية "numbers": أرقام هواتف بالصيغة الدولية بدون + (المطور مسموح دايماً)
  allowedNumbers: { type: [String], default: [] },
  // مواقع بتشغّل الأمر تلقائياً لما توصل رسالة فيها رابط منها بالخاص (مثلاً instagram.com)
  autoLinkDomains: { type: [String], default: [] },
  apiId: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardApi", default: null },
  responsePath: { type: String, default: "", maxlength: 160 },
  enabled: { type: Boolean, default: true },
  createdBy: { type: String, default: "dashboard" },
  updatedBy: { type: String, default: "dashboard" }
}, { timestamps: true });

export default mongoose.models.DashboardCommand || mongoose.model("DashboardCommand", dashboardCommandSchema);
