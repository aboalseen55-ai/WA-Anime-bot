import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

async function sendMaintenanceNotification() {
  console.log("🔧 جاري تهيئة خادم الصيانة...\n");

  const { state, saveCreds } =
    await useMultiFileAuthState("auth");

  const { version } =
    await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state
  });

  let isConnected = false;
  let notificationsSent = 0;
  let notificationsFailed = 0;

  sock.ev.on("connection.update", async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      console.log("📱 امسح QR Code:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      isConnected = true;
      console.log("\n✅ تم الاتصال بنجاح!\n");

      try {
        console.log("⏳ جاري جلب قائمة المجموعات...\n");
        
        // جلب جميع المجموعات
        const groups = await sock.groupFetchAllParticipating();
        const groupJids = Object.keys(groups);

        console.log(`📊 عدد المجموعات: ${groupJids.length}\n`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

        if (groupJids.length === 0) {
          console.log("❌ لم يتم العثور على أي مجموعات!");
          process.exit(0);
        }

        // رسالة الصيانة الجادة واللطيفة
        const maintenanceMessage = `╔════════════════════════════════════╗
║  🔧 إشعار هام - صيانة البوت        ║
╚════════════════════════════════════╝

👋 السلام عليكم ورحمة الله وبركاته 👋

تنبيه مهم لجميع الأعزاء في المجموعة:

🔴 **سيتم إيقاف البوت مؤقتاً**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏰ **الوقت**: الآن
🛠️ **السبب**: صيانة دورية وتحسينات
⏱️ **المدة المتوقعة**: قد تقل أو تزيد قليلاً

📝 **ماذا يحدث أثناء الصيانة:**
✓ سيتم إصلاح وتحسين الأداء
✓ إضافة ميزات جديدة ومفيدة
✓ تحديثات أمان وحماية

💡 **الرجاء ملاحظة:**
• البوت لن يستجيب للأوامر
• الألعاب ستكون غير متاحة
• يمكنك التحدث في المجموعة بكل حرية

🔔 **سيتم إعادة تشغيل البوت قريباً**
شكراً لصبركم معنا 🙏

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*معكم فريق الدعم والتطوير* 💚`;

        // إرسال الرسالة لكل مجموعة
        for (const [index, groupJid] of groupJids.entries()) {
          try {
            const groupMetadata = groups[groupJid];
            const groupName = groupMetadata.subject || "مجموعة بدون اسم";
            
            console.log(`[${index + 1}/${groupJids.length}] 📤 جاري الإرسال إلى: ${groupName}`);
            
            await sock.sendMessage(groupJid, {
              text: maintenanceMessage
            });

            notificationsSent++;
            console.log(`✅ تم الإرسال بنجاح!\n`);

            // تأخير صغير بين الرسائل لتجنب الحد من البوت
            await new Promise(resolve => setTimeout(resolve, 500));

          } catch (error) {
            notificationsFailed++;
            console.log(`❌ فشل الإرسال: ${error.message}\n`);
          }
        }

        // ملخص النتائج
        console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("📋 **ملخص الإرسال:**");
        console.log(`✅ نجح: ${notificationsSent}`);
        console.log(`❌ فشل: ${notificationsFailed}`);
        console.log(`📊 الإجمالي: ${groupJids.length}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

        if (notificationsSent > 0) {
          console.log("✨ تم إرسال إشعارات الصيانة بنجاح!");
          console.log("🚀 يمكنك الآن بدء الصيانة بأمان.\n");
        }

        setTimeout(() => {
          process.exit(0);
        }, 2000);

      } catch (error) {
        console.error("❌ خطأ أثناء جلب المجموعات:", error.message);
        process.exit(1);
      }
    }

    if (connection === "close") {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;

      if (!isConnected && !shouldReconnect) {
        console.log("❌ تم تسجيل الخروج. يرجى محاولة تسجيل الدخول مرة أخرى.");
        process.exit(1);
      }

      if (shouldReconnect && !isConnected) {
        console.log("🔄 جاري إعادة الاتصال...");
        setTimeout(() => startBot(), 3000);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

sendMaintenanceNotification().catch(error => {
  console.error("❌ خطأ في البرنامج:", error);
  process.exit(1);
});