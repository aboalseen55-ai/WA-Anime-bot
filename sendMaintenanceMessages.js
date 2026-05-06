import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

const GROUP_JID = "120363423609901756@g.us"; // JID الجماعة

async function sendMaintenanceMessages() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state
  });

  sock.ev.on("connection.update", async ({ connection, qr }) => {
    if (qr) {
      console.log("امسح QR من واتساب:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      // انتظر قليلاً لضمان الاتصال الكامل
      await new Promise(resolve => setTimeout(resolve, 2000));

      // رسالة قبل الصيانة
      const maintenanceMessage = `⚠️ *تنبيه صيانة مهم* ⚠️

السلام عليكم ورحمة الله وبركاته 🍀

يتم إيقاف البوت الآن لإجراء صيانة مهمة وتحديثات جديدة.

⏱️ المدة المتوقعة: بعض الدقائق

سيتم تشغيل البوت مجدداً قريباً مع التحديثات الجديدة. 

شكراً لصبركم! 🙏

*❃═⚌══⊰🍀⊱══⚌═❃*`;

      // رسالة التحديثات الجديدة
      const updatesMessage = `🎉 *تحديثات جديدة في البوت!* 🎉

🚀 **تحسينات الألعاب:**
• إضافة خيار اختيار المشاركين في جميع الألعاب
  - يمكنك الآن اختيار بين لعب مع الجميع أو شخصين محددين فقط
• لعبة جديدة: ترتيب الحروف (/فك)
  - أعد ترتيب الحروف لتشكيل كلمة صحيحة
  - كلمات صعبة ومتنوعة مع تلميحات
• تحسين قائمة الكلمات في لعبة الكتابة
  - إضافة كلمات أصعب وأكثر تعقيداً
• إزالة الصور من لعبة تخمين الشخصيات
  - التركيز على الوصف والتلميحات فقط
• تغيير أمر الإيقاف إلى /وقف
  - يوقف جميع الألعاب النشطة
• تحسين اختيار اللاعبين
  - الآن يمكن اختيار اللاعبين باللقب بدلاً من الرقم

🎮 **كيفية اللعب الجديدة:**
1. ابدأ اللعبة بأمر مثل /انمي أو /فك
2. اختر وضع اللعب: 1️⃣ للجميع أو 2️⃣ لشخصين
3. إذا اخترت شخصين، اكتب اسم كل لاعب على حدة (اللقب)
4. استمتع باللعب والمنافسة!

💡 **نصائح:**
• استخدم /ترتيب لرؤية أفضل اللاعبين
• جميع الألعاب تمنح نقاط للفائزين
• المشرفون فقط يمكنهم بدء الألعاب

استمتع بالتحديثات الجديدة! 🎊

*❃═⚌══⊰🍀⊱══⚌═❃*`;

      console.log("جاري إرسال رسالة التحديثات...");
      await sock.sendMessage(GROUP_JID, { text: updatesMessage });
      console.log("✅ تم إرسال رسالة التحديثات");
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

sendMaintenanceMessages().catch(err => {
  console.error("خطأ:", err);
  process.exit(1);
});
