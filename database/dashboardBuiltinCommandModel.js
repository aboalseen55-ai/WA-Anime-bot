import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  command: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
  description: { type: String, default: '', maxlength: 500 },
  usage: { type: String, default: '', maxlength: 500 },
  title: { type: String, default: '', maxlength: 120 }
}, { timestamps: true });

export default mongoose.models.DashboardBuiltinCommand || mongoose.model('DashboardBuiltinCommand', schema);
