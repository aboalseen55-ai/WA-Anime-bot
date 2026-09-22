import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  text: { type: String, required: true, maxlength: 12000 }
}, { timestamps: true });

export default mongoose.models.DashboardTemplate || mongoose.model('DashboardTemplate', schema);
