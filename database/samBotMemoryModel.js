import mongoose from "mongoose";

const samBotMemorySchema = new mongoose.Schema({
  groupJid: {
    type: String,
    required: true
  },
  userJid: {
    type: String,
    required: true
  },
  kingdomId: {
    type: String,
    default: null
  },
  nickname: {
    type: String,
    default: null
  },
  summary: {
    type: String,
    default: ""
  },
  recentTurns: [{
    role: {
      type: String,
      enum: ["user", "bot"],
      required: true
    },
    text: {
      type: String,
      required: true
    },
    intent: {
      type: String,
      default: null
    },
    at: {
      type: Date,
      default: Date.now
    }
  }],
  interactionCount: {
    type: Number,
    default: 0
  },
  lastIntent: {
    type: String,
    default: null
  },
  lastUserMessage: {
    type: String,
    default: ""
  },
  lastBotReply: {
    type: String,
    default: ""
  },
  lastInteractionAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

samBotMemorySchema.index({ groupJid: 1, userJid: 1 }, { unique: true });
samBotMemorySchema.index({ kingdomId: 1, lastInteractionAt: -1 });

export default mongoose.models.SamBotMemory || mongoose.model("SamBotMemory", samBotMemorySchema);
