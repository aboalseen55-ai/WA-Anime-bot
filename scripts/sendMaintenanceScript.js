import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import dotenv from "dotenv";
import { KINGDOMS } from "../config.js";

dotenv.config();

// رسائل الصيانة المختلفة
const MAINTENANCE_MESSAGES = {
  general: `⚠️ *تنبيه صيانة مهم* ⚠️

السلام عليكم ورحمة الله وبركاته 🍀

يتم إيقاف البوت الآن لإجراء صيانة مهمة وتحديثات جديدة.

⏱️ المدة المتوقعة: بعض الدقائق

سيتم تشغيل البوت مجدداً قريباً مع التحديثات الجديدة. 

شكراً لصبركم! 🙏

*❃═⚌══⊰🍀⊱══⚌═❃*`,

  updates: `🎉 *تحديثات جديدة في البوت!* 🎉

🚀 **تحسينات جديدة:**
✅ تحسين نظام الألعاب
✅ إضافة خيارات جديدة
✅ تحسين الأداء والسرعة
✅ إصلاح الأخطاء البرمجية
✅ تحديثات على النقاط والعملات

💡 **ملاحظات:**
• استمتع بالتحديثات الجديدة
• في حالة وجود مشاكل، الرجاء الإبلاغ عنها

شكراً لاستخدامك البوت! 🎊

*❃═⚌══⊰🍀⊱══⚌═❃*`,

  database: `🔧 *تحديث قاعدة البيانات* 🔧

جاري تحديث قاعدة البيانات بالتحسينات الجديدة...

⏳ الرجاء الانتظار قليلاً

سيتم إخطاركم عند الانتهاء ✅

*❃═⚌══⊰🍀⊱══⚌═❃*`,

  system: `🖥️ *تحديث نظام البوت* 🖥️

جاري تحديث نظام البوت الرئيسي...

✨ التحسينات التي تم إضافتها:
• تحسين معالجة الأوامر
• تحسين سرعة الاستجابة
• إصلاح الأخطاء المختلفة
• إضافة ميزات جديدة

سيعود البوت قريباً! ⏳

*❃═⚌══⊰🍀⊱══⚌═❃*`,

  complete: `✅ *تم الانتهاء من الصيانة بنجاح!* ✅

البوت جاهز للعمل الآن مع التحديثات الجديدة 🎉

شكراً لصبركم أثناء الصيانة! 🙏

استمتعوا بالتحديثات الجديدة 🚀

*❃═⚌══⊰🍀⊱══⚌═❃*`
};

async function sendMaintenanceMessages() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state
    });

    sock.ev.on("connection.update", async ({ connection, qr }) => {
      if (qr) {
        console.log("\n📱 امسح QR Code من واتساب:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        console.log("\n✅ تم الاتصال بنجاح!\n");

        // الانتظار لضمان الاتصال الكامل
        await new Promise(resolve => setTimeout(resolve, 2000));

        // الحصول على المجموعات الأساسية من جميع المملكات
        const groupsToNotify = [];
        
        for (const [kingdomId, kingdom] of Object.entries(KINGDOMS)) {
          console.log(`\n🏰 مملكة: ${kingdom.name}`);
          
          // إضافة المجموعات الرئيسية
          if (kingdom.mainGroup && !groupsToNotify.includes(kingdom.mainGroup)) {
            groupsToNotify.push(kingdom.mainGroup);
            console.log(`   ✅ المجموعة الرئيسية: ${kingdom.mainGroup}`);
          }
          
          // إضافة المجموعة الإدارية
          if (kingdom.adminGroup && !groupsToNotify.includes(kingdom.adminGroup)) {
            groupsToNotify.push(kingdom.adminGroup);
            console.log(`   ✅ المجموعة الإدارية: ${kingdom.adminGroup}`);
          }
        }

        console.log(`\n📨 إجمالي المجموعات: ${groupsToNotify.length}\n`);

        // إرسال الرسائل للمجموعات
        for (const groupJid of groupsToNotify) {
          try {
            // إرسال رسالة البداية
            console.log(`⏳ جاري الإرسال إلى: ${groupJid}`);
            await sock.sendMessage(groupJid, { 
              text: MAINTENANCE_MESSAGES.general 
            });
            console.log(`✅ تم إرسال رسالة التنبيه`);

            // الانتظار قليلاً بين الرسائل
            await new Promise(resolve => setTimeout(resolve, 1000));

            // إرسال رسالة التحديثات
            await sock.sendMessage(groupJid, { 
              text: MAINTENANCE_MESSAGES.updates 
            });
            console.log(`✅ تم إرسال رسالة التحديثات`);

            // الانتظار بين المجموعات
            await new Promise(resolve => setTimeout(resolve, 2000));

          } catch (error) {
            console.error(`❌ خطأ في إرسال الرسالة إلى ${groupJid}:`, error.message);
          }
        }

        console.log("\n✅ تم إرسال جميع الرسائل بنجاح!");
        console.log("\n💡 نصيحة: بعد الانتهاء من الصيانة، استخدم:");
        console.log("   node scripts/sendMaintenanceComplete.js\n");

        process.exit(0);
      }
    });

    sock.ev.on("creds.update", saveCreds);

  } catch (error) {
    console.error("\n❌ خطأ:", error.message);
    process.exit(1);
  }
}

// تشغيل السكريبت
console.log("\n🚀 جاري إرسال رسائل الصيانة...\n");
sendMaintenanceMessages().catch(err => {
  console.error("❌ فشل السكريبت:", err);
  process.exit(1);
});
