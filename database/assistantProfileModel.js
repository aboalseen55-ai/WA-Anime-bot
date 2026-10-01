import mongoose from "mongoose";

// إعدادات واستهلاك المساعد الشخصي لكل مستخدم في الخاص
const assistantProfileSchema = new mongoose.Schema({
  jid: {
    type: String,
    required: true,
    unique: true
  },
  introducedAt: {
    type: Date,
    default: null
  },
  // عدّاد الاستخدام اليومي للذكاء الاصطناعي (فويسات، صور، ملفات، دردشة الخاص)
  usageDay: {
    type: String,
    default: null
  },
  usageCount: {
    type: Number,
    default: 0
  },
  limitNoticeDay: {
    type: String,
    default: null
  },
  // الملخص الصباحي
  brief: {
    enabled: { type: Boolean, default: false },
    hour: { type: Number, default: 7, min: 0, max: 23 },
    minute: { type: Number, default: 0, min: 0, max: 59 },
    city: { type: String, default: null },
    lastSentDay: { type: String, default: null }
  }
}, { timestamps: true });

assistantProfileSchema.index({ "brief.enabled": 1 });

export default mongoose.models.AssistantProfile || mongoose.model("AssistantProfile", assistantProfileSchema);
