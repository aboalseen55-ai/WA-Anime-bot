import mongoose from "mongoose";

// Instagram comments on @shatreen.app seen by services/shatreenComments.js, and what became of each.
const shatreenCommentSchema = new mongoose.Schema({
  commentId: { type: String, required: true, unique: true },
  postId: { type: String, required: true },
  postCaption: { type: String, default: "" },
  username: { type: String, default: "" },
  text: { type: String, default: "" },
  reply: { type: String, default: "" },
  // fixed: a ready reply (emoji, «مؤسس», a puzzle answer) · ai: written by Gemini
  how: { type: String, enum: ["fixed", "ai", ""], default: "" },
  // seeded: there before the watcher started · sent · ignored · failed (Upload-Post refused)
  status: { type: String, enum: ["seeded", "sent", "ignored", "failed"], default: "sent" },
  createdAt: { type: Date, default: Date.now },
  decidedAt: { type: Date, default: null }
});

shatreenCommentSchema.index({ createdAt: 1 });

export default mongoose.models.ShatreenComment || mongoose.model("ShatreenComment", shatreenCommentSchema);
