import mongoose from "mongoose";
import { Anilist } from "@tdanks2000/anilist-wrapper";
import dotenv from "dotenv";
import Anime from "./database/animeModel.js";

dotenv.config();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

// أنشئ عميل AniList بدون توكن (بيانات عامة كافية لجلب الغلاف)
const anilist = new Anilist();

async function updateImages() {
  const animeList = await Anime.find({});

  for (const anime of animeList) {
    try {
      // تأكد من وجود اسم إنجليزي
      const englishName = anime.aliases?.[0];
      if (!englishName) {
        console.log(`⚠️ No English alias for: ${anime.title}`);
        continue;
      }

      // ابحث في AniList عن الأنمي
      const results = await anilist.anime.searchAnime(englishName.trim());
      if (!results.length) {
        console.log(`❌ AniList: not found "${englishName}"`);
        continue;
      }

      const found = results[0];
      const cover = found.coverImage?.large || found.coverImage?.medium;
      if (!cover) {
        console.log(`⚠️ No AniList image for: ${englishName}`);
        continue;
      }

      // لو نفس الصورة موجودة، نتخطاه
      if (anime.imageUrl === cover) {
        console.log(`ℹ️ Already up-to-date: ${englishName}`);
        continue;
      }

      anime.imageUrl = cover;
      await anime.save();
      console.log(`✅ Updated image for: ${anime.title}`);

    } catch (err) {
      console.log(`❌ Error for ${anime.title}: ${err.message}`);
    }
  }

  console.log("🎉 Done updating all images!");
  mongoose.disconnect();
}

updateImages();