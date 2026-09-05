import User from "../database/userModel.js";
import { resolveMentionContext } from "../commands/adminSystem.js";
import { getKingdomIdFromGroupJid } from "../config.js";
import { generateSamBotAIReply } from "./samBotAI.js";
import {
  buildSamBotMemoryContext,
  getRepeatedSocialReply,
  getSamBotMemory,
  rememberSamBotTurn
} from "./samBotMemory.js";
import {
  buildSamBotKingdomContext,
  resolveSamBotDirectoryQuestion
} from "./samBotKingdomContext.js";

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

const DIRECT_REPLY_COOLDOWN = 5 * 1000;
const DIRECT_MESSAGE_COOLDOWN = 5 * 1000;
const AMBIENT_SOCIAL_COOLDOWN = 45 * 1000;
const lastSmartReplyAt = new Map();
const AMBIENT_SOCIAL_INTENTS = new Set(["greeting", "wellbeing"]);

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

function getJidUser(jid = "") {
  return normalizeJid(jid).split("@")[0];
}

function getBotJids(sock) {
  const rawIds = [sock.user?.id, sock.user?.jid, sock.user?.lid].filter(Boolean);
  const botJids = new Set();

  for (const rawId of rawIds) {
    const normalized = normalizeJid(rawId);
    const user = getJidUser(normalized);
    [rawId, normalized, user ? `${user}@s.whatsapp.net` : "", user ? `${user}@lid` : ""]
      .filter(Boolean)
      .forEach((jid) => botJids.add(jid));
  }

  return botJids;
}

function isBotIdentifier(sock, jid) {
  if (!jid) return false;

  const botJids = getBotJids(sock);
  const normalized = normalizeJid(jid);
  const user = getJidUser(jid);

  if (botJids.has(jid) || botJids.has(normalized)) return true;
  return [...botJids].some((botJid) => user && getJidUser(botJid) === user);
}

function getContextInfo(msg) {
  const message = msg.message || {};
  const inner = message.ephemeralMessage?.message
    || message.viewOnceMessage?.message
    || message.viewOnceMessageV2?.message
    || message.documentWithCaptionMessage?.message
    || message;

  return inner.extendedTextMessage?.contextInfo
    || inner.imageMessage?.contextInfo
    || inner.videoMessage?.contextInfo
    || inner.documentMessage?.contextInfo
    || inner.audioMessage?.contextInfo
    || inner.stickerMessage?.contextInfo
    || inner.buttonsResponseMessage?.contextInfo
    || inner.listResponseMessage?.contextInfo
    || inner.templateButtonReplyMessage?.contextInfo
    || inner.reactionMessage?.contextInfo
    || null;
}

function isReplyToBot(sock, msg) {
  const contextInfo = getContextInfo(msg);
  if (!contextInfo?.quotedMessage) return false;

  return isBotIdentifier(sock, contextInfo.participant)
    || isBotIdentifier(sock, contextInfo.remoteJid);
}

