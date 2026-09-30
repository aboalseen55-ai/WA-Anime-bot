import mongoose from 'mongoose';

// Per-day counters in the business time zone; the daily summary reads these.
const schema = new mongoose.Schema({
  dateKey: { type: String, required: true, unique: true },
  messages: { type: Number, default: 0 },
  newContacts: { type: Number, default: 0 },
  faqHits: { type: Number, default: 0 },
  autoReplies: { type: Number, default: 0 },
  orders: { type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.models.BusinessDailyStat || mongoose.model('BusinessDailyStat', schema);
