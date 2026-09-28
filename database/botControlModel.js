import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: true },
  until: { type: Date, default: null },
  message: { type: String, default: '' },
  reason: { type: String, default: '' },
  revision: { type: Number, default: 0 },
  history: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { timestamps: true });
export default mongoose.models.BotControl || mongoose.model('BotControl', schema);

