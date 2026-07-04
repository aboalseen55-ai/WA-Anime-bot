import mongoose from "mongoose";

const kingdomAccessCodeSchema = new mongoose.Schema({
  codeHash: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ["active", "used", "revoked"],
    default: "active",
    index: true
  },
  generatedByJid: {
    type: String,
    required: true
  },
  deliveredToJid: {
    type: String,
    required: true
  },
  usedByJid: {
    type: String,
    default: null
  },
  usedAt: {
    type: Date,
    default: null
  },
  replacedByCodeId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  }
}, {
  timestamps: true
});

kingdomAccessCodeSchema.index({ generatedByJid: 1, status: 1 });

export default mongoose.models.KingdomAccessCode || mongoose.model("KingdomAccessCode", kingdomAccessCodeSchema);
