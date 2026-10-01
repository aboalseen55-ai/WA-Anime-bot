// أدوات المجموعات: ملخص "شو فاتني"، حماية من الروابط والسبام، نداء للكل، وتذكيرات المجموعة
import GroupSettings from "../database/groupSettingsModel.js";
import PersonalItem from "../database/personalItemModel.js";
import { DEVELOPER_JIDS } from "../config.js";
import { featureEnabled } from "../services/botControls.js";
import { generateSamBotAIFromParts, isSamBotAIAvailable } from "./samBotAI.js";
import { consumeAssistantQuota, quotaExceededMessage } from "./assistantQuota.js";
import { formatDueAt, parseReminderRequest } from "./personalAssistant.js";

const HISTORY_LIMIT = 300;
const DEFAULT_SUMMARY_COUNT = 150;
const MIN_SUMMARY_COUNT = 10;
const METADATA_TTL_MS = 60 * 1000;
const SETTINGS_TTL_MS = 60 * 1000;
const SPAM_WINDOW_MS = 10 * 1000;
const SPAM_MAX_MESSAGES = 7;
const WARN_COOLDOWN_MS = 60 * 1000;
const GROUP_REMINDER_LIMIT = 30;
const LINK_RE = /(chat\.whatsapp\.com\/|wa\.me\/|https?:\/\/|www\.)\S+/i;

const isGroup = (jid) => String(jid || "").endsWith("@g.us");
const bare = (jid) => String(jid || "").split(":")[0].split("@")[0];

