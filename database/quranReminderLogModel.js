import mongoose from "mongoose";

const quranReminderLogSchema = new mongoose.Schema({
  groupJid: {
    type: String,
    required: true
  },
  kingdomId: {
    type: String,
    default: null
  },
  dateKey: {
    type: String,
    required: true
  },
  reminderText: {
    type: String,
    default: ""
  },
  sentAt: {
    type: Date,
    default: Date.now
  }
});

quranReminderLogSchema.index({ groupJid: 1, dateKey: 1 }, { unique: true });
quranReminderLogSchema.index({ kingdomId: 1, dateKey: 1 });

export default mongoose.models.QuranReminderLog || mongoose.model("QuranReminderLog", quranReminderLogSchema);
