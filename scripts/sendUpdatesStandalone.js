import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

import qrcode from "qrcode-terminal";
import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../database/userModel.js";
import { KINGDOMS } from "../config.js";

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
console.log('✅ تم الاتصال بقاعدة البيانات\n');

// ============================================
// رسالة التحديثات للإدارة
// ============================================
async function getAdminUpdateMessage() {
  try {
    const totalUsers = await User.countDocuments();
    const cloverUsers = await User.countDocuments({ kingdom_id: 'clover' });
    const newUsersToday = await User.countDocuments({
      createdAt: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0))
      }
    });

    const usersWithPoints = await User.countDocuments({ points: { $gt: 0 } });
    const topPlayer = await User.findOne().sort({ points: -1 });

    const activeUsersLast7Days = await User.countDocuments({
      lastActivityDate: {
        $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      }
    });

    const adminUpdateMessage = `🔔 *تحديث الإدارة - ${new Date().toLocaleDateString('ar-SA')}* 🔔

━━━━━━━━━━━━━━━━━━━━━━━

📊 *إحصائيات الأعضاء:*
├ 👥 إجمالي الأعضاء: ${totalUsers}
├ 🍀 أعضاء مملكة كلوفر: ${cloverUsers}
├ ⭐ الأعضاء الجدد اليوم: ${newUsersToday}
└ 🔥 النشيطون آخر 7 أيام: ${activeUsersLast7Days}

🎮 *إحصائيات الألعاب:*
├ 🏆 الأعضاء اللاعبين: ${usersWithPoints}
├ 🥇 أفضل لاعب: ${topPlayer ? topPlayer.nickname : 'لا يوجد'}
└ 💰 نقاط المتصدر: ${topPlayer ? topPlayer.points : '0'}

⚠️ *التنبيهات:*
├ 📢 تأكد من مراجعة التبليغات المعلقة
├ ✅ تحديث القوانين عند الحاجة
└ 🔐 راقب السلوكيات المشبوهة

━━━━━━━━━━━━━━━━━━━━━━━

⏰ ${new Date().toLocaleTimeString('ar-SA')}
🍀 مملكة كلوفر - نظام الإدارة
`;

    return adminUpdateMessage;
  } catch (error) {
    console.error('❌ خطأ في إنشاء رسالة الإدارة:', error);
    return null;
  }
}

// ============================================
// رسالة التحديثات للأعضاء
// ============================================
function getMembersUpdateMessage() {
  const membersUpdateMessage = `📢 *تحديثات المملكة - ${new Date().toLocaleDateString('ar-SA')}* 📢

━━━━━━━━━━━━━━━━━━━━━━━

✨ *ميزات وتحديثات جديدة:* ✨

🎮 **الألعاب:**
├ 🎬 تخمين الأنمي - خمّن من الصور
├ 📝 لعبة الكلمات - تحسين إملائك
├ 🎭 تخمين الشخصيات - هل تعرفهم؟
├ 🔤 ترتيب الحروف - لعبة مثيرة
└ 🎯 تفكيك الكلمات - تحدٍ جديد

📊 **نظام التبليغات:**
├ 🚨 أبلِغ عن أي إساءة بـ: /تبليغ
├ ⚖️ استجابة سريعة من الإدارة
└ 🔒 تبليغك محمي وآمن

📖 **القوانين والمعلومات:**
├ 📋 اعرض القوانين: /قوانين
├ 👤 ملفك الشخصي: /ملفي
├ 🎊 كل الأوامر: /أوامر
└ 🏆 لوحة الترتيب: /ترتيب

💡 *نصائح مهمة:*
✅ اتبع القوانين لتجنب الإنذارات
✅ شارك بالألعاب واكسب نقاط
✅ كن محترماً مع الجميع
✅ استمتع مع أعضاء المملكة

🎯 **الأحداث القادمة:**
🔄 مسابقات ألعاب أسبوعية
🏅 جوائز للاعبين المتميزين
🎊 احتفالات وحفلات خاصة
🌟 ترقيات وترقيات جديدة

🏪 **🔥 متجر المملكة - قريباً جداً! 🔥**

✨ *نحن نعمل على تطوير متجر حصري للمملكة!*

📦 **الصناديق الخاصة:**
🎁 صندوق الذهب → عملات فاخرة
💎 صندوق الماس → قدرات خاصة
🌟 صندوق النجوم → مفاجآت حصرية
👑 صندوق الملك → امتيازات فريدة

💰 **المميزات:**
├ احصل على عملات المملكة
├ قدرات خاصة وحصرية
├ رتب جديدة وفريدة
├ امتيازات ملكية
└ مفاجآت يومية وأسبوعية

⏰ **قريباً على الجميع!** ⏰
🚀 تابع المملكة للإعلان الرسمي
🔔 ستكون النسخة الأولى حصرية للنشطاء

━━━━━━━━━━━━━━━━━━━━━━━

⚠️ **تذكيرات مهمة:**
🚫 ممنوع الإساءة لأي أحد
🚫 احترم المشرفين والإدارة
🚫 لا تنتهك القوانين
✅ كن عضواً مثالياً

━━━━━━━━━━━━━━━━━━━━━━━

🍀 *شكراً لتواجدك معنا!*
💫 معاً نبني مملكة أفضل 💫

⏰ ${new Date().toLocaleTimeString('ar-SA')}
👑 مملكة كلوفر - عائلة واحدة
`;

  return membersUpdateMessage;
}

// ============================================
// البدء
// ============================================
async function startUpdates() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on("connection.update", async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      console.log("\n📱 امسح رمز QR من WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ تم الاتصال بنجاح!\n");
      console.log('📤 جاري إرسال التحديثات...\n');

      const kingdom = KINGDOMS.clover;
      const adminGroupJid = kingdom?.adminGroup;
      const mainGroupJid = kingdom?.mainGroup;

      // إرسال رسالة الإدارة
      if (adminGroupJid) {
        try {
          const adminMessage = await getAdminUpdateMessage();
          if (adminMessage) {
            await sock.sendMessage(adminGroupJid, { text: adminMessage });
            console.log('✅ تم إرسال التحديثات للإدارة! 📊');
          }
        } catch (error) {
          console.error('❌ خطأ في إرسال رسالة الإدارة:', error.message);
        }
      }

      // انتظار قليل
      await new Promise(resolve => setTimeout(resolve, 1000));

      // إرسال رسالة الأعضاء
      if (mainGroupJid) {
        try {
          const membersMessage = getMembersUpdateMessage();
          await sock.sendMessage(mainGroupJid, { text: membersMessage });
          console.log('✅ تم إرسال التحديثات للأعضاء! 📢\n');
        } catch (error) {
          console.error('❌ خطأ في إرسال رسالة الأعضاء:', error.message);
        }
      }

      console.log('✅ اكتملت عملية الإرسال! 🎉\n');
      
      // إغلاق الاتصال
      setTimeout(async () => {
        console.log('⏹️ جاري الخروج...');
        await sock.logout();
        process.exit(0);
      }, 2000);
    }

    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
      if (shouldReconnect) {
        console.log("🔄 جاري إعادة الاتصال...");
        startUpdates();
      } else {
        console.log("❌ تم قطع الاتصال - تحقق من بيانات الاعتماد");
        process.exit(1);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

startUpdates().catch(err => {
  console.error("❌ خطأ:", err);
  process.exit(1);
});
