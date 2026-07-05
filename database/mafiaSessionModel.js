import mongoose from "mongoose";

const mafiaSessionPlayerSchema = new mongoose.Schema({
  jid: String,
  lid: String,
  rawLid: String,
  phoneNumber: String,
  identifierType: String,
  nickname: String,
  role: String,
  alive: {
    type: Boolean,
    default: true
  }
}, { _id: false });

const mafiaSessionSchema = new mongoose.Schema({
  groupId: {
    type: String,
    required: true,
    index: true
  },
  gameType: {
    type: String,
    default: "mafia",
    index: true
  },
  status: {
    type: String,
    enum: ["collecting_players", "collecting_config", "roles_distributed", "game_over", "closed"],
    default: "collecting_players",
    index: true
  },
  hostJid: {
    type: String,
    required: true,
    index: true
  },
  hostLid: {
    type: String,
    default: null
  },
  hostRawLid: {
    type: String,
    default: null
  },
  hostPhoneNumber: {
    type: String,
    default: null
  },
  hostIdentifierType: {
    type: String,
    default: "unknown"
  },
  hostNickname: {
    type: String,
    default: null
  },
  mafiaCount: {
    type: Number,
    default: null
  },
  enabledRoles: {
    sheikh: {
      type: Boolean,
      default: false
    },
    girl: {
      type: Boolean,
      default: false
    },
    boy: {
      type: Boolean,
      default: false
    }
  },
  configStep: {
    type: String,
    enum: ["mafiaCount", "sheikh", "girl", "boy", "done"],
    default: "mafiaCount"
  },
  players: [mafiaSessionPlayerSchema],
  winner: {
    type: String,
    enum: ["citizens", "mafia", null],
    default: null
  },
  closedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

mafiaSessionSchema.index({ groupId: 1, gameType: 1, status: 1 });
mafiaSessionSchema.index({ hostJid: 1, status: 1 });

export default mongoose.models.MafiaSession || mongoose.model("MafiaSession", mafiaSessionSchema);
