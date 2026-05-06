import Country from "../database/countryModel.js";
import { connectDB } from "../database/db.js";
import { searchFlagImage } from "../utils/imageSearch.js";

// دالة جلب صور الأعلام
async function fetchFlagImages() {
  try {
    await connectDB();
    console.log("🔗 تم الاتصال بقاعدة البيانات");

    // جلب جميع الدول (لتحديث الروابط القديمة أيضاً)
    const countries = await Country.find();
    console.log(`🏴 سيتم تحديث صور أعلام ${countries.length} دول\n`);

    let successCount = 0;
    let updateCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < countries.length; i++) {
      const country = countries[i];
      try {
        // إذا كانت الصورة من دالة البحث القديمة (تحتوي على شخصيات)، نحدث
        const shouldUpdate = !country.flagUrl || 
                           country.flagUrl.includes('pngtree') || 
                           country.flagUrl.includes('redbubble') ||
                           country.flagUrl.includes('pikbest');

        if (!shouldUpdate && country.flagUrl) {
          skippedCount++;
          continue;
        }

        console.log(`⏳ جاري البحث عن: ${country.englishName} (${i + 1}/${countries.length})...`);

        // البحث عن صورة العلم باستخدام الدالة الجديدة المتخصصة
        const imageUrl = await searchFlagImage(country.englishName);

        if (imageUrl) {
          const isNewImage = !country.flagUrl || country.flagUrl !== imageUrl;
          country.flagUrl = imageUrl;
          await country.save();
          
          if (isNewImage) {
            if (country.flagUrl && country.flagUrl !== imageUrl) {
              updateCount++;
            } else {
              successCount++;
            }
          }
          console.log(`✅ تم حفظ صورة: ${country.arabicName}`);
        } else {
          failedCount++;
          console.log(`⚠️  لم يتم العثور على صورة: ${country.arabicName}`);
        }

        // تأخير لتجنب الإرهاق على السيرفر
        await new Promise(resolve => setTimeout(resolve, 800));

      } catch (error) {
        failedCount++;
        console.error(`❌ خطأ في جلب صورة ${country.arabicName}:`, error.message);
      }
    }

    console.log(`\n
╔════════════════════════════════════╗
║  📊 نتائج تحديث صور الأعلام       ║
╚════════════════════════════════════╝
✅ جديد: ${successCount}
🔄 محدث: ${updateCount}
⏭️  محفوظ: ${skippedCount}
❌ فشل: ${failedCount}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
الإجمالي: ${countries.length} دولة`);

    process.exit(0);
  } catch (error) {
    console.error("❌ خطأ:", error.message);
    process.exit(1);
  }
}

// تشغيل السكربت
fetchFlagImages();
