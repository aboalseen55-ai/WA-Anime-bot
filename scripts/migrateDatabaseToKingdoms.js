/**
 * Script لتحويل قاعدة البيانات القديمة إلى نظام المملكات المتعدد
 * 🏰 هذا السكريبت:
 * ✅ يحافظ على جميع البيانات الموجودة
 * ✅ يضيف حقل kingdom بقيمة افتراضية 'clover'
 * ✅ يُنشئ سجل Bank لكل مملكة (إذا لم يكن موجوداً)
 * ✅ آمن تماماً - لا يحذف أي بيانات
 */

import mongoose from "mongoose";
import User from "../database/userModel.js";
import Bank from "../database/bankModel.js";
import { KINGDOMS } from "../config.js";
import dotenv from "dotenv";

dotenv.config();

async function migrateDatabase() {
  try {
    console.log("🔄 جاري الاتصال بقاعدة البيانات...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ تم الاتصال بنجاح!");

    // ========================
    // 1️⃣ تحديث جميع المستخدمين
    // ========================
    console.log("\n📝 جاري تحديث المستخدمين...");
    
    const usersToUpdate = await User.find({ kingdom_id: { $exists: false } });
    console.log(`📊 عدد المستخدمين بدون kingdom_id: ${usersToUpdate.length}`);

    if (usersToUpdate.length > 0) {
      await User.updateMany(
        { kingdom_id: { $exists: false } },
        { $set: { kingdom_id: 'clover' } }
      );
      console.log(`✅ تم تحديث ${usersToUpdate.length} مستخدماً`);
    } else {
      console.log("✅ جميع المستخدمين لديهم kingdom_id بالفعل");
    }

    const totalUsers = await User.countDocuments();
    console.log(`📈 إجمالي المستخدمين الآن: ${totalUsers}`);

    // ========================
    // 2️⃣ إنشاء Bank records
    // ========================
    console.log("\n🏦 جاري إعداد البنك...");

    for (const [kingdomId, kingdomData] of Object.entries(KINGDOMS)) {
      const bankExists = await Bank.findOne({ kingdom: kingdomId });
      
      if (!bankExists) {
        const newBank = new Bank({
          kingdom: kingdomId,
          totalCoins: kingdomData.bankStartingBalance || 1000000
        });
        await newBank.save();
        console.log(`✅ تم إنشاء بنك جديد للمملكة: ${kingdomData.name}`);
      } else {
        console.log(`✅ البنك متوفر بالفعل: ${kingdomData.name}`);
      }
    }

    // ========================
    // 3️⃣ عرض الإحصائيات
    // ========================
    console.log("\n📊 الإحصائيات النهائية:");
    console.log("================");

    for (const [kingdomId, kingdomData] of Object.entries(KINGDOMS)) {
      const kingdomUsers = await User.countDocuments({ kingdom_id: kingdomId });
      const kingdomBank = await Bank.findOne({ kingdom: kingdomId });
      
      console.log(`
🏰 ${kingdomData.name}
  👥 عدد الأعضاء: ${kingdomUsers}
  💰 رصيد البنك: ${kingdomBank?.totalCoins || 0}
      `);
    }

    console.log("\n✅✅✅ تم المهاجرة بنجاح!");
    console.log("🔐 جميع البيانات آمنة ومحفوظة");
    console.log("🚀 البوت جاهز للعمل مع نظام المملكات المتعدد");

  } catch (error) {
    console.error("❌ خطأ في المهاجرة:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("\n✅ تم إغلاق الاتصال بقاعدة البيانات");
    process.exit(0);
  }
}

// تشغيل المهاجرة
migrateDatabase();