function normalizeCommand(text) {
  return String(text || "")
    .trim()
    .replace(/_/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

// ============================================
// سجل الرسائل الأخيرة (بالذاكرة فقط، ويضيع عند إعادة التشغيل)
// ============================================

const history = new Map();

export function recordGroupMessage(jid, name, text, at = Date.now()) {
  if (!isGroup(jid) || !text || text.startsWith("/")) return;
  if (!history.has(jid)) history.set(jid, []);
  const list = history.get(jid);
  list.push({ name: String(name || "عضو").slice(0, 40), text: String(text).slice(0, 600), at });
  if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT);
}

export function getGroupHistory(jid) {
  return history.get(jid) || [];
}

export function clearGroupHistory() {
  history.clear();
}

// ============================================
// صلاحيات المجموعة
// ============================================

const metadataCache = new Map();

async function getMetadata(sock, jid) {
  const cached = metadataCache.get(jid);
  if (cached && Date.now() - cached.at < METADATA_TTL_MS) return cached.data;
  const data = await sock.groupMetadata(jid);
  metadataCache.set(jid, { data, at: Date.now() });
  return data;
}

function participantIds(participant) {
  return [participant.id, participant.lid, participant.jid, participant.phoneNumber].filter(Boolean).map(bare);
}

export async function isGroupAdmin(sock, jid, sender) {
  if (DEVELOPER_JIDS.some((dev) => bare(dev) === bare(sender))) return true;
  try {
    const metadata = await getMetadata(sock, jid);
    const target = bare(sender);
    return metadata.participants.some((p) => p.admin && participantIds(p).includes(target));
  } catch {
    return false;
  }
}

async function isBotAdmin(sock, jid) {
  try {
    const metadata = await getMetadata(sock, jid);
    const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map(bare);
    return metadata.participants.some((p) => p.admin && participantIds(p).some((id) => botIds.includes(id)));
  } catch {
    return false;
  }
}

// ============================================
// /ملخص
// ============================================

function summaryInstruction() {
  return [
    "أنت سام، مساعد على واتساب. لخّص محادثة مجموعة لشخص فاتته.",
    "اكتب بالعربية بلهجة بسيطة، بنقاط قصيرة مناسبة لواتساب، بدون جداول.",
    "ابدأ بأهم المواضيع، ثم القرارات أو المواعيد أو الطلبات إن وجدت، ثم الأسئلة التي ما زالت بدون جواب.",
    "اذكر الأسماء فقط عندما تهم (مين طلب أو قرر شيئًا).",
    "تجاهل التحيات والرسائل القصيرة غير المهمة. لا تخترع شيئًا غير موجود.",
    "إذا كانت المحادثة دردشة عادية بدون شيء مهم، قل ذلك بسطر واحد."
  ].join(" ");
}

async function summarizeGroup(sock, jid, sender, args, msg) {
  const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
  const requested = Number(String(args).match(/\d+/)?.[0]) || DEFAULT_SUMMARY_COUNT;
  const count = Math.min(Math.max(requested, MIN_SUMMARY_COUNT), HISTORY_LIMIT);
  const messages = getGroupHistory(jid).slice(-count);

  if (messages.length < MIN_SUMMARY_COUNT) {
    await reply("🗒️ ما في رسائل كفاية لألخصها. بحفظ آخر الرسائل من وقت آخر تشغيل للبوت فقط.");
    return;
  }
  if (!isSamBotAIAvailable()) {
    await reply("⚠️ خدمة الذكاء الاصطناعي متوقفة حاليًا، جرب بعد شوي.");
    return;
  }
  const quota = await consumeAssistantQuota(sender);
  if (!quota.allowed) {
    if (quota.notify) await reply(quotaExceededMessage(quota.limit));
    return;
  }

  const transcript = messages.map((m) => `${m.name}: ${m.text}`).join("\n");
  const summary = await generateSamBotAIFromParts({
    systemInstruction: summaryInstruction(),
    parts: [{ text: `آخر ${messages.length} رسالة:\n${transcript}` }],
    maxOutputTokens: 700,
    temperature: 0.3
  });
  await reply(summary ? `🗒️ *ملخص آخر ${messages.length} رسالة*\n\n${summary}` : "❌ ما قدرت ألخص هلأ، جرب بعد شوي.");
}

// ============================================
// /نداء
// ============================================

async function callEveryone(sock, jid, sender, args, msg) {
  if (!(await isGroupAdmin(sock, jid, sender))) {
    await sock.sendMessage(jid, { text: "🔒 النداء للكل بس لمشرفين المجموعة." }, { quoted: msg });
    return;
  }
  const metadata = await getMetadata(sock, jid);
  const mentions = metadata.participants.map((p) => p.id);
  const body = args.trim() || "📢 انتباه الجميع";
  await sock.sendMessage(jid, { text: `${body}\n\n${mentions.map((id) => `@${bare(id)}`).join(" ")}`, mentions });
}

// ============================================
// الحماية
// ============================================

const settingsCache = new Map();

async function getSettings(jid) {
  const cached = settingsCache.get(jid);
  if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.data;
  const data = await GroupSettings.findOne({ jid }).lean().catch(() => null);
  const value = { antiLink: Boolean(data?.antiLink), antiSpam: Boolean(data?.antiSpam) };
  settingsCache.set(jid, { data: value, at: Date.now() });
  return value;
}

export function clearGroupSettingsCache() {
  settingsCache.clear();
  metadataCache.clear();
  spamTracker.clear();
  lastWarnAt.clear();
}

async function protectionCommand(sock, jid, sender, args, msg) {
  const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
  const words = normalizeCommand(args).split(" ").filter(Boolean);
  const current = await getSettings(jid);

  if (!words.length) {
    await reply([
      "*🛡️ حماية المجموعة*",
      `🔗 منع الروابط: ${current.antiLink ? "شغال ✅" : "مطفي"}`,
      `🚫 منع السبام: ${current.antiSpam ? "شغال ✅" : "مطفي"}`,
      "",
      "▪️ /حماية روابط تشغيل · /حماية روابط ايقاف",
      "▪️ /حماية سبام تشغيل · /حماية سبام ايقاف",
      "(للمشرفين فقط، والبوت لازم يكون مشرف ليحذف الرسائل)"
    ].join("\n"));
    return;
  }

  if (!(await isGroupAdmin(sock, jid, sender))) {
    await reply("🔒 تغيير الحماية بس لمشرفين المجموعة.");
    return;
  }

  const field = /^روابط|^رابط|^link/.test(words[0]) ? "antiLink" : /^سبام|^spam|^تكرار/.test(words[0]) ? "antiSpam" : null;
  const on = /^(تشغيل|شغل|فعل|on)/.test(words[1] || "");
  const off = /^(ايقاف|اوقف|وقف|الغاء|off)/.test(words[1] || "");
  if (!field || (!on && !off)) {
    await reply("اكتب مثلًا: /حماية روابط تشغيل");
    return;
  }

  await GroupSettings.updateOne({ jid }, { $set: { [field]: on } }, { upsert: true });
  settingsCache.delete(jid);
  const label = field === "antiLink" ? "منع الروابط" : "منع السبام";
  const warning = on && !(await isBotAdmin(sock, jid)) ? "\n⚠️ البوت مش مشرف، فبقدر أنبّه بس ما بقدر أحذف." : "";
  await reply(`✅ ${label}: ${on ? "شغال" : "مطفي"}${warning}`);
}

const spamTracker = new Map();
const lastWarnAt = new Map();

function shouldWarn(key, now) {
  if (now - (lastWarnAt.get(key) || 0) < WARN_COOLDOWN_MS) return false;
  lastWarnAt.set(key, now);
  return true;
}

function messageText(msg) {
  const m = msg.message || {};
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || "";
}

/** يطبق الحماية على رسالة مجموعة. يعيد true إذا حُذفت الرسالة أو أوقفت المعالجة. */
export async function enforceGroupProtection(sock, msg, now = Date.now()) {
  const jid = msg?.key?.remoteJid;
  const sender = msg?.key?.participant;
  if (!isGroup(jid) || !sender || msg.key.fromMe) return false;

  const settings = await getSettings(jid);
  if (!settings.antiLink && !settings.antiSpam) return false;
  if (await isGroupAdmin(sock, jid, sender)) return false;

  const text = messageText(msg);
  let violation = null;

  if (settings.antiLink && LINK_RE.test(text)) violation = "link";

  if (!violation && settings.antiSpam) {
    const key = `${jid}|${sender}`;
    const times = (spamTracker.get(key) || []).filter((t) => now - t < SPAM_WINDOW_MS);
    times.push(now);
    spamTracker.set(key, times);
    if (spamTracker.size > 5000) spamTracker.delete(spamTracker.keys().next().value);
    if (times.length > SPAM_MAX_MESSAGES) violation = "spam";
  }

  if (!violation) return false;

  if (await isBotAdmin(sock, jid)) {
    await sock.sendMessage(jid, { delete: msg.key }).catch(() => {});
  }
  if (shouldWarn(`${jid}|${sender}|${violation}`, now)) {
    const reason = violation === "link" ? "الروابط ممنوعة بهاي المجموعة" : "خفف الرسائل شوي، في منع للسبام";
    await sock.sendMessage(jid, { text: `⚠️ @${bare(sender)} ${reason}.`, mentions: [sender] });
  }
  return true;
}

// ============================================
// تذكيرات المجموعة
// ============================================

async function addGroupReminder(sock, jid, sender, args, msg) {
  const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
  if (!(await isGroupAdmin(sock, jid, sender))) {
    await reply("🔒 تذكيرات المجموعة بس لمشرفين المجموعة.");
    return;
  }
  const parsed = parseReminderRequest(args);
  if (parsed.error) {
    await reply("⏰ اكتب الوقت ثم النص.\nمثال: /ذكر_القروب بكرة الساعة 8 مساءً الاجتماع\nأو: /ذكر_القروب كل جمعة الساعة 12 تذكير الجمعة");
    return;
  }
  const count = await PersonalItem.countDocuments({ kind: "groupReminder", chatJid: jid, status: { $in: ["pending", "sending"] } });
  if (count >= GROUP_REMINDER_LIMIT) {
    await reply(`❌ وصلت المجموعة للحد (${GROUP_REMINDER_LIMIT}) من التذكيرات.`);
    return;
  }
  await PersonalItem.create({ kind: "groupReminder", userJid: sender, chatJid: jid, text: parsed.message, dueAt: parsed.dueAt, repeat: parsed.repeat || null });
  const repeatLine = parsed.repeat ? `\n🔁 ${parsed.repeat === "daily" ? "يوميًا" : "أسبوعيًا"}` : "";
  await reply(`✅ ببعت بالمجموعة:\n📌 ${parsed.message}\n🕒 ${formatDueAt(parsed.dueAt)}${repeatLine}`);
}

async function listGroupReminders(jid) {
  return PersonalItem.find({ kind: "groupReminder", chatJid: jid, status: { $in: ["pending", "sending"] } }).sort({ dueAt: 1 }).lean();
}

async function showGroupReminders(sock, jid, msg) {
  const items = await listGroupReminders(jid);
  const text = items.length
    ? ["*⏰ تذكيرات المجموعة*", "", ...items.map((item, i) => `${i + 1}. ${item.text}\n   🕒 ${formatDueAt(item.dueAt)}${item.repeat ? " · 🔁" : ""}`), "", "للإلغاء: /الغاء_تذكير_القروب <رقم>"].join("\n")
    : "⏰ ما في تذكيرات للمجموعة.\nأضف: /ذكر_القروب بكرة الساعة 8 مساءً الاجتماع";
  await sock.sendMessage(jid, { text }, { quoted: msg });
}

async function cancelGroupReminder(sock, jid, sender, args, msg) {
  const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
  if (!(await isGroupAdmin(sock, jid, sender))) {
    await reply("🔒 بس لمشرفين المجموعة.");
    return;
  }
  const index = Number(String(args).match(/\d+/)?.[0]);
  const item = (await listGroupReminders(jid))[index - 1];
  if (!item) {
    await reply("❌ رقم غير صحيح. اعرض التذكيرات: /تذكيرات_القروب");
    return;
  }
  await PersonalItem.deleteOne({ _id: item._id, chatJid: jid });
  await reply(`🗑️ ألغيت: ${item.text}`);
}

// ============================================
// التوجيه
// ============================================

const COMMANDS = [
  { names: ["ملخص", "شو فاتني", "لخص القروب"], run: summarizeGroup, ai: true },
  { names: ["نداء", "منشن الكل"], run: callEveryone },
  { names: ["حمايه"], run: protectionCommand },
  { names: ["ذكر القروب", "ذكر المجموعه", "تذكير القروب"], run: addGroupReminder },
  { names: ["تذكيرات القروب", "تذكيرات المجموعه"], run: (sock, jid, sender, args, msg) => showGroupReminders(sock, jid, msg) },
  { names: ["الغاء تذكير القروب", "الغاء تذكير المجموعه"], run: cancelGroupReminder }
];

export function matchGroupCommand(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("/")) return null;
  const normalized = normalizeCommand(trimmed.slice(1));
  let best = null;
  for (const command of COMMANDS) {
    for (const name of command.names) {
      if ((normalized === name || normalized.startsWith(`${name} `)) && (!best || name.length > best.name.length)) {
        best = { name, command };
      }
    }
  }
  if (!best) return null;
  const args = normalized.slice(best.name.length).trim();
  // النص الأصلي للوسيط (بدون تطبيع) حتى يبقى كما كتبه العضو
  const original = trimmed.slice(1).replace(/_/g, " ").split(/\s+/).slice(best.name.split(" ").length).join(" ");
  return { command: best.command, args: original || args };
}

export async function handleGroupCommand(sock, jid, sender, text, msg) {
  const matched = matchGroupCommand(text);
  if (!matched) return false;
  if (!isGroup(jid)) {
    await sock.sendMessage(jid, { text: "👥 هذا الأمر بشتغل داخل المجموعات." });
    return true;
  }
  if (matched.command.ai && !featureEnabled("ai")) return false;
  try {
    await matched.command.run(sock, jid, sender, matched.args, msg);
  } catch (error) {
    console.error("Group command failed:", error.message);
    await sock.sendMessage(jid, { text: "❌ صار خطأ، جرب مرة ثانية." });
  }
  return true;
}
