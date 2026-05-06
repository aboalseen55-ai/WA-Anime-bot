import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import fs from "fs";
import path from "path";

const TARGET_GROUP = "120363410637522055@g.us";
let messageTimeout;

async function sendDowntimeNotification() {
    console.log("🔄 جاري الاتصال بـ WhatsApp...");

    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState("./auth");
        
        const sock = makeWASocket({
            version,
            auth: state,
            getMessage: async (key) => {
                return {
                    conversation: "Loading..."
                };
            }
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "connecting") {
                console.log("⏳ جاري الاتصال...");
            } else if (connection === "open") {
                console.log("✅ تم الاتصال بنجاح!");

                // إرسال رسالة الإخطار
                const notificationMessage = `╔══════════════════════════════════════╗
║     ⚠️ إشعار صيانة مهم              ║
╚══════════════════════════════════════╝

*السلام عليكم ورحمة الله وبركاته* 👋

سيتم إيقاف البوت مؤقتاً لفترة زمنية محدودة
لغايات الانتقال وتطوير الأنظمة! 🔧

═══════════════════════════════════════

⏸️  **حالة البوت:** معطل مؤقتاً
⏱️  **المدة المتوقعة:** قد تستغرق عدة ساعات
🔨 **السبب:** تطوير وتحسين الأنظمة

═══════════════════════════════════════

📢 **سيتم إعادة تشغيل البوت قريباً**
   شكراً لصبركم وتفهمكم ❤️

═══════════════════════════════════════

*اترك لنا رسائلك وسنرد عليها لاحقاً* 📝`;

                try {
                    await sock.sendMessage(TARGET_GROUP, {
                        text: notificationMessage
                    });

                    console.log("\n✅ تم إرسال الإشعار بنجاح!");
                    console.log(`📤 الجماعة: ${TARGET_GROUP}`);
                    console.log(`⏰ الوقت: ${new Date().toLocaleString('ar-SA')}`);

                    // إغلاق الاتصال بعد إرسال الرسالة
                    messageTimeout = setTimeout(() => {
                        sock.end();
                        process.exit(0);
                    }, 3000);
                } catch (error) {
                    console.error("❌ خطأ في إرسال الإشعار:", error.message);
                    sock.end();
                    process.exit(1);
                }
            } else if (connection === "close") {
                if (messageTimeout) clearTimeout(messageTimeout);
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== 401;
                console.log("⚠️  تم قطع الاتصال...");
                if (!shouldReconnect) {
                    console.log("❌ انتهت صلاحية الجلسة");
                    process.exit(1);
                }
            }
        });

    } catch (error) {
        console.error("❌ خطأ عام:", error.message);
        process.exit(1);
    }
}

// تشغيل الدالة
sendDowntimeNotification();
