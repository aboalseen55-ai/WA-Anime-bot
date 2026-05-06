import mongoose from "mongoose";
import dotenv from "dotenv";
import Anime from "./database/animeModel.js";

dotenv.config();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Array كامل مع Arabic, English, Short
const animeAliasList = [
  { arabic: ["هجوم العمالقة"], english: "Attack on Titan", short: "AOT" },
  { arabic: ["ناروتو"], english: "Naruto", short: "Naruto" },
  { arabic: ["ناروتو شيبودن"], english: "Naruto: Shippuden", short: "Naruto Shippuden" },
  { arabic: ["ون بيس"], english: "One Piece", short: "OP" },
  { arabic: ["ديث نوت"], english: "Death Note", short: "Death Note" },
  { arabic: ["فول ميتال ألكيمست: الأخوة"], english: "Fullmetal Alchemist: Brotherhood", short: "FMA Brotherhood" },
  { arabic: ["ون بنش مان"], english: "One Punch Man", short: "OPM" },
  { arabic: ["ماي هيرو أكاديميا"], english: "My Hero Academia", short: "MHA" },
  { arabic: ["جوجوتسو كايسن"], english: "Jujutsu Kaisen", short: "JJK" },
  { arabic: ["بليتش"], english: "Bleach", short: "Bleach" },
  { arabic: ["كود غياس"], english: "Code Geass", short: "Code Geass" },
  { arabic: ["هانتر × هانتر"], english: "Hunter x Hunter", short: "HxH" },
  { arabic: ["دراغون بول"], english: "Dragon Ball", short: "DB" },
  { arabic: ["دراغون بول زد"], english: "Dragon Ball Z", short: "DBZ" },
  { arabic: ["دراغون بول سوبر"], english: "Dragon Ball Super", short: "DB Super" },
  { arabic: ["كاوبوي بيبوب"], english: "Cowboy Bebop", short: "Cowboy Bebop" },
  { arabic: ["ستاينز;جيت"], english: "Steins;Gate", short: "Steins Gate" },
  { arabic: ["جوجو مغامرات غريبة"], english: "JoJo's Bizarre Adventure", short: "JoJo" },
  { arabic: ["سول إيتر"], english: "Soul Eater", short: "Soul Eater" },
  { arabic: ["تورادورا!"], english: "Toradora!", short: "Toradora" },
  { arabic: ["نينجا سلاحف"], english: "Teenage Mutant Ninja Turtles", short: "TMNT" },
  { arabic: ["غرين لاغان"], english: "Tengen Toppa Gurren Lagann", short: "Gurren Lagann" },
  { arabic: ["هايكيو!!"], english: "Haikyuu!!", short: "Haikyuu" },
  { arabic: ["ري: زيرو"], english: "Re:Zero − Starting Life in Another World", short: "ReZero" },
  { arabic: ["سيمفونية القتال"], english: "Symphogear", short: "Symphogear" },
  { arabic: ["أوشي نو كو"], english: "[Oshi no Ko]", short: "Oshi no Ko" },
  { arabic: ["هيكارو أسترو"], english: "Hikaru no Go", short: "Hikaru no Go" },
  { arabic: ["أغنية توكيوا"], english: "Yoru wa Mijikashi Aruke yo Otome", short: "Yoru wa Mijikashi" },
  { arabic: ["شو غاتسو وا كيمي نو أوسو"], english: "Shigatsu wa Kimi no Uso", short: "Your Lie in April" },
  { arabic: ["موبا بسيكو 100"], english: "Mob Psycho 100", short: "Mob Psycho" },
  { arabic: ["ذا فاينل سيزن لو فيلأندر"], english: "Made in Abyss", short: "Made in Abyss" },
  { arabic: ["فيري تيل"], english: "Fairy Tail", short: "Fairy Tail" },
  { arabic: ["بلاك كلوفر"], english: "Black Clover", short: "Black Clover" },
  { arabic: ["سمرتايم رندير"], english: "Summertime Render", short: "Summertime" },
  { arabic: ["ناتسومي يو جينتشو"], english: "Natsume's Book of Friends", short: "Natsume" },
  { arabic: ["ساميوراي شامبللو"], english: "Samurai Champloo", short: "Samurai Champloo" },
  { arabic: ["بيلم ضربة فارس"], english: "Vinland Saga", short: "Vinland Saga" },
  { arabic: ["فيرفو إيفرغاردن"], english: "Violet Evergarden", short: "Violet Evergarden" },
  { arabic: ["سورد أرت أون لاين"], english: "Sword Art Online", short: "SAO" },
  { arabic: ["كابانيري أوف ذا آيرن فورتريس"], english: "Kabaneri of the Iron Fortress", short: "Kabaneri" },
  { arabic: ["كنوا سبرايت فاميلي"], english: "Spy x Family", short: "Spy x Family" },
  { arabic: ["تعلّم القناص"], english: "Assassination Classroom", short: "AssClassroom" },
  { arabic: ["كيمي نو نا وا"], english: "Your Name", short: "Your Name" },
  { arabic: ["بليتش: حرب الدم الألفية"], english: "Bleach: Thousand-Year Blood War", short: "Bleach TYBW" },
  { arabic: ["جريت بريتر"], english: "Great Pretender", short: "Great Pretender" },
  { arabic: ["غوردو"], english: "Dororo", short: "Dororo" },
  { arabic: ["المطرقة الحمراء"], english: "Akame ga Kill!", short: "Akame ga Kill" },
  { arabic: ["حياة إيروسا"], english: "Erased", short: "Erased" },
  { arabic: ["أنو هايتشيرو"], english: "Ano Hi Mita Hana no Namae wo Bokutachi wa Mada Shiranai.", short: "Ano Hi" },
  { arabic: ["باكمون"], english: "Bakemonogatari", short: "Bakemonogatari" },
  { arabic: ["كينموجي نو بوبي"], english: "Kino no Tabi", short: "Kino no Tabi" },
  { arabic: ["لوج هيروا"], english: "Log Horizon", short: "Log Horizon" },
  { arabic: ["توكيو غول"], english: "Tokyo Ghoul", short: "Tokyo Ghoul" },
  { arabic: ["ري: زيرو الموسم الثاني"], english: "Re:Zero − Starting Life in Another World Season 2", short: "ReZero 2" },
  { arabic: ["كولو كورو"], english: "Cells at Work!", short: "Cells at Work" },
  { arabic: ["تقرار كورو"], english: "Kuroko no Basket", short: "Kuroko Basketball" },
  { arabic: ["بارانويا فاكتوري"], english: "Paranoia Agent", short: "Paranoia Agent" },
  { arabic: ["غران بلو"], english: "Grand Blue", short: "Grand Blue" },
  { arabic: ["انوا"], english: "Ergo Proxy", short: "Ergo Proxy" },
  { arabic: ["غانغ ستار"], english: "Gangsta.", short: "Gangsta" },
  { arabic: ["هارومي سووزوكا"], english: "Suzumiya Haruhi no Yuuutsu", short:    "Haruhi" },
  { arabic: ["داندادان"], english: "Dandadan", short: "Dandadan" },
  { arabic: ["لومينوز دراغون"], english: "Dragon Ball GT", short: "DBGT" },
  { arabic: ["ميو نو توب"], english: "Midori no Hibi", short: "Midori" },
  { arabic: ["تنسن شيتمورا"], english: "Tensai Kids!", short: "Tensai Kids" },
  { arabic: ["فيفي: أغنية الفلوريت"], english: "Vivy - Fluorite Eye’s Song", short: "Vivy" },
  { arabic: ["آينو بوكو"], english: "InuYasha", short: "InuYasha" },
  { arabic: ["هيروما"], english: "Horimiya", short: "Horimiya" },
  { arabic: ["ذا عبور"], english: "Beyond the Boundary", short: "Beyond Bound" },
  { arabic: ["جينيرا"], english: "Gintama", short: "Gintama" },
  { arabic: ["نيكو نو تومي"], english: "Nichijou", short: "Nichijou" },
];

async function addEnglishAliases() {
  const animeDocs = await Anime.find({});

  for (const doc of animeDocs) {
    const title = doc.title;

    const found = animeAliasList.find(a => a.arabic.some(ar => ar === title) || a.english === title);
    if (!found) {
      console.log(`⚠️ No match for: ${title}`);
      continue;
    }

    if (!found.english || !found.short) {
      console.log(`⚠️ Missing English or short alias for: ${title}`);
      continue;
    }

    // تأكيد إضافة الحقل
    doc.set("aliases", [found.english, found.short]);
    await doc.save();
    console.log(`✅ Updated aliases for: ${title}`);
  }

  console.log("🎉 Done adding English aliases!");
  mongoose.disconnect();
}

addEnglishAliases();