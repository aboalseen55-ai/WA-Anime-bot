import Country from "./database/countryModel.js";
import { connectDB } from "./database/db.js";

async function checkProgress() {
  try {
    await connectDB();
    
    const total = await Country.countDocuments();
    const completed = await Country.countDocuments({ flagUrl: { $ne: "" } });
    const remaining = total - completed;
    const percentage = Math.round((completed / total) * 100);
    
    console.log(`
╔════════════════════════════════════════════╗
║       📊 حالة جلب صور الأعلام              ║
╚════════════════════════════════════════════╝

✅ مكتملة:    ${completed}/${total}
⏳ متبقية:    ${remaining}/${total}
📈 النسبة:    ${percentage}%

التقريب:
${generateProgressBar(percentage)}

الوقت المتوقع: ~${Math.ceil((remaining * 30) / 60)} دقيقة
    `);
    
    process.exit(0);
  } catch (error) {
    console.error("❌ خطأ:", error.message);
    process.exit(1);
  }
}

function generateProgressBar(percentage) {
  const filled = Math.round(percentage / 5);
  const empty = 20 - filled;
  return `[${('█'.repeat(filled))}${('░'.repeat(empty))}] ${percentage}%`;
}

checkProgress();
