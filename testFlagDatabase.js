import Country from "./database/countryModel.js";
import { connectDB } from "./database/db.js";

async function testFlagDatabase() {
  try {
    await connectDB();
    console.log("✅ تم الاتصال بقاعدة البيانات\n");

    // إحصائيات عامة
    const totalCount = await Country.countDocuments();
    console.log(`📊 إجمالي الدول: ${totalCount}`);

    // الدول التي لديها flagUrl
    const withUrlCount = await Country.countDocuments({ flagUrl: { $exists: true, $ne: "" } });
    console.log(`✅ الدول بها URLs: ${withUrlCount}`);

    // الدول التي لا تملك flagUrl
    const withoutUrlCount = await Country.countDocuments({ flagUrl: { $exists: false } });
    console.log(`❌ الدول بدون URLs (لا يوجد حقل): ${withoutUrlCount}`);

    // الدول التي لها flagUrl فارغة
    const emptyUrlCount = await Country.countDocuments({ flagUrl: "" });
    console.log(`⚠️  الدول بـ URLs فارغة: ${emptyUrlCount}\n`);

    // عرض عينات من الدول التي لديها URLs
    console.log("📸 عينات من الدول بـ URLs:\n");
    const samples = await Country.find({ flagUrl: { $exists: true, $ne: "" } }).limit(5);
    
    for (const sample of samples) {
      console.log(`اسم الدولة: ${sample.arabicName}`);
      console.log(`الإنجليزية: ${sample.englishName}`);
      console.log(`الرابط: ${sample.flagUrl.substring(0, 80)}...`);
      console.log(`طول الرابط: ${sample.flagUrl.length}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    }

    // تجربة query مشابهة للعبة (random selection)
    console.log("🎮 اختيار عشوائي (كما في اللعبة):\n");
    if (withUrlCount > 0) {
      const randomIndex = Math.floor(Math.random() * withUrlCount);
      const randomCountry = await Country.findOne({ flagUrl: { $exists: true, $ne: "" } }).skip(randomIndex);
      
      if (randomCountry) {
        console.log(`✅ تم اختيار: ${randomCountry.arabicName}`);
        console.log(`الرابط: ${randomCountry.flagUrl}`);
        console.log(`✅ يمكن استخدام هذا الرابط مباشرة في رسالة الصورة`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ خطأ:", error.message);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

testFlagDatabase();
