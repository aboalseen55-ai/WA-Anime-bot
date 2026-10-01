// أمر /حالة: فحص سريع لحالة البوت للمطور والأدمن
import mongoose from "mongoose";
import User from "../database/userModel.js";
import PersonalItem from "../database/personalItemModel.js";
import { ADMINS, DEVELOPER_JIDS } from "../config.js";

const TRIGGERS = new Set(["/حالة", "/حاله", "/status", "/health"]);
const MONGO_STATES = ["غير متصل ❌", "متصل ✅", "يتصل…", "يقطع الاتصال…"];

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days && `${days}ي`, hours && `${hours}س`, `${minutes}د`].filter(Boolean).join(" ");
}

export function isStatusCommand(text) {
  return TRIGGERS.has(String(text || "").trim().toLowerCase());
}

export async function buildBotStatusMessage(sock) {
  const memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const mongoState = MONGO_STATES[mongoose.connection.readyState] || "غير معروف";
  const [users, pendingReminders] = mongoose.connection.readyState === 1
    ? await Promise.all([
        User.estimatedDocumentCount().catch(() => null),
        PersonalItem.countDocuments({ kind: "reminder", status: "pending" }).catch(() => null)
      ])
    : [null, null];

  return [
    "🩺 *حالة البوت*",
    "",
    `📱 واتساب: ${sock?.user ? "متصل ✅" : "غير متصل ❌"}`,
    `🗄️ قاعدة البيانات: ${mongoState}`,
    `⏱️ مدة التشغيل: ${formatUptime(process.uptime())}`,
    `💾 الذاكرة: ${memoryMb} MB`,
    `👥 الأعضاء المسجلين: ${users ?? "غير معروف"}`,
    `⏰ تذكيرات بانتظار الإرسال: ${pendingReminders ?? "غير معروف"}`
  ].join("\n");
}

export async function handleBotStatusCommand(sock, jid, sender, text) {
  if (!isStatusCommand(text)) return false;
  if (!DEVELOPER_JIDS.includes(sender) && !ADMINS.includes(sender)) return false;
  await sock.sendMessage(jid, { text: await buildBotStatusMessage(sock) });
  return true;
}
