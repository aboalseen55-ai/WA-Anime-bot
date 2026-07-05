import mongoose from "mongoose";

const mafiaPlayerSchema = new mongoose.Schema({
  identifierKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  jid: {
    type: String,
    default: null,
    index: true
  },
  lid: {
    type: String,
    default: null,
    index: true
  },
  rawLid: {
    type: String,
    default: null
  },
  phoneNumber: {
    type: String,
    default: null,
    index: true
  },
  identifierType: {
    type: String,
    enum: ["phone_jid", "lid_jid", "raw_lid", "unknown"],
    default: "unknown"
  },
  nickname: {
    type: String,
    default: null,
    trim: true
  },
  groupIds: [{
    type: String,
    trim: true
  }],
  awaitingNickname: {
    type: Boolean,
    default: false,
    index: true
  },
  lastPromptedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

mafiaPlayerSchema.index({ groupIds: 1 });
mafiaPlayerSchema.index({ nickname: 1 });

export default mongoose.models.MafiaPlayer || mongoose.model("MafiaPlayer", mafiaPlayerSchema);
