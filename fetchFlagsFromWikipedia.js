import Country from "./database/countryModel.js";
import { connectDB } from "./database/db.js";
import { searchFlagImageFromWikipedia } from "./utils/imageSearch.js";

/**
 * جلب صور الأعلام من ويكيبيديا فقط
 */
async function fetchFlagsFromWikipedia() {
  try {
    await connectDB();
    console.log("🔗 تم الاتصال بقاعدة البيانات\n");

    // جلب جميع الدول
    const countries = await Country.find();
    console.log(`🌐 سيتم جلب أعلام ${countries.length} دول من ويكيبيديا\n`);

    let successCount = 0;
    let failedCount = 0;
    let successfulCountries = [];

    for (let i = 0; i < countries.length; i++) {
      const country = countries[i];
      try {
        console.log(`⏳ جاري البحث: ${country.englishName} (${i + 1}/${countries.length})...`);

        // جلب علم من ويكيبيديا
        const flagUrl = await searchFlagImageFromWikipedia(country.englishName);

        if (flagUrl) {
          country.flagUrl = flagUrl;
          await country.save();
          successCount++;
          successfulCountries.push(country.arabicName);
          console.log(`✅ تم حفظ علم: ${country.arabicName}\n`);
        } else {
          failedCount++;
          console.log(`❌ فشل جلب علم: ${country.arabicName}\n`);
        }

        // تأخير لتجنب تقييد Wikipedia أو رفض الطلبات (429)
        await new Promise(resolve => setTimeout(resolve, 4000));

      } catch (error) {
        failedCount++;
        console.error(`❌ خطأ: ${country.englishName} - ${error.message}\n`);
      }
    }

    console.log(`\n
╔════════════════════════════════════╗
║  📊 نتائج جلب الأعلام من ويكيبيديا ║
╚════════════════════════════════════╝
✅ نجح: ${successCount}
❌ فشل: ${failedCount}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
الإجمالي: ${countries.length} دولة
نسبة النجاح: ${(successCount / countries.length * 100).toFixed(1)}%

📋 قائمة الدول الناجحة (أول 20):
${successfulCountries.slice(0, 20).map((c, i) => `${i + 1}. ${c}`).join('\n')}`);

    if (successfulCountries.length > 20) {
      console.log(`\n... و ${successfulCountries.length - 20} دول أخرى`);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ خطأ:", error.message);
    process.exit(1);
  }
}

// تشغيل السكربت
fetchFlagsFromWikipedia();
