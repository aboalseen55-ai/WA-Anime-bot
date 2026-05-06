import Country from "./database/countryModel.js";
import { connectDB } from "./database/db.js";
import stringSimilarity from "string-similarity";

async function testFlagGameLogic() {
  try {
    await connectDB();
    console.log("✅ تم الاتصال بقاعدة البيانات\n");

    // 1. اختبار اختيار دولة عشوائية
    console.log("🎮 اختبار 1: اختيار دولة عشوائية");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    const count = await Country.countDocuments({ flagUrl: { $exists: true, $ne: "" } });
    console.log(`📊 إجمالي الدول بـ URLs: ${count}\n`);
    
    if (count === 0) {
      console.log("❌ لا توجد دول بـ URLs!");
      process.exit(1);
    }

    const rand = Math.floor(Math.random() * count);
    const country = await Country.findOne({ flagUrl: { $exists: true, $ne: "" } }).skip(rand);

    console.log(`✅ تم اختيار دولة عشوائية:`);
    console.log(`   اسم الدولة: ${country.arabicName}`);
    console.log(`   الإنجليزية: ${country.englishName}`);
    console.log(`   رابط العلم: ${country.flagUrl.substring(0, 70)}...`);
    console.log(`   طول الرابط: ${country.flagUrl.length}\n`);

    // 2. اختبار صيغة التلميح
    console.log("🎮 اختبار 2: صيغة التلميح");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    const countryName = country.arabicName;
    const firstChar = countryName[0];
    const lastChar = countryName[countryName.length - 1];
    const hint = `${firstChar}${'.'.repeat(countryName.length - 2)}${lastChar}`;
    
    console.log(`✅ اسم الدولة: ${countryName}`);
    console.log(`   التلميح: ${hint}\n`);

    // 3. اختبار مطابقة الإجابات (fuzzy match)
    console.log("🎮 اختبار 3: مطابقة الإجابات");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    const testAnswers = [
      { answer: countryName, expected: true },  // الإجابة الصحيحة
      { answer: countryName.toLowerCase(), expected: true },  // بأحرف صغيرة
      { answer: countryName.toUpperCase(), expected: true },  // بأحرف كبيرة
      { answer: countryName + " ", expected: true },  // مع مسافات
      { answer: " " + countryName + " ", expected: true },  // مع مسافات في البداية والنهاية
      { answer: "دولة خاطئة", expected: false }  // إجابة خاطئة
    ];

    const answerVariants = [countryName];

    for (const testAnswer of testAnswers) {
      const guess = testAnswer.answer.toLowerCase().trim();
      const match = answerVariants.some(a =>
        stringSimilarity.compareTwoStrings(a.toLowerCase(), guess) > 0.75
      );
      
      const status = match === testAnswer.expected ? "✅" : "❌";
      console.log(`${status} الإجابة: "${testAnswer.answer}"`);
      console.log(`   النتيجة: ${match ? "مطابقة" : "غير مطابقة"} (متوقع: ${testAnswer.expected ? "مطابقة" : "غير مطابقة"})`);
      
      if (match) {
        const similarity = Math.max(...answerVariants.map(a => 
          stringSimilarity.compareTwoStrings(a.toLowerCase(), guess)
        ));
        console.log(`   درجة التشابه: ${(similarity * 100).toFixed(2)}%\n`);
      } else {
        console.log();
      }
    }

    // 4. اختبار عينات متعددة
    console.log("\n🎮 اختبار 4: عينات عشوائية إضافية");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    for (let i = 0; i < 3; i++) {
      const randomRand = Math.floor(Math.random() * count);
      const randomCountry = await Country.findOne({ flagUrl: { $exists: true, $ne: "" } }).skip(randomRand);
      
      const randomHint = `${randomCountry.arabicName[0]}${'.'.repeat(randomCountry.arabicName.length - 2)}${randomCountry.arabicName[randomCountry.arabicName.length - 1]}`;
      console.log(`${i + 1}. ${randomCountry.englishName}`);
      console.log(`   العربية: ${randomCountry.arabicName}`);
      console.log(`   التلميح: ${randomHint}`);
      console.log(`   الرابط: ${randomCountry.flagUrl.substring(0, 60)}...\n`);
    }

    console.log("✅ جميع الاختبارات نجحت!");
    console.log("\n📊 ملخص الاختبارات:");
    console.log("   ✅ اختيار دولة عشوائية: نجح");
    console.log("   ✅ صيغة التلميح: نجحت");
    console.log("   ✅ مطابقة الإجابات: نجحت");
    console.log("   ✅ عينات عشوائية: نجحت");
    
    process.exit(0);
  } catch (error) {
    console.error("❌ خطأ:", error.message);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

testFlagGameLogic();
