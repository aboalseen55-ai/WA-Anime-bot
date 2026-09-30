import mongoose from "mongoose";

// Personal reminders, to-dos and quick notes owned by one user.
const personalItemSchema = new mongoose.Schema({
  kind: {
    type: String,
    enum: ["reminder", "todo", "note"],
    required: true
  },
  userJid: {
    type: String,
    required: true
  },
  chatJid: {
    type: String,
    default: null
  },
  text: {
    type: String,
    required: true
  },
  dueAt: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ["pending", "sending", "sent", "failed"],
    default: "pending"
  },
  attempts: {
    type: Number,
    default: 0
  },
  sentAt: {
    type: Date,
    default: null
  },
  done: {
    type: Boolean,
    default: false
  },
  doneAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

personalItemSchema.index({ userJid: 1, kind: 1, createdAt: 1 });
personalItemSchema.index({ kind: 1, status: 1, dueAt: 1 });

export default mongoose.models.PersonalItem || mongoose.model("PersonalItem", personalItemSchema);
