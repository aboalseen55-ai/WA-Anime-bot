import mongoose from "mongoose";

// إعدادات حماية كل مجموعة (يتحكم بها مشرفو المجموعة في واتساب)
const groupSettingsSchema = new mongoose.Schema({
  jid: { type: String, required: true, unique: true },
  antiLink: { type: Boolean, default: false },
  antiSpam: { type: Boolean, default: false }
}, { timestamps: true });

export default mongoose.models.GroupSettings || mongoose.model("GroupSettings", groupSettingsSchema);
