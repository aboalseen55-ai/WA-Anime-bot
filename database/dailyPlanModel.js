import mongoose from "mongoose";

// خطة يوم كاملة لكل مستخدم (/خطة، أو "بكرة بدي أعمل كذا وكذا" بالخاص): مهام بأوقات، وسام بيذكّر ويتابع.
const taskSchema = new mongoose.Schema({
  text: { type: String, required: true },
  // null = مهمة بدون وقت محدد (بتنذكر بتذكير نص اليوم وآخره)
  time: { type: Date, default: null },
  done: { type: Boolean, default: false },
  doneAt: { type: Date, default: null },
  remindedAt: { type: Date, default: null },
  followedUpAt: { type: Date, default: null },
  // "لسا" بتأجل التذكير لهالوقت
  snoozeUntil: { type: Date, default: null }
}, { _id: false });

const dailyPlanSchema = new mongoose.Schema({
  userJid: { type: String, required: true },
  // اليوم بتوقيت المستخدم: YYYY-MM-DD
  dateKey: { type: String, required: true },
  tasks: { type: [taskSchema], default: [] },
  // آخر سؤال بعته سام وبيستنى عليه رد ("خلصت؟" أو "انقل الباقي لبكرة؟")
  awaiting: {
    kind: { type: String, enum: [null, "task", "move"], default: null },
    index: { type: Number, default: null },
    at: { type: Date, default: null }
  },
  morningSentAt: { type: Date, default: null },
  middaySentAt: { type: Date, default: null },
  eveningSentAt: { type: Date, default: null }
}, { timestamps: true });

dailyPlanSchema.index({ userJid: 1, dateKey: 1 }, { unique: true });
dailyPlanSchema.index({ dateKey: 1 });

export default mongoose.models.DailyPlan || mongoose.model("DailyPlan", dailyPlanSchema);
