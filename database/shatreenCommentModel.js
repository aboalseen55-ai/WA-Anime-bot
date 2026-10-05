import mongoose from "mongoose";

// Instagram comments on @shatreen.app seen by services/shatreenComments.js, and what became of each.
const shatreenCommentSchema = new mongoose.Schema({
  commentId: { type: String, required: true, unique: true },
  postId: { type: String, required: true },
  postCaption: { type: String, default: "" },
  username: { type: String, default: "" },
  text: { type: String, default: "" },
  draft: { type: String, default: "" },
  reply: { type: String, default: "" },
  // seeded: there before the watcher started · pending: waiting for the developer · sent · ignored · auto: thanked automatically
  status: { type: String, enum: ["seeded", "pending", "sent", "ignored", "auto", "failed"], default: "pending" },
  code: { type: Number, default: 0 },
  waMessageId: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  decidedAt: { type: Date, default: null }
});

shatreenCommentSchema.index({ status: 1, code: 1 });
shatreenCommentSchema.index({ waMessageId: 1 });

export default mongoose.models.ShatreenComment || mongoose.model("ShatreenComment", shatreenCommentSchema);
