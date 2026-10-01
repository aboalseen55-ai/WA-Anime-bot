import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  ref: { type: Number, required: true, unique: true },
  label: { type: String, default: 'طلب', maxlength: 40 },
  customerJid: { type: String, required: true, index: true },
  customerPhone: { type: String, default: '' },
  customerName: { type: String, default: '', maxlength: 120 },
  answers: { type: [{ question: String, answer: String }], default: [] },
  status: { type: String, enum: ['new', 'confirmed', 'done', 'cancelled'], default: 'new', index: true },
  note: { type: String, default: '', maxlength: 500 },
  dateKey: { type: String, required: true, index: true }
}, { timestamps: true });

export default mongoose.models.BusinessOrder || mongoose.model('BusinessOrder', schema);
