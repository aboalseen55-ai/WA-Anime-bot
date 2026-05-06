import Country from "../database/countryModel.js";
import { connectDB } from "../database/db.js";
import { searchFlagImageFromWikipedia } from "../utils/imageSearch.js";
import mongoose from "mongoose";

/**
 * سكربت يبحث عن الدول العربية التي لا تحتوي على علم في قاعدة البيانات
 * ويجلب لها العلم من ويكيبيديا (أسرع وأدق من البحث العام).
 */

const ARAB_COUNTRIES = [
  "الإمارات العربية المتحدة",
  "البحرين",
  "الجزائر",
  "جزر القمر",
  "جيبوتي",
  "مصر",
  "العراق",
  "الأردن",
  "الكويت",
  "لبنان",
  "ليبيا",
  "المغرب",
  "موريتانيا",
  "عمان",
  "فلسطين",
  "قطر",
  "المملكة العربية السعودية",
  "الصومال",
  "السودان",
  "سوريا",
  "تونس",
  "اليمن"
];

async function fetchMissingFlags() {
  try {
    // محاولة الاتصال بـ Atlas أولاً
    try {
      await connectDB();
      console.log("🔗 تم الاتصال بقاعدة البيانات (Atlas)");
    } catch (atlasError) {
      console.log("⚠️ فشل الاتصال بـ Atlas، جاري المحاولة محلياً...");
      
      // محاولة الاتصال محلياً
      const localUri = 'mongodb://localhost:27017/anime-bot';
      await mongoose.connect(localUri, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log("🔗 تم الاتصال بقاعدة البيانات محلياً");
    }

    // إعداد timeout أكبر للعمليات
    mongoose.set('maxTimeMS', 30000); // 30 ثانية للعمليات

    const query = {
      arabicName: { $in: ARAB_COUNTRIES },
      $or: [{ flagUrl: "" }, { flagUrl: { $exists: false } }, { flagUrl: null }]
    };

    const countries = await Country.find(query);
    console.log(`🌍 وجدت ${countries.length} دولة عربية بدون علم في قاعدة البيانات`);

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < countries.length; i++) {
      const country = countries[i];
      try {
        console.log(`⏳ (${i + 1}/${countries.length}) جلب علم ${country.arabicName}...`);
        const flagUrl = await searchFlagImageFromWikipedia(country.englishName);
        if (flagUrl) {
          country.flagUrl = flagUrl;
          await country.save();
          successCount++;
          console.log(`✅ تم حفظ علم ${country.arabicName}`);
        } else {
          failedCount++;
          console.warn(`❌ لم يتم العثور على علم ${country.arabicName}`);
        }
      } catch (error) {
        failedCount++;
        console.error(`❌ خطأ عند جلب علم ${country.arabicName}: ${error.message}`);
      }

      // تأخير بسيط لتخفيف ضغط الطلبات على ويكيبيديا
      await new Promise(resolve => setTimeout(resolve, 3500));
    }

    console.log(`\n✅ تم الانتهاء: تم تحديث ${successCount} علماً، وفشل ${failedCount}.`);
    process.exit(0);
  } catch (error) {
    console.error("❌ فشل في السكربت:", error.message);
    process.exit(1);
  }
}

fetchMissingFlags();
