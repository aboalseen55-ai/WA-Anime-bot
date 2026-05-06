// سكريبت للتحقق من صحة الرتب في قاعدة البيانات
import mongoose from "mongoose";
import User from "./database/userModel.js";
import dotenv from "dotenv";

dotenv.config();

async function checkUserRanks() {
  try {
    console.log("🔄 جاري الاتصال بقاعدة البيانات...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ تم الاتصال بنجاح!");

    // الحصول على جميع المستخدمين
    const allUsers = await User.find({});
    console.log(`📊 إجمالي المستخدمين: ${allUsers.length}`);

    let issues = [];
    let validUsers = 0;

    for (const user of allUsers) {
      let userIssues = [];

      // التحقق من الرتبة الإدارية - يجب أن تكون واحدة فقط
      const validRoles = ['member', 'moderator', 'admin', 'super_admin'];
      if (!validRoles.includes(user.role)) {
        userIssues.push(`رتبة إدارية غير صحيحة: ${user.role}`);
      }

      // التحقق من رتبة المملكة - يمكن أن تكون null أو واحدة فقط
      if (user.kingdomRank && typeof user.kingdomRank !== 'string') {
        userIssues.push(`رتبة مملكة غير صحيحة: ${user.kingdomRank}`);
      }

      // التحقق من عدم وجود رتب متعددة (هذا يجب أن يكون صحيحاً بالنموذج، لكن للتأكيد)
      // role هو حقل واحد، kingdomRank هو حقل واحد

      if (userIssues.length === 0) {
        validUsers++;
      } else {
        issues.push({
          nickname: user.nickname,
          jid: user.jid,
          issues: userIssues
        });
      }
    }

    console.log(`\n✅ المستخدمين الصحيحين: ${validUsers}`);
    console.log(`❌ المستخدمين ذوي المشاكل: ${issues.length}`);

    if (issues.length > 0) {
      console.log("\n🔍 تفاصيل المشاكل:");
      issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue.nickname} (${issue.jid}):`);
        issue.issues.forEach(problem => console.log(`   - ${problem}`));
      });

      console.log("\n⚠️ يجب إصلاح هذه المشاكل!");
    } else {
      console.log("\n🎉 جميع المستخدمين لديهم رتب صحيحة!");
      console.log("✅ كل مستخدم له رتبة إدارية واحدة فقط");
      console.log("✅ كل مستخدم له رتبة مملكة واحدة فقط (أو لا شيء)");
    }

  } catch (error) {
    console.error("❌ خطأ:", error);
  } finally {
    await mongoose.disconnect();
    console.log("\n✅ تم إغلاق الاتصال");
  }
}

checkUserRanks();