import mongoose from "mongoose";

// ذاكرة سام طويلة المدى لكل شخص بالخاص: معلومات مهمة عنه وملخص قصير لآخر أحاديثه
const userMemorySchema = new mongoose.Schema({
  userJid: {
    type: String,
    required: true,
    unique: true
  },
  facts: [{
    text: { type: String, required: true },
    at: { type: Date, default: Date.now }
  }],
  // ملخص متجدد للأحاديث القديمة بدل تخزين كل الرسائل
  summary: {
    type: String,
    default: ""
  },
  // رسائل طلعت من نافذة آخر الرسائل وبتستنى تنضغط بالملخص
  pendingTurns: [{
    role: { type: String, enum: ["user", "bot"], required: true },
    text: { type: String, required: true },
    at: { type: Date, default: Date.now }
  }],
  summarizedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

export default mongoose.models.UserMemory || mongoose.model("UserMemory", userMemorySchema);