function mentionsBot(sock, msg) {
  const mentionedJids = getContextInfo(msg)?.mentionedJid || [];
  return mentionedJids.some((jid) => isBotIdentifier(sock, jid));
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

function isAmbientSocialMessage(text, intent) {
  if (!AMBIENT_SOCIAL_INTENTS.has(intent)) return false;

  const normalized = normalizeText(text);
  if (!normalized || normalized.split(/\s+/).length > 6) return false;

  if (intent === "greeting") {
    return /^(السلام عليكم|سلام عليكم|سلام|مرحبا|اهلا|اهلين|هلا|هلا والله|هاي|hi|hello|صباح الخير|مساء الخير)( ورحمة الله وبركاته)?$/.test(normalized);
  }

  if (intent === "wellbeing") {
    return /^(كيفك|كيف حالك|كيف الحال|شلونك|شو اخبارك|اخبارك|كيفكم|كيفكو|how are you)( اليوم)?$/.test(normalized);
  }

  return false;
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

  if (/(مين\s+(?:اللي\s+)?(?:صمك|سكتك)|(?:صمك|سكتك)\s+مين)/.test(normalized)) {
    return "teasing";
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

  if (/(بخير|الحمد لله|الحمدلله|تمام الحمد|كويس|منيح|بأحسن حال|بالف خير|بالف خير)/.test(normalized)) {
    return "wellbeing_answer";
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
  const normalized = normalizeText(text);

  const replies = {
    identity: [
      `أنا سام بوت، مساعدكم هنا.`,
      `سام بوت، بساعدكم بالأوامر.`
    ],
    capabilities: [
      `أساعد بالأوامر والألعاب.`,
      `اكتب /أوامر وشوف القائمة.`
    ],
    joke: [
      `الإداري كتب آخر تنبيه… للمرة العاشرة.`,
      `السرعة حلوة، بس الفهم أحلى.`,
      `مزحة خفيفة، بدون فوضى.`
    ],
    teasing: [
      `ولا حدا، بس بحب الأمور تكون مرتبة.`,
      `ما حدا، أنا معكم وبسمع.`
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
      `تمام، وانت؟`,
      `الحمد لله، وأنت يا ${nickname}؟`
    ],
    wellbeing_answer: [
      `دوم الحمد لله.`,
      `الحمد لله، نورت.`,
      `تمام، الله يديمها عليك.`
    ],
    smalltalk: [
      `موجود معكم هون.`,
      `احكي، سامعك.`
    ],
    ack: [
      `تمام يا ${nickname}. واضح ومفهوم.`,
      `ماشي، تمام.`
    ],
    greeting: normalized.includes("السلام") || normalized.startsWith("سلام")
      ? [
          `وعليكم السلام.`,
          `وعليكم السلام ورحمة الله.`,
          `وعليكم السلام يا ${nickname}.`
        ]
      : [
          `أهلًا يا ${nickname}.`,
          `هلا يا ${nickname}.`,
          `يا هلا.`
        ],
    conversation: [
      cleaned
        ? `وضحها أكثر يا ${nickname}.`
        : `معك يا ${nickname}.`,
      `قصدك شو بالضبط؟`,
      `تمام، احكيلي المطلوب.`
    ]
  };

  return pick(replies[intent] || replies.conversation, `${intent}:${text}:${nickname}`);
}

function shouldUseOnlineAI(intent) {
  return !["identity", "capabilities", "greeting", "wellbeing", "wellbeing_answer", "ack", "thanks", "teasing"].includes(intent);
}

function isMentionRequest(text) {
  const normalized = normalizeText(text);
  return /(منشن|اعمل منشن|سوي منشن|سويله منشن|سوي لها منشن|ناديه|ناديها|tag|mention)/.test(normalized);
}

function getMentionRequestTarget(sock, msg, memory) {
  const contextInfo = getContextInfo(msg);
  const directlyMentioned = (contextInfo?.mentionedJid || [])
    .find((mentionedJid) => !isBotIdentifier(sock, mentionedJid));
  if (directlyMentioned) return directlyMentioned;

  const quotedSender = contextInfo?.quotedMessage && contextInfo.participant;
  if (quotedSender && !isBotIdentifier(sock, quotedSender)) return quotedSender;

  const rememberedTarget = memory?.lastMentionTargetJid;
  if (rememberedTarget && !isBotIdentifier(sock, rememberedTarget)) return rememberedTarget;

  return null;
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

  const intent = classifySamBotIntent(text);
  const directed = isDirectedAtBot(sock, jid, msg, text);
  const ambientSocial = !directed && !isPrivateChat(jid) && isAmbientSocialMessage(text, intent);
  if (!directed && !ambientSocial) return false;

  const throttleKey = ambientSocial ? `${jid}:${sender}:ambient:${intent}` : `${jid}:${sender}:smart`;
  const cooldown = ambientSocial ? AMBIENT_SOCIAL_COOLDOWN : (isReplyToBot(sock, msg) ? DIRECT_REPLY_COOLDOWN : DIRECT_MESSAGE_COOLDOWN);
  if (shouldThrottle(throttleKey, cooldown)) {
    return true;
  }

  const nickname = await getNickname(jid, sender, msg);
  const kingdom = getKingdomIdFromGroupJid(jid);
  const memory = await getSamBotMemory({
    groupJid: jid,
    userJid: sender,
    kingdomId: kingdom,
    nickname
  });

  if (!ambientSocial && isMentionRequest(text)) {
    const targetJid = getMentionRequestTarget(sock, msg, memory);
    if (!targetJid) {
      const clarification = "حدد العضو بمنشن مباشر أو رد على رسالته، وأنا أعمل المنشن فورًا.";
      await sock.sendMessage(jid, { text: clarification, mentions: [sender] });
      await rememberSamBotTurn({
        memory,
        groupJid: jid,
        userJid: sender,
        kingdomId: kingdom,
        nickname,
        intent: "mention_request",
        userMessage: text,
        botReply: clarification
      });
      return true;
    }

    const mentionContext = await resolveMentionContext(targetJid, kingdom);
    const reply = `تفضل، ${mentionContext.text}`;
    await sock.sendMessage(jid, {
      text: reply,
      mentions: mentionContext.mentions
    });
    await rememberSamBotTurn({
      memory,
      groupJid: jid,
      userJid: sender,
      kingdomId: kingdom,
      nickname,
      intent: "mention_request",
      userMessage: text,
      botReply: reply,
      mentionTargetJid: targetJid
    });
    return true;
  }

  const directoryReply = !ambientSocial
    ? await resolveSamBotDirectoryQuestion(sock, jid, text)
    : null;
  if (directoryReply) {
    await sock.sendMessage(jid, directoryReply);
    await rememberSamBotTurn({
      memory,
      groupJid: jid,
      userJid: sender,
      kingdomId: kingdom,
      nickname,
      intent: "member_directory",
      userMessage: text,
      botReply: directoryReply.text,
      mentionTargetJid: directoryReply.mentionTargetJid
    });
    return true;
  }

  const memoryContext = buildSamBotMemoryContext(memory, nickname);
  const kingdomContext = !ambientSocial
    ? await buildSamBotKingdomContext(jid, text)
    : "";
  const repeatedReply = getRepeatedSocialReply(memory, intent, nickname);
  const aiReply = !ambientSocial && shouldUseOnlineAI(intent)
    ? await generateSamBotAIReply({
        userMessage: text,
        nickname,
        intent,
        isPrivate: isPrivateChat(jid),
        memoryContext,
        kingdomContext
      })
    : "";
  const reply = repeatedReply || aiReply || buildReply(intent, nickname, text);

  await sock.sendMessage(jid, {
    text: reply,
    mentions: [sender]
  });

  await rememberSamBotTurn({
    memory,
    groupJid: jid,
    userJid: sender,
    kingdomId: kingdom,
    nickname,
    intent,
    userMessage: text,
    botReply: reply
  });

  return true;
}
