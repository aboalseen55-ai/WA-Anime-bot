// اختبار البحث عن المستخدمين في قاعدة البيانات
import mongoose from "mongoose";
import User from "./database/userModel.js";
import dotenv from "dotenv";

dotenv.config();

async function testUserSearch() {
  try {
    console.log("🔄 جاري الاتصال بقاعدة البيانات...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ تم الاتصال بنجاح!");

    // اختبار البحث عن مستخدم باسم "يوليوس"
    console.log("\n🔍 اختبار البحث عن مستخدم 'يوليوس'...");
    const user = await User.findOne({
      nickname: { $regex: 'يوليوس', $options: 'i' },
      kingdom_id: 'clover'
    });

    if (user) {
      console.log("✅ تم العثور على المستخدم:");
      console.log(`   📝 اللقب: ${user.nickname}`);
      console.log(`   🏰 المملكة: ${user.kingdom_id}`);
      console.log(`   🆔 JID: ${user.jid}`);
      console.log(`   👤 الدور: ${user.role || 'عضو عادي'}`);
    } else {
      console.log("❌ لم يتم العثور على المستخدم 'يوليوس'");
    }

    // عرض جميع المستخدمين في مملكة كلوفر
    console.log("\n📊 جميع المستخدمين في مملكة كلوفر:");
    const allUsers = await User.find({ kingdom_id: 'clover' }).limit(10);
    allUsers.forEach((u, i) => {
      console.log(`${i + 1}. ${u.nickname} (${u.role || 'عضو'})`);
    });

    console.log(`\n📈 إجمالي المستخدمين: ${await User.countDocuments({ kingdom_id: 'clover' })}`);

  } catch (error) {
    console.error("❌ خطأ:", error);
  } finally {
    await mongoose.disconnect();
    console.log("\n✅ تم إغلاق الاتصال");
  }
}

testUserSearch();