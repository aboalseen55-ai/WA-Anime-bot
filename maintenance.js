import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

import User from "./database/userModel.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import qrcode from "qrcode-terminal";

dotenv.config();

async function sendMaintenanceAndBirthdayMessage() {
  // الاتصال بقاعدة البيانات أولاً
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ تم الاتصال بقاعدة البيانات بنجاح!");
  } catch (error) {
    console.error("❌ فشل الاتصال بقاعدة البيانات:", error.message);
    process.exit(1);
  }

  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state
  });

  sock.ev.on("connection.update", async ({ qr, connection }) => {
    if (qr) {
      console.log("امسح QR من واتساب:");
      qrcode.generate(qr, {
        small: true
      });
    }

    if (connection === "open") {
      console.log("تم الاتصال بنجاح! جاري إرسال الرسائل...");

      try {
        // 1️⃣ البحث عن يامي في قاعدة البيانات
        const yamiUser = await User.findOne({ nickname: { $regex: "يامي", $options: 'i' } });
        
        if (!yamiUser) {
          console.error("❌ لم يتم العثور على مستخدم باسم يامي!");
          process.exit(1);
        }

        console.log(`✅ تم العثور على يامي: ${yamiUser.nickname}`);

        // 1️⃣ حفظ تاريخ ميلاد يامي إذا لم يكن مسجلاً
        if (!yamiUser.birthDate) {
          yamiUser.birthDate = new Date(2007, 2, 11); // 11 مارس 2007 (getMonth يبدأ من 0)
          await yamiUser.save();
          console.log("✅ تم حفظ تاريخ ميلاد يامي: 11/3/2007");
        } else {
          console.log(`✅ تاريخ ميلاد يامي: ${yamiUser.birthDate.toLocaleDateString('ar-SA')}`);
        }

        // 3️⃣ إرسال رسالة الإصلاح في مجموعة maintenance
        const maintenanceGroupJid = "120363423609901756@g.us";
        const maintenanceMessage = `🔧 **إشعار إصلاح عاجل** 🔧

🚨 تم اكتشاف مشكلة في نظام العملات وتم إصلاحها بالكامل!

✅ **المشكلة:**
كان هناك خطأ في التحقق من صلاحيات الأدمن الرئيسي لأوامر العملات، مما منع الأدمنز الرئيسيين من استخدام أوامر إدارة العملات.

✅ **الحل:**
تم تصحيح الكود وإعادة التحقق من الصلاحيات بشكل صحيح باستخدام دالة \`isSuperAdmin\` بدلاً من فحص قيمة الدور مباشرة.

✨ **النتيجة:**
الآن جميع أوامر العملات تعمل بشكل طبيعي ومثالي للأدمن الرئيسي والأدمن العادي.

🙏 **اعتذار خاص لـ ${yamiUser.nickname}:**
عذراً على الإزعاج الذي سببته هذه المشكلة. كأدمن رئيسي، كان يجب أن تعمل الأوامر معك دون أي مشاكل. شكراً لصبرك على هذا الخلل وثقتك بنا! 💪

شكراً لكم جميعاً! 🙏`;

        await sock.sendMessage(maintenanceGroupJid, { text: maintenanceMessage });
        console.log("✅ تم إرسال رسالة الإصلاح بنجاح!");

        // 4️⃣ الانتظار لمدة 6 ثوانٍ قبل إرسال رسالة المعايدة
        await new Promise(resolve => setTimeout(resolve, 6000));

        // 5️⃣ التحقق من أن اليوم هو عيد ميلاده وإرسال رسالة المعايدة
        const today = new Date();
        const birthDay = yamiUser.birthDate ? yamiUser.birthDate.getDate() : null;
        const birthMonth = yamiUser.birthDate ? yamiUser.birthDate.getMonth() : null;

        if (birthDay && birthMonth && today.getDate() === birthDay && today.getMonth() === birthMonth) {
          const mention = yamiUser.mention || `@${yamiUser.phoneNumber || 'يامي'}`;
          const birthdayMessage = `🎉🎂 **عيد ميلاد سعيد يا ${yamiUser.nickname}!** 🎂🎉

${mention}، في هذا اليوم الخاص والمميز، نتمنى لك عاماً مليئاً بالسعادة والفرح والإنجازات الرائعة! 

✨ أتمنى أن يحمل لك هذا العام الكثير من الذكريات الجميلة والنجاحات المستمرة
💝 من جميع أعضاء المجموعة بحب وتقدير! 

🎈 كل عام وأنت بألف خير وسعادة! 🎈`;

          await sock.sendMessage(maintenanceGroupJid, { 
            text: birthdayMessage,
            mentions: [yamiUser.jid]
          });
          console.log("✅ تم إرسال رسالة المعايدة بنجاح!");
        } else {
          console.log("⚠️ ملاحظة: اليوم ليس عيد ميلاد يامي (أو لم يسجل تاريخ ميلاده)");
        }

      } catch (error) {
        console.error("❌ خطأ في معالجة الرسائل:", error);
      }

      // 6️⃣ إغلاق الاتصال بعد إرسال الرسائل
      setTimeout(async () => {
        sock.end();
        await mongoose.disconnect();
        console.log("✅ تم إغلاق الاتصال وقاعدة البيانات.");
        process.exit(0);
      }, 3000); // انتظار 3 ثوانٍ قبل الإغلاق
    }

    if (connection === "close") {
      console.log("⚠️ تم إغلاق الاتصال.");
      await mongoose.disconnect();
      process.exit(0);
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

sendMaintenanceAndBirthdayMessage().catch(console.error);