import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

import qrcode from "qrcode-terminal";
import mongoose from "mongoose";
import User from "./database/userModel.js";
import { KINGDOMS, getKingdomFromGroupJid } from "./config.js";

import { getHighestRank } from "./commands/rankSystem.js";
import { getMentionFromJID } from "./commands/adminSystem.js";
import { scheduleDailyReports } from "./utils/dailyReports.js";
import { normalizeOutgoingMessageContent } from "./utils/textEncoding.js";
import { initializeKingdomSystem } from "./utils/kingdomService.js";

// Connect to MongoDB with better error handling
try {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI is not configured in the environment");
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 20000,
    socketTimeoutMS: 20000,
    retryWrites: true,
    maxPoolSize: 10,
  });
  console.log("✅ MongoDB connected successfully");
  await initializeKingdomSystem();
  console.log("✅ Kingdom system initialized from database");
} catch (error) {
  console.error("❌ MongoDB Connection Error:");
  console.error(`📋 Error Code: ${error.code}`);
  console.error(`📋 Error Message: ${error.message}`);
  
  if (error.code === 'ECONNREFUSED' || error.message.includes('querySrv')) {
    console.error("⚠️  DNS/Connection Error - whitelisting still propagating");
    console.error(`⏳ This can take 10-20 minutes for some MongoDB regions`);
    console.error("🔗 IPv4 whitelisted: 176.29.2.202 ✓");
    console.error("🔗 All routing/port tests passed ✓");
    console.error("📝 Waiting for MongoDB infrastructure update...");
  } else if (error.message.includes('authentication')) {
    console.error("⚠️  Authentication Error - Verify password in MongoDB Atlas");
    console.error("🔗 cloud.mongodb.com → Database Access → Edit Password");
  } else if (error.message.includes('Could not connect to any servers')) {
    console.error("⚠️  Network Connection Error - Servers not responding");
    console.error("🔗 Network connectivity: VERIFIED (ping/port tests passed)");
    console.error("⏳ Waiting for MongoDB to accept the whitelisted IP...");
  } else {
    console.error("🔍 Full Error:", error.message);
  }
  process.exit(1);
}

// لمتابعة الأعضاء الذين تم التعامل معهم عند بدء التشغيل (لتجنب إرسال ترحيب لحالات قديمة)
// نحتفظ بقائمة لكل مجموعة استقبال على حدة
const knownReceptionParticipants = new Map(); // key: receptionGroupJid, value: Set of participant JIDs

// دالة لتحديث رتب المملكة تلقائياً بناءً على النجوم
async function updateKingdomRanks() {
  console.log("🔄 تحديث رتب المملكة تلقائياً...");

  const allUsers = await User.find({});
  let updated = 0;

  for (const user of allUsers) {
    for (const kingdom of Object.keys(KINGDOMS)) {
      const rankStars = user.rankStarsByKingdom?.[kingdom] || 0;
      const newRank = getHighestRank(kingdom, rankStars);
      const currentRank = user.kingdomRankByKingdom?.[kingdom];
      if (newRank !== currentRank) {
        if (!user.kingdomRankByKingdom) user.kingdomRankByKingdom = {};
        user.kingdomRankByKingdom[kingdom] = newRank;
        user.markModified('kingdomRankByKingdom');
        updated++;
      }
    }
    await user.save();
  }

  console.log(`✅ تم تحديث ${updated} رتبة تلقائياً`);
}

// نقل البيانات من stars إلى points إذا لم يتم بعد
const usersWithStars = await User.find({ stars: { $exists: true, $gt: 0 }, migrated: false });
if (usersWithStars.length > 0) {
  console.log(`🔄 نقل ${usersWithStars.length} مستخدم من stars إلى points...`);
  for (const user of usersWithStars) {
    const starsValue = Number(user.stars) || 0;
    user.points = (user.points || 0) + starsValue;
    user.stars = undefined; // إزالة الحقل
    user.migrated = true; // علامة النقل
    await user.save();
  }
  console.log(`✅ تم نقل البيانات بنجاح!`);
}

// تحديث رتب المملكة تلقائياً عند بدء البوت
await updateKingdomRanks();

