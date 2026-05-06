import Country from "./database/countryModel.js";
import { connectDB } from "./database/db.js";
import { searchFlagImage } from "./utils/imageSearch.js";

/**
 * إعادة فحص جميع الأعلام وتحديث الروابط ذات الجودة المنخفضة
 * أو التي قد تحتوي على شخصيات
 */
async function improveAllFlags() {
  try {
    await connectDB();
    console.log("✅ تم الاتصال بقاعدة البيانات\n");

    // احصل على جميع الدول
    const countries = await Country.find();
    console.log(`🚩 سيتم فحص صور أعلام ${countries.length} دول\n`);

    let improvedCount = 0;
    let keptCount = 0;
    let newCount = 0;
    let failedCount = 0;

    // قائمة مصادر موثوقة للأعلام الحقيقية
    const trustedSources = [
      'wikimedia.org',
      'commons.wikimedia.org',
      'wikipedia.org',
      'gstatic.com',
      'googleusercontent.com'
    ];

    // قائمة مصادر يجب تجنبها (قد تحتوي على شخصيات أو رسوم)
    const untrustedSources = [
      'pngtree.com',
      'redbubble.net',
      'pikbest.com',
      'etsy.com',
      'deviantart.com',
      'pinterest.com'
    ];

    for (let i = 0; i < countries.length; i++) {
      const country = countries[i];
      const currentUrl = country.flagUrl;

      // تحقق من المصدر الحالي
      const isTrusted = trustedSources.some(source => 
        currentUrl?.toLowerCase().includes(source)
      );
      const isUntrusted = untrustedSources.some(source =>
        currentUrl?.toLowerCase().includes(source)
      );

      // إذا كانت من مصدر موثوق، احفظها
      if (isTrusted && !isUntrusted) {
        keptCount++;
        continue;
      }

      // إذا كانت من مصدر مريب أو فارغة، ابحث عن بديل
      console.log(`⏳ فحص: ${country.englishName} (${i + 1}/${countries.length})...`);

      try {
        // ابحث عن صورة أفضل
        const newImageUrl = await searchFlagImage(country.englishName);

        if (newImageUrl && newImageUrl !== currentUrl) {
          country.flagUrl = newImageUrl;
          await country.save();
          improvedCount++;
          console.log(`✅ تم تحسين صورة: ${country.arabicName}`);
        } else if (newImageUrl && newImageUrl === currentUrl) {
          keptCount++;
          console.log(`⏭️  نفس الرابط الموثوق: ${country.arabicName}`);
        } else if (!currentUrl) {
          // إذا لم تكن هناك صورة أصلاً
          if (newImageUrl) {
            country.flagUrl = newImageUrl;
            await country.save();
            newCount++;
            console.log(`✅ تم إضافة صورة جديدة: ${country.arabicName}`);
          } else {
            failedCount++;
            console.log(`❌ فشل البحث: ${country.arabicName}`);
          }
        }
      } catch (error) {
        failedCount++;
        console.error(`❌ خطأ: ${country.englishName} - ${error.message}`);
      }

      // تأخير لتجنب الإرهاق
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n
╔════════════════════════════════════╗
║  📊 نتائج تحسين صور الأعلام       ║
╚════════════════════════════════════╝
✅ محسّن: ${improvedCount}
🔄 محفوظ موثوق: ${keptCount}
🆕 جديد: ${newCount}
❌ فشل: ${failedCount}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
الإجمالي: ${countries.length} دولة
نسبة النجاح: ${((countries.length - failedCount) / countries.length * 100).toFixed(1)}%`);

    process.exit(0);
  } catch (error) {
    console.error("❌ خطأ:", error.message);
    process.exit(1);
  }
}

improveAllFlags();
