import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import dotenv from "dotenv";
import { KINGDOMS } from "../config.js";

dotenv.config();

// رسالة انتهاء الصيانة
const COMPLETION_MESSAGE = `✅ *تم الانتهاء من الصيانة بنجاح!* ✅

البوت جاهز للعمل الآن مع جميع التحديثات الجديدة 🎉

🚀 **الميزات الجديدة:**
✨ تحسينات عامة على الأداء
✨ إضافة خيارات جديدة
✨ إصلاح الأخطاء المختلفة
✨ تحديثات على نظام النقاط

💡 **ملاحظات مهمة:**
• استمتعوا باللعبة المحسّنة
• في حالة وجود مشاكل، الرجاء الإبلاغ عنها للأدمن
• جميع البيانات السابقة محفوظة بأمان

شكراً لصبركم أثناء الصيانة! 🙏

*❃═⚌══⊰🍀⊱══⚌═❃*`;

async function sendMaintenanceCompletion() {
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
            console.log(`⏳ جاري الإرسال إلى: ${groupJid}`);
            await sock.sendMessage(groupJid, { 
              text: COMPLETION_MESSAGE 
            });
            console.log(`✅ تم إرسال رسالة الانتهاء\n`);

            // الانتظار بين المجموعات
            await new Promise(resolve => setTimeout(resolve, 2000));

          } catch (error) {
            console.error(`❌ خطأ في إرسال الرسالة إلى ${groupJid}:`, error.message);
          }
        }

        console.log("\n✅ تم إرسال جميع رسائل الانتهاء بنجاح!");
        console.log("🎊 الصيانة مكتملة وكل شيء جاهز للعمل!\n");

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
console.log("\n🚀 جاري إرسال رسائل الانتهاء...\n");
sendMaintenanceCompletion().catch(err => {
  console.error("❌ فشل السكريبت:", err);
  process.exit(1);
});
