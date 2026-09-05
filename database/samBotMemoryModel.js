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
  // آخر عضو تم عرضه في إجابة الدليل، لاستخدام طلبات مثل "اعمل منشن لها".
  lastMentionTargetJid: {
    type: String,
    default: null
  },
  girlfriendMode: {
    active: {
      type: Boolean,
      default: false
    },
    mood: {
      type: String,
      default: null
    },
    intensity: {
      type: Number,
      default: 0,
      min: 0,
      max: 3
    },
    lastActivatedAt: {
      type: Date,
      default: null
    }
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
