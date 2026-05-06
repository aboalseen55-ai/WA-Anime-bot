import mongoose from "mongoose";

const animeSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  arabicNames: {   // لازم نفس الاسم اللي في السكريبت
    type: [String],
    default: []    // لو فاضي، نحط array فارغ
  },
  aliases: { type: [String], default: [] },
  imageUrl: {
    type: String,
    default: ""
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model("Anime", animeSchema);