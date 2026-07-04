import mongoose from "mongoose";

const kingdomRegistrationSessionSchema = new mongoose.Schema({
  codeId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  requesterJid: {
    type: String,
    required: true,
    index: true
  },
  requesterName: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ["collecting", "completed", "cancelled"],
    default: "collecting",
    index: true
  },
  currentStep: {
    type: String,
    required: true
  },
  data: {
    type: Object,
    default: {}
  },
  completedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

kingdomRegistrationSessionSchema.index({ requesterJid: 1, status: 1 });

export default mongoose.models.KingdomRegistrationSession || mongoose.model("KingdomRegistrationSession", kingdomRegistrationSessionSchema);
