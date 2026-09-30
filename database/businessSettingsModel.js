import mongoose from 'mongoose';

// One settings document (key "main") holds the whole business-mode configuration.
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'main' },
  enabled: { type: Boolean, default: false },
  businessName: { type: String, default: '', maxlength: 80 },
  ownerJids: { type: [String], default: [] },
  timeZone: { type: String, default: 'Asia/Amman' },
  greeting: { type: String, default: '', maxlength: 1500 },
  awayMessage: { type: String, default: '', maxlength: 1500 },
  hours: { type: mongoose.Schema.Types.Mixed, default: () => ({ enabled: false, start: '09:00', end: '17:00', days: [0, 1, 2, 3, 4, 6] }) },
  faq: { type: [mongoose.Schema.Types.Mixed], default: [] },
  orders: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  summary: { type: mongoose.Schema.Types.Mixed, default: () => ({ enabled: true, time: '21:00' }) },
  orderSeq: { type: Number, default: 1000 },
  lastSummaryDate: { type: String, default: '' }
}, { timestamps: true, minimize: false });

export default mongoose.models.BusinessSettings || mongoose.model('BusinessSettings', schema);
