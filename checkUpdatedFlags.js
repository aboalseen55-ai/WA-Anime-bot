import Country from "./database/countryModel.js";
import { connectDB } from "./database/db.js";
import axios from "axios";

async function checkUpdatedFlags() {
  try {
    await connectDB();
    console.log("✅ تم الاتصال بقاعدة البيانات\n");

    // احصل على بعض الأعلام التي تم تحديثها
    const samples = await Country.find().limit(10);

    console.log("📊 عينات من الأعلام المحدثة:\n");

    let workingCount = 0;
    let totalCount = 0;

    for (const country of samples) {
      totalCount++;
      console.log(`${totalCount}. ${country.arabicName} (${country.englishName})`);
      console.log(`   الرابط: ${country.flagUrl.substring(0, 80)}...`);
      console.log(`   طول الرابط: ${country.flagUrl.length} حرف`);

      // تحقق من أن الرابط يعمل
      try {
        const response = await axios.head(country.flagUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 5000,
          maxRedirects: 5
        });

        if (response.status === 200) {
          console.log(`   ✅ الرابط يعمل`);
          workingCount++;
        } else {
          console.log(`   ⚠️  الرابط يعطي status: ${response.status}`);
        }
      } catch (error) {
        console.log(`   ❌ الرابط معطوب: ${error.message}`);
      }

      console.log();
    }

    console.log(`\n📊 النتائج:`);
    console.log(`✅ روابط تعمل: ${workingCount}/${totalCount}`);

    // احصائيات عامة
    const totalWithUrl = await Country.countDocuments({ flagUrl: { $exists: true, $ne: "" } });
    const totalCountries = await Country.countDocuments();

    console.log(`\n📈 احصائيات عامة:`);
    console.log(`✅ دول بـ URLs: ${totalWithUrl}/${totalCountries}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ خطأ:", error.message);
    process.exit(1);
  }
}

checkUpdatedFlags();
