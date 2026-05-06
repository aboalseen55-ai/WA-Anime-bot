import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import dotenv from "dotenv";
import { KINGDOMS } from "../config.js";

dotenv.config();

const SIMPLE_MESSAGE = `✅ تم الانتهاء من الصيانة`;

async function sendSimpleMessage() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state
    });

    sock.ev.on("connection.update", async ({ connection, qr }) => {
      if (qr) {
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const groupsToNotify = [];
        
        for (const [kingdomId, kingdom] of Object.entries(KINGDOMS)) {
          if (kingdom.mainGroup && !groupsToNotify.includes(kingdom.mainGroup)) {
            groupsToNotify.push(kingdom.mainGroup);
          }
          if (kingdom.adminGroup && !groupsToNotify.includes(kingdom.adminGroup)) {
            groupsToNotify.push(kingdom.adminGroup);
          }
        }

        for (const groupJid of groupsToNotify) {
          try {
            await sock.sendMessage(groupJid, { text: SIMPLE_MESSAGE });
            await new Promise(resolve => setTimeout(resolve, 1500));
          } catch (error) {
            console.error(`خطأ: ${error.message}`);
          }
        }

        console.log("✅ تم إرسال الرسالة");
        process.exit(0);
      }
    });

    sock.ev.on("creds.update", saveCreds);

  } catch (error) {
    console.error("خطأ:", error.message);
    process.exit(1);
  }
}

sendSimpleMessage().catch(err => {
  console.error("فشل:", err);
  process.exit(1);
});
