import Country from "./database/countryModel.js";
import { connectDB } from "./database/db.js";

/**
 * حذف جميع روابط الأعلام من قاعدة البيانات
 */
async function deleteAllFlags() {
  try {
    await connectDB();
    console.log("🔗 تم الاتصال بقاعدة البيانات\n");

    console.log("⚠️  جاري حذف جميع روابط الأعلام...\n");

    // حذف جميع flagUrl
    const result = await Country.updateMany({}, { flagUrl: "" });

    console.log(`
╔════════════════════════════════════╗
║  ✅ تم حذف جميع روابط الأعلام     ║
╚════════════════════════════════════╝
📊 عدد الوثائق المحدثة: ${result.modifiedCount}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    process.exit(0);
  } catch (error) {
    console.error("❌ خطأ:", error.message);
    process.exit(1);
  }
}

deleteAllFlags();
