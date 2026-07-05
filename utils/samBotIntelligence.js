import User from "../database/userModel.js";
import { getKingdomIdFromGroupJid } from "../config.js";
import { generateSamBotAIReply } from "./samBotAI.js";

const BOT_NAMES = [
  "سام بوت",
  "سامبوت",
  "يا سام",
  "يا سام بوت",
  "sam bot",
  "sambot",
  "bot",
  "بوت"
];

const DIRECT_REPLY_COOLDOWN = 20 * 1000;
const DIRECT_MESSAGE_COOLDOWN = 8 * 1000;
const lastSmartReplyAt = new Map();

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s@_/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pick(list, seedText = "") {
  if (!list.length) return "";
  let seed = 0;
  for (const char of seedText) seed += char.charCodeAt(0);
  return list[seed % list.length];
}

function normalizeJid(jid = "") {
  return String(jid).split(":")[0];
}

function getBotJids(sock) {
  const rawId = sock.user?.id || "";
  const normalized = normalizeJid(rawId);
  const phone = normalized.split("@")[0];
  return new Set([rawId, normalized, phone ? `${phone}@s.whatsapp.net` : ""].filter(Boolean));
}

function isReplyToBot(sock, msg) {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  if (!contextInfo?.quotedMessage) return false;

  const botJids = getBotJids(sock);
  const participant = contextInfo.participant;
  const quotedRemoteJid = contextInfo.remoteJid;

  return botJids.has(participant) || botJids.has(normalizeJid(participant)) || botJids.has(quotedRemoteJid);
}

function mentionsBot(sock, msg) {
  const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const botJids = getBotJids(sock);
  return mentionedJids.some((jid) => botJids.has(jid) || botJids.has(normalizeJid(jid)));
}

export function hasBotName(text) {
  const normalized = normalizeText(text);
  return BOT_NAMES.some((name) => normalized.includes(normalizeText(name)));
}

function isPrivateChat(jid) {
  return !String(jid || "").endsWith("@g.us");
}

function isDirectedAtBot(sock, jid, msg, text) {
  return isPrivateChat(jid) || isReplyToBot(sock, msg) || mentionsBot(sock, msg) || hasBotName(text);
}

export function classifySamBotIntent(text) {
  const normalized = normalizeText(text);

  if (/(من انت|مين انت|شو انت|ايش انت|عرف بنفسك|تعرف بنفسك|اسمك|ما اسمك|مين سام بوت|ما هو سام بوت)/.test(normalized)) {
    return "identity";
  }

  if (/(شو بتقدر|ماذا تستطيع|ايش تقدر|اوامر|ساعدني|مساعده|كيف استخدمك|شو تسوي|ماذا تفعل)/.test(normalized)) {
    return "capabilities";
  }

  if (/(مزح|امزح|نكت|نكته|ضحكني|joke)/.test(normalized)) {
    return "joke";
  }

  if (/(شكرا|شكراً|تسلم|يعطيك العافيه|مشكور|ثانكس|thanks)/.test(normalized)) {
    return "thanks";
  }

  if (/(اسف|اسفه|اعتذر|حقك علي|زعلتك)/.test(normalized)) {
    return "apology";
  }

  if (/(احبك|بحبك|حبيبي|غالي|يا قلبي)/.test(normalized)) {
    return "affection";
  }

  if (/(حزين|زعلان|مضايق|تعبان|مكتئب|ضايق|مخنوق|طفشان)/.test(normalized)) {
    return "sad";
  }

  if (/(فرحان|مبسوط|سعيد|نجحت|فزت|رهيب|جامد|اسطوري|ممتاز)/.test(normalized)) {
    return "happy";
  }

  if (/(رايك|شو رايك|ايش رايك|تنصح|اختار|افضل)/.test(normalized)) {
    return "opinion";
  }

  if (/(كيفك|كيف حالك|شلونك|شو اخبارك|اخبارك|how are you)/.test(normalized)) {
    return "wellbeing";
  }

  if (/(شو اليوم|اي يوم|اليوم شو|what day|date today)/.test(normalized)) {
    return "smalltalk";
  }

  if (/(شو لابس|ايش لابس|لابس اي|شو تلبس)/.test(normalized)) {
    return "smalltalk";
  }

  if (/(تمام|اوكي|اوك|حاضر|خلص|ماشي)/.test(normalized)) {
    return "ack";
  }

  if (/(السلام عليكم|مرحبا|اهلا|هلا|هاي|hello|hi|صباح الخير|مساء الخير)/.test(normalized)) {
    return "greeting";
  }

  return "conversation";
}

