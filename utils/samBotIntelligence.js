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
      `أنا سام بوت، مساعد واتساب ذكي تم تطويره لخدمة الممالك وتنظيم الألعاب والأوامر. أتعامل معك حسب السياق، وإذا احتجت أمرًا واضحًا أقدر أساعدك بدون لف ودوران.`,
      `اسمي سام بوت. أساعد في إدارة الممالك، الأعضاء، الألعاب، الرتب، والردود الذكية داخل القروبات. اعتبرني مساعدًا منظمًا، مش مجرد رد تلقائي.`
    ],
    capabilities: [
      `أقدر أساعدك بالأوامر، الألعاب، ملفات الأعضاء، البنك، الرتب، وفتح الممالك حسب الصلاحيات. اكتب /أوامر للقائمة العامة، ولو كنت المطور اكتب /أوامر_المطور.`,
      `أنا أتعامل مع الأوامر والإدارة والألعاب، وأرد إذا الكلام موجه لي. ابدأ بـ /أوامر، أو اسألني بشكل مباشر مثل: سام بوت شو أقدر أعمل؟`
    ],
    joke: [
      `مزحة خفيفة: الإداري الناجح لا يصرخ في القروب، فقط يكتب "آخر تنبيه" للمرة السابعة بهدوء.`,
      `مرة واحد قال للبوت "رد بسرعة"... البوت رد: السرعة حلوة، بس الفهم أحلى.`,
      `النكتة المحترمة اليوم: أكثر شيء يخوف في القروبات ليس الحظر، بل رسالة "بدي أحكي معك خاص".`
    ],
    thanks: [
      `العفو يا ${nickname}. أنا هنا حتى أخفف الشغل، لا أزيده.`,
      `على الرحب والسعة يا ${nickname}. لما النظام يمشي بسلاسة بنكون كلنا مرتاحين.`
    ],
    apology: [
      `ولا يهمك يا ${nickname}. المهم نكمل بهدوء ونصلح اللي يحتاج إصلاح.`,
      `مقبولة يا ${nickname}. خلينا نعتبرها إعادة تشغيل ناعمة للمحادثة.`
    ],
    affection: [
      `محبتك وصلت يا ${nickname}. سام بوت يقدّر الكلام اللطيف، بس لا تخليني أخجل قدام السيرفر.`,
      `وأنا أقدّر وجودك يا ${nickname}. خلينا نخلي المحبة ومعها شوية نظام.`
    ],
    sad: [
      `فاهم عليك يا ${nickname}. خذ نفسًا صغيرًا، وخلينا نمسك الموضوع خطوة خطوة. إذا بدك تحكي، أنا سامع.`,
      `أحيانًا اليوم يكون ثقيل، بس وجودك هون كفاية كبداية. احكي لي شو مضايقك بدون استعجال.`
    ],
    happy: [
      `جميل يا ${nickname}. الحماس لما يكون مع تركيز يصير إنجاز، مش ضجة.`,
      `ممتاز. خلينا نحافظ على الزخم ونحوّله لشي واضح ينحسب لك.`
    ],
    opinion: [
      `رأيي: خذ القرار الذي يقلل الفوضى لاحقًا، حتى لو كان أبطأ الآن. الوضوح دائمًا يكسب.`,
      `لو بدك رأيي العملي: اختار الحل الأبسط الذي تقدر تشرحه لشخص جديد خلال دقيقة.`
    ],
    wellbeing: [
      `أنا بخير يا ${nickname}. شغال بهدوء وبراقب السياق قبل ما أرد، وهذا تطور جميل بصراحة.`,
      `تمام يا ${nickname}. طالما الرسالة واضحة وموجهة لي، سام بوت حاضر بدون ضجيج.`
    ],
    ack: [
      `تمام يا ${nickname}. واضح ومفهوم.`,
      `ماشي. خلينا نكمل على هذا الأساس.`
    ],
    greeting: [
      `أهلًا يا ${nickname}. سام بوت حاضر، احكي لي شو نعمل.`,
      `هلا يا ${nickname}. جاهز أساعدك، بس أعطني المطلوب بوضوح.`
    ],
    conversation: [
      cleaned
        ? `فهمت عليك يا ${nickname}. إذا تقصد "${cleaned}" فخلينا نحدده أكثر: هل بدك أمر، شرح، ولا قرار؟`
        : `معك يا ${nickname}. احكي لي المطلوب بشكل أوضح وأنا أرتبه لك.`,
      `واضح أنك موجه الكلام لي يا ${nickname}. أعطني الهدف النهائي، وأنا أساعدك نوصله بدون تعقيد.`,
      `أنا معك. خلينا نحول الكلام لخطوة عملية: ماذا تريد أن يحدث الآن؟`
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