let activeSock = null;
let reconnectTimer = null;
let stableConnectionTimer = null;
let reconnectAttempts = 0;
let isStartingBot = false;

const BASE_RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 60000;
const STABLE_CONNECTION_RESET_MS = 2 * 60 * 1000;
const NON_RECONNECTABLE_STATUS_CODES = new Set([401, 403, 405, 440]);

function getDisconnectStatusCode(error) {
  return error?.output?.statusCode || error?.statusCode || error?.data?.statusCode || null;
}

function shouldReconnectAfterDisconnect(error) {
  const statusCode = getDisconnectStatusCode(error);
  return !NON_RECONNECTABLE_STATUS_CODES.has(statusCode);
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectAttempts += 1;
  const delay = Math.min(BASE_RECONNECT_DELAY_MS * reconnectAttempts, MAX_RECONNECT_DELAY_MS);
  console.log(`🔄 إعادة الاتصال خلال ${Math.round(delay / 1000)} ثوانٍ...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    console.log("🔄 بدء إعادة الاتصال...");
    startBot();
  }, delay);
}

async function startBot() {
  if (isStartingBot) {
    console.log("⏳ توجد محاولة اتصال قيد التنفيذ؛ تم تجاهل محاولة إضافية.");
    return;
  }

  isStartingBot = true;

  try {

  const { state, saveCreds } =
    await useMultiFileAuthState("auth");

  const { version } =
    await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state
  });

  activeSock = sock;
  isStartingBot = false;

  const originalSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = (jid, content, options) => {
    return originalSendMessage(jid, normalizeOutgoingMessageContent(content), options);
  };

  sock.ev.on("connection.update", async ({ qr, connection, lastDisconnect }) => {

    if (qr) {
      console.log("\n📱 امسح QR من واتساب:\n");
      qrcode.generate(qr, {
        small: true
      });
    }

    if (connection === "open") {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (stableConnectionTimer) clearTimeout(stableConnectionTimer);
      stableConnectionTimer = setTimeout(() => {
        reconnectAttempts = 0;
        stableConnectionTimer = null;
      }, STABLE_CONNECTION_RESET_MS);
      console.log("✅ متصل بـ WhatsApp");

      // تحميل المشاركين الحاليين في كل مجموعة استقبال من كل مملكة لمنع إرسال ترحيب قديم
      try {
        const receptionGroups = Object.values(KINGDOMS)
          .map(k => k.receptionGroup)
          .filter(Boolean);

        for (const receptionJid of receptionGroups) {
          const receptionMetadata = await sock.groupMetadata(receptionJid);
          knownReceptionParticipants.set(
            receptionJid,
            new Set(receptionMetadata.participants.map(p => p.id))
          );
          console.log(`✅ تم تهيئة قائمة المشاركين في مجموعة الاستقبال (${receptionJid}) (${knownReceptionParticipants.get(receptionJid).size} عضو)`);
        }
      } catch (err) {
        console.warn('⚠️ لم أستطع تحميل بيانات مجموعات الاستقبال:', err.message);
      }
      
      // 📊 تفعيل جدولة التقارير اليومية
      scheduleDailyReports(sock);
    }

    if (connection === "close") {
      isStartingBot = false;
      if (activeSock === sock) activeSock = null;
      if (stableConnectionTimer) {
        clearTimeout(stableConnectionTimer);
        stableConnectionTimer = null;
      }

      const error = lastDisconnect?.error;
      const statusCode = getDisconnectStatusCode(error);
      const shouldReconnect = shouldReconnectAfterDisconnect(error);
      console.log("❌ انقطع الاتصال:", error?.message, statusCode ? `(status ${statusCode})` : "");

      if (shouldReconnect) {
        scheduleReconnect();
      } else {
        console.log("🚫 لا يمكن إعادة الاتصال (خطأ مصادقة)");
        if (statusCode === 405) {
          console.log("405 يعني أن واتساب رفض جلسة Baileys أثناء التسجيل. جرّب حذف auth من Volume وإعادة الربط، وإذا تكرر فالسبب غالبًا بيئة الاستضافة/IP.");
        } else {
          console.log("امسح جلسة auth من Volume ثم اربط البوت من جديد عبر QR.");
        }
      }
    }

  });

  sock.ev.on("creds.update", saveCreds);

  // نظام تسجيل الألقاب التلقائي في مجموعة الاستقبال
  sock.ev.on("group-participants.update", async (update) => {
    const { id, participants, action } = update;
    const kingdom = getKingdomFromGroupJid(id);
    const receptionJid = kingdom?.receptionGroup || id;
    const { awaitingNicknameRegistration, nicknameRegistrationStages } = await import('./handlers/messageHandler.js');

    console.log(`Group participants update: id=${id}, action=${action}, participants=${participants}`);

    // التحقق من أن التحديث في مجموعة الاستقبال وأن الإجراء هو انضمام
    if (id === receptionJid && action === 'add') {
      console.log(`New participants in reception group: ${participants}`);
      for (const participant of participants) {
        const participantJid = participant.id || participant;

        // إذا كان هذا العضو معروف مسبقاً (بما في ذلك من دخل أثناء توقف البوت)، تجاهل الترحيب
        const knownSet = knownReceptionParticipants.get(receptionJid) || new Set();
        if (knownSet.has(participantJid)) {
          console.log(`Skipping known reception participant: ${participantJid}`);
          continue;
        }

        // حفظ العضو في القائمة المعروفة حتى لا نعيد الترحيب به بعد إعادة التشغيل
        knownSet.add(participantJid);
        knownReceptionParticipants.set(receptionJid, knownSet);

        // جلب بيانات المملكة (حتى لا تترابط البيانات بين الممالك)
        const kingdom = getKingdomFromGroupJid(id);
        const kingdomId = kingdom.id;

        // جلب المستخدم من قاعدة البيانات (قد يكون له mention مخصص)
        const existingUser = await User.findOne({ jid: participantJid, kingdom_id: kingdomId });
        console.log(`Checking user ${participantJid} (kingdom=${kingdomId}): existing=${!!existingUser}, nickname=${existingUser?.nickname}`);
        // تحديد المنشن: إذا كان له mention مخصص استخدمه، وإلا ابني من JID
        let mentionText;
        if (existingUser && existingUser.mention) {
          mentionText = existingUser.mention;
        } else {
          mentionText = getMentionFromJID(participantJid) || `@${participantJid.split('@')[0]}`;
        }
        if (!existingUser || !existingUser.nickname) {
          // إضافة المستخدم إلى قائمة الانتظار مع المرحلة الأولى (ترحيب)
          awaitingNicknameRegistration.add(participantJid);
          nicknameRegistrationStages[participantJid] = {
            stage: 'sourceInput',
            jid: id
          };
          console.log(`Added ${participantJid} to awaitingNicknameRegistration (stage: sourceInput)`);

          // محاولة الحصول على اسم الواتساب
          let whatsappUserName = 'صديق';
          try {
            const contact = await sock.getStatus(participantJid);
            whatsappUserName = contact?.name || participant.notify || 'صديق';
          } catch (err) {
            whatsappUserName = participant.notify || existingUser?.whatsappName || 'صديق';
          }

          const welcomeMessage = `*🎉 نورت ${kingdom.name} ${mentionText}*

أهلًا فيك.

مين اللي جابك أو من طرف مين دخلت؟

مثال: من طرف أحمد`;

          await sock.sendMessage(id, { text: welcomeMessage, mentions: [participantJid] });
          console.log(`Sent welcome message to ${participantJid}`);
        } else {
          console.log(`User ${participantJid} already has nickname: ${existingUser.nickname}`);
        }
      }
    } else {
      console.log(`Not reception group or not add action: id=${id}, expected=${receptionJid}, action=${action}`);
    }
  });

  sock.ev.on("messages.upsert", async (m) => {

    const msg = m.messages[0];

    if (!msg.key.fromMe) {
      try {
        const { messageHandler } = await import("./handlers/messageHandler.js");
        await messageHandler(sock, msg);
      } catch (err) {
        console.error("❌ خطأ في معالجة الرسالة:", err);
      }
    }

  });

  } catch (error) {
    isStartingBot = false;
    activeSock = null;
    console.error("❌ فشل بدء اتصال واتساب:", error.message);
    scheduleReconnect();
  }

}

startBot();
