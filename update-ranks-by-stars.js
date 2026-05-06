// سكريبت لتحديث رتب المملكة تلقائياً بناءً على عدد النجوم
import mongoose from "mongoose";
import User from "./database/userModel.js";
import { getHighestRank } from "./commands/rankSystem.js";
import dotenv from "dotenv";

dotenv.config();

async function updateRanksByStars() {
  try {
    console.log("🔄 جاري الاتصال بقاعدة البيانات...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ تم الاتصال بنجاح!");

    // الحصول على جميع المستخدمين
    const allUsers = await User.find({});
    console.log(`📊 إجمالي المستخدمين: ${allUsers.length}`);

    let updatedCount = 0;
    let unchangedCount = 0;
    let removedCount = 0;

    for (const user of allUsers) {
      const currentRank = user.kingdomRank;
      const newRank = getHighestRank(user.rankStars || 0);

      if (currentRank !== newRank) {
        if (newRank) {
          console.log(`📈 تحديث ${user.nickname}: ${currentRank || 'بدون رتبة'} → ${newRank} (${user.rankStars} نجمة)`);
        } else {
          console.log(`📉 إزالة رتبة ${user.nickname}: ${currentRank} → بدون رتبة (${user.rankStars} نجمة)`);
          removedCount++;
        }

        // تحديث الرتبة في قاعدة البيانات
        await User.updateOne(
          { _id: user._id },
          { $set: { kingdomRank: newRank } }
        );

        updatedCount++;
      } else {
        unchangedCount++;
      }
    }

    console.log(`\n📊 ملخص التحديث:`);
    console.log(`✅ تم تحديث: ${updatedCount} مستخدم`);
    console.log(`🔄 بدون تغيير: ${unchangedCount} مستخدم`);
    console.log(`📉 تم إزالة رتب: ${removedCount} مستخدم`);

    console.log(`\n🎉 تم تحديث جميع رتب المملكة بناءً على عدد النجوم!`);
    console.log(`📋 النظام الجديد: الرتب تُمنح تلقائياً حسب النجوم فقط`);

  } catch (error) {
    console.error("❌ خطأ:", error);
  } finally {
    await mongoose.disconnect();
    console.log("\n✅ تم إغلاق الاتصال");
  }
}

// تشغيل الدالة
updateRanksByStars();