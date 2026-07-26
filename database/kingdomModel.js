import mongoose from "mongoose";

const kingdomSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  mainGroup: {
    type: String,
    required: true,
    trim: true
  },
  receptionGroup: {
    type: String,
    default: "",
    trim: true
  },
  workGroup: {
    type: String,
    default: "",
    trim: true
  },
  adminGroup: {
    type: String,
    default: "",
    trim: true
  },
  mainGroupInviteLink: {
    type: String,
    default: "",
    trim: true
  },
  receptionGroupInviteLink: {
    type: String,
    default: "",
    trim: true
  },
  workGroupInviteLink: {
    type: String,
    default: "",
    trim: true
  },
  adminGroupInviteLink: {
    type: String,
    default: "",
    trim: true
  },
  announcementLink: {
    type: String,
    default: "",
    trim: true
  },
  timeZone: {
    type: String,
    default: "",
    trim: true
  },
  groupIds: [{
    type: String,
    trim: true
  }],
  admins: [{
    type: String,
    trim: true
  }],
  bankStartingBalance: {
    type: Number,
    default: 1000000,
    min: 0
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  createdByJid: {
    type: String,
    default: null
  },
  createdByName: {
    type: String,
    default: null
  },
  registrationCodeId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  }
}, {
  timestamps: true
});

kingdomSchema.index({ mainGroup: 1 }, { unique: true });
kingdomSchema.index({ groupIds: 1 });

export default mongoose.models.Kingdom || mongoose.model("Kingdom", kingdomSchema);
