import Country from "./database/countryModel.js";
import { connectDB } from "./database/db.js";

async function checkFlagImages() {
  try {
    await connectDB();
    
    // جلب دول بصور
    const withImages = await Country.findOne({ flagUrl: { $ne: "" } });
    
    if (withImages) {
      console.log(`✅ الدولة: ${withImages.arabicName}`);
      console.log(`📎 الرابط: ${withImages.flagUrl}`);
      console.log(`📏 طول الرابط: ${withImages.flagUrl.length} حرف`);
      
      // التحقق من أن الرابط يبدأ بـ http
      if (withImages.flagUrl.startsWith('http')) {
        console.log(`✅ الرابط صحيح (يبدأ بـ http)`);
      } else {
        console.log(`❌ الرابط قد يكون خاطئ (لا يبدأ بـ http)`);
      }
    } else {
      console.log(`❌ لا توجد أي دول بصور في قاعدة البيانات!`);
    }
    
    // عد إجمالي الصور
    const totalWithImages = await Country.countDocuments({ flagUrl: { $ne: "" } });
    const total = await Country.countDocuments();
    console.log(`\n📊 الإجمالي: ${totalWithImages}/${total} دول لديها صور`);
    
    process.exit(0);
  } catch (error) {
    console.error("❌ خطأ:", error.message);
    process.exit(1);
  }
}

checkFlagImages();
