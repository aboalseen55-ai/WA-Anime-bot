import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

import qrcode from "qrcode-terminal";

async function sendReadyMessage() {
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
      console.log("تم الاتصال بنجاح! إرسال رسالة الجاهزية...");

      const groupJid = "120363423609901756@g.us";
      const readyMessage = `✅ تمت الصيانة بنجاح! 🎉

البوت جاهز للعمل الآن وسيكون متاحاً خلال ثواني.

شكراً لانتظاركم! 💪`;

      try {
        await sock.sendMessage(groupJid, { text: readyMessage });
        console.log("تم إرسال رسالة الجاهزية بنجاح!");
      } catch (error) {
        console.error("خطأ في إرسال الرسالة:", error);
      }

      // إغلاق الاتصال بعد إرسال الرسالة
      setTimeout(() => {
        sock.end();
        console.log("تم إغلاق الاتصال.");
        process.exit(0);
      }, 5000); // انتظار 5 ثوانٍ قبل الإغلاق
    }

    if (connection === "close") {
      console.log("تم إغلاق الاتصال.");
      process.exit(0);
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

sendReadyMessage().catch(console.error);