import mongoose from "mongoose";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Anime from "./database/animeModel.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
dotenv.config();

mongoose.connect(process.env.MONGO_URI);

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  systemInstruction: `
    You are an anime expert.
    Only answer questions about anime, manga, characters, studios, and episodes.
    If the question is not related to anime, say: "هذا البوت مخصص للأنمي فقط".
  `
});

// Array المرجعي (الأسماء العربية الصحيحة + الإنجليزي + short)
const topAnimeList = [
  { arabic: ["هجوم العمالقة"], english: "Attack on Titan", short: "AOT" },
  { arabic: ["ناروتو"], english: "Naruto", short: "Naruto" },
  { arabic: ["ناروتو "], english: "Naruto: Shippuden", short: "Naruto Shippuden" },
  // ... بقية الأري اللي عطيتك إياها
];

async function fetchImage(title) {
  try {
    const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=1`);
    const data = await res.json();
    return data.data?.[0]?.images?.jpg?.image_url || null;
  } catch {
    return null;
  }
}

async function correctArabicNameWithAI(dbName, english) {
  try {
    const prompt = `Correct the following Arabic anime name to match its English name. 
    Arabic: "${dbName}" 
    English: "${english}" 
    Only give me the corrected Arabic name.`;
    const result = await model.generateContent({ prompt });
    return result.output?.[0]?.content?.[0]?.text?.trim() || dbName;
  } catch {
    return dbName;
  }
}

async function updateDatabase() {
  const allAnime = await Anime.find();

  for (const dbAnime of allAnime) {
    const nameInDB = dbAnime.title.trim();

    // البحث في Array المرجعي
    const ref = topAnimeList.find(a => a.arabic.some(n => n.trim() === nameInDB));

    if (ref) {
      const imageUrl = await fetchImage(ref.english);
      dbAnime.aliases = [ref.english, ref.short];
      dbAnime.imageUrl = imageUrl;
      await dbAnime.save();
      console.log(`✅ Updated: ${dbAnime.title}`);
    } else {
      // استخدام AI لتصحيح الاسم العربي
      const aiCorrectedName = await correctArabicNameWithAI(nameInDB, topAnimeList[0].english); // ممكن تختار الـ english المناسب حسب النظام
      const refByAI = topAnimeList.find(a => a.arabic.includes(aiCorrectedName));
      if (refByAI) {
        const imageUrl = await fetchImage(refByAI.english);
        dbAnime.title = aiCorrectedName;
        dbAnime.aliases = [refByAI.english, refByAI.short];
        dbAnime.imageUrl = imageUrl;
        await dbAnime.save();
        console.log(`🔧 Corrected & Updated: ${aiCorrectedName}`);
      } else {
        console.log(`⚠️ Skipping (no match found even after AI): ${dbAnime.title}`);
      }
    }
  }

  console.log("🎉 Database update completed!");
  mongoose.disconnect();
}

updateDatabase();