function removeBotAddressing(text) {
  let cleaned = String(text || "");
  for (const name of BOT_NAMES) {
    cleaned = cleaned.replace(new RegExp(name, "ig"), "");
  }
  return cleaned.replace(/[،,:-]+/g, " ").replace(/\s+/g, " ").trim();
}

function buildReply(intent, nickname, text) {
  const cleaned = removeBotAddressing(text);

  const replies = {
    identity: [
      `أنا سام بوت، بخدمة الممالك.`,
      `سام بوت، مساعد النقابات.`
    ],
    capabilities: [
      `أدير أوامر الممالك والألعاب.`,
      `اكتب /أوامر وشوف القائمة.`
    ],
    joke: [
      `الإداري كتب آخر تنبيه… للمرة العاشرة.`,
      `السرعة حلوة، بس الفهم أحلى.`,
      `مزحة خفيفة، بدون فوضى.`
    ],
    thanks: [
      `العفو يا ${nickname}.`,
      `حاضر يا ${nickname}.`
    ],
    apology: [
      `ولا يهمك يا ${nickname}.`,
      `حصل خير يا ${nickname}.`
    ],
    affection: [
      `محبتك وصلت يا ${nickname}.`,
      `غالي يا ${nickname}.`
    ],
    sad: [
      `الله يهونها يا ${nickname}.`,
      `خذ نفس، أنا سامع.`
    ],
    happy: [
      `جميل يا ${nickname}.`,
      `ممتاز، كمل هيك.`
    ],
    opinion: [
      `اختار الأبسط والأوضح.`,
      `رأيي: قلل الفوضى.`
    ],
    wellbeing: [
      `الحمد لله تمام.`,
      `تمام، وانت؟`
    ],
    smalltalk: [
      `موجود معكم هون.`,
      `خلينا بأخبار المملكة.`
    ],
    ack: [
      `تمام يا ${nickname}. واضح ومفهوم.`,
      `ماشي، تمام.`
    ],
    greeting: [
      `أهلًا يا ${nickname}.`,
      `هلا يا ${nickname}.`
    ],
    conversation: [
      cleaned
        ? `وضحها أكثر يا ${nickname}.`
        : `معك يا ${nickname}.`,
      `قصدك شو بالضبط؟`,
      `خلينا بالمطلوب.`
    ]
  };

  return pick(replies[intent] || replies.conversation, `${intent}:${text}:${nickname}`);
}

function shouldUseOnlineAI(intent) {
  return !["identity", "capabilities"].includes(intent);
}

async function getNickname(jid, sender, msg) {
  const kingdom = getKingdomIdFromGroupJid(jid);
  const user = await User.findOne({ jid: sender, kingdom_id: kingdom });
  return user?.nickname || msg.pushName || "صديقي";
}

function shouldThrottle(key, cooldown) {
  const now = Date.now();
  const last = lastSmartReplyAt.get(key) || 0;
  if (now - last < cooldown) return true;
  lastSmartReplyAt.set(key, now);
  return false;
}

export async function handleSamBotInteraction(sock, jid, sender, text, msg) {
  if (!text || text.startsWith("/")) return false;

  const directed = isDirectedAtBot(sock, jid, msg, text);
  if (!directed) return false;

  const throttleKey = `${jid}:${sender}:smart`;
  const cooldown = isReplyToBot(sock, msg) ? DIRECT_REPLY_COOLDOWN : DIRECT_MESSAGE_COOLDOWN;
  if (shouldThrottle(throttleKey, cooldown)) {
    return true;
  }

  const nickname = await getNickname(jid, sender, msg);
  const intent = classifySamBotIntent(text);
  const aiReply = shouldUseOnlineAI(intent)
    ? await generateSamBotAIReply({
        userMessage: text,
        nickname,
        intent,
        isPrivate: isPrivateChat(jid)
      })
    : "";
  const reply = aiReply || buildReply(intent, nickname, text);

  await sock.sendMessage(jid, {
    text: reply,
    mentions: [sender]
  });

  return true;
}
