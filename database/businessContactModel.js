import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  jid: { type: String, required: true, unique: true },
  phone: { type: String, default: '' },
  name: { type: String, default: '', maxlength: 120 },
  firstDateKey: { type: String, default: '' },
  lastSeenAt: { type: Date, default: null },
  lastAutoReplyAt: { type: Date, default: null },
  messageCount: { type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.models.BusinessContact || mongoose.model('BusinessContact', schema);
