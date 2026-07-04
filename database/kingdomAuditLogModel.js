import mongoose from "mongoose";

const kingdomAuditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    index: true
  },
  actorJid: {
    type: String,
    required: true,
    index: true
  },
  kingdomId: {
    type: String,
    default: null,
    index: true
  },
  details: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true
});

export default mongoose.models.KingdomAuditLog || mongoose.model("KingdomAuditLog", kingdomAuditLogSchema);
