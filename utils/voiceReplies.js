// وضع المحادثة الصوتية: سام يرد بفويس (ElevenLabs) بدل النص في الخاص
import AssistantProfile from "../database/assistantProfileModel.js";
import { createVoiceNote, ensureVoiceInAccount, getElevenLabsUsage, getVoiceCatalog, getVoiceMaxChars, isElevenLabsConfigured, modelSupportsAudioTags } from "../services/elevenLabsService.js";
import { isUnlimitedUser } from "./assistantQuota.js";
import { SAM_CAPABILITIES, assistantActionInstruction, currentTimeContext } from "./samCapabilities.js";

const VOICE_COMMANDS = new Set(["فويس", "صوتي", "رد صوتي"]);
const MAX_STYLE_CHARS = 150;

// كلمات عربية سهلة -> تاجز ElevenLabs
const STYLE_WORDS = [
  [["ناعم", "نعومه", "ناعمه"], "[softly]"],
  [["هادي", "هادئ", "هاديه", "هادئه", "هدوء"], "[calm]"],
  [["انثوي", "انثويه"], "[soft feminine tone]"],
  [["رومانسي", "رومانسيه", "رومانسيا"], "[romantic]"],
  [["دافي", "دافئ", "دافيه", "دافئه"], "[warmly]"],
  [["حنون", "حنونه"], "[tender]"],
  [["همس", "هامس", "وشوشه"], "[whispers]"],
  [["حماسي", "متحمس", "حماس"], "[excited]"],
  [["مرح", "مضحك", "ضاحك"], "[cheerfully]"]
];

/** "ناعم هادي رومانسي" -> "[softly] [calm] [romantic]"، والتاجز المكتوبة بين [] بتنقبل زي ما هي. */
export function parseVoiceStyle(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw.includes("[")) {
    return (raw.match(/\[[^\[\]\n]{1,40}\]/g) || []).join(" ").slice(0, MAX_STYLE_CHARS);
  }
  const words = normalize(raw).replace(/ة/g, "ه").split(/[\s،,]+/).filter(Boolean);
  const tags = [];
  for (const word of words) {
    // "وهادي" -> "هادي"
    const match = STYLE_WORDS.find(([keys]) => keys.includes(word) || keys.includes(word.replace(/^و/, "")));
    if (match && !tags.includes(match[1])) tags.push(match[1]);
  }
  return tags.join(" ").slice(0, MAX_STYLE_CHARS);
}

function defaultStyle() {
  return String(process.env.ELEVENLABS_STYLE_TAGS || "").trim();
}

async function getVoicePrefs(jid) {
  if (!jid) return { style: defaultStyle(), voiceId: "", voiceName: "" };
  const profile = await AssistantProfile.findOne({ jid }, { voiceStyle: 1, voiceId: 1, voiceName: 1 }).lean().catch(() => null);
  return { style: profile?.voiceStyle ?? defaultStyle(), voiceId: profile?.voiceId || "", voiceName: profile?.voiceName || "" };
}

async function getVoiceStyle(jid) {
  return (await getVoicePrefs(jid)).style;
}

/** الصوت يكلف رصيد ElevenLabs، فافتراضيًا للمطور والأدمنز فقط. */
export function canUseVoiceReplies(jid) {
  if (/^(1|true|yes|on)$/i.test(String(process.env.ELEVENLABS_VOICE_PUBLIC || ""))) return true;
  return isUnlimitedUser(jid);
}

export async function isVoiceReplyEnabled(jid) {
  if (!isElevenLabsConfigured() || !canUseVoiceReplies(jid)) return false;
  const profile = await AssistantProfile.findOne({ jid }, { voiceReplies: 1 }).lean().catch(() => null);
  return Boolean(profile?.voiceReplies);
}

/** يشيل الماركداون والإيموجي والروابط حتى يطلع الكلام طبيعي. */
export function toSpeakableText(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_~`>#]/g, "")
    .replace(/^[\s▪️•\-–]+/gmu, "")
    .replace(/\p{Extended_Pictographic}|️|‍/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * يرسل الرد كفويس إذا أمكن، وإلا كنص.
 * الردود الطويلة جدًا (قوائم وشروحات) تضل نص لأنها أسهل بالقراءة.
 */
export async function sendVoiceOrText(sock, jid, text, { quoted, mentions, userJid } = {}) {
  const speakable = toSpeakableText(text);
  if (speakable && speakable.length <= getVoiceMaxChars()) {
    try {
      await sock.sendPresenceUpdate("recording", jid);
    } catch {
      // اختياري
    }
    const prefs = await getVoicePrefs(userJid || jid);
    const voice = await createVoiceNote(speakable, { styleTags: prefs.style, voiceId: prefs.voiceId });
    if (voice) {
      await sock.sendMessage(jid, { audio: voice.audio, mimetype: voice.mimetype, ptt: true }, quoted ? { quoted } : undefined);
      return "voice";
    }
  }
  await sock.sendMessage(jid, { text, ...(mentions ? { mentions } : {}) }, quoted ? { quoted } : undefined);
  return "text";
}

export function formatUsage(usage) {
  if (usage?.error === "permission") {
    return "🔐 المفتاح ما عنده صلاحية يقرأ الرصيد.\nبموقع ElevenLabs: Developers > API Keys > عدّل المفتاح وخلي User = Read.\nأو شوف الرصيد مباشرة من صفحة Subscription بالموقع.";
  }
  if (usage?.error) return "❌ ما قدرت أجيب الرصيد من ElevenLabs هسا، جرب بعد شوي.";
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const percent = usage.limit ? Math.round((usage.used / usage.limit) * 100) : 0;
  const lines = [
    "🎙️ *رصيد ElevenLabs هالشهر*",
    `مستخدم: ${fmt(usage.used)} من ${fmt(usage.limit)} حرف (${percent}%)`,
    `ضايل: ${fmt(usage.remaining)} حرف`
  ];
  if (usage.resetAt) {
    lines.push(`بيتجدد: ${usage.resetAt.toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", day: "numeric", month: "long" })}`);
  }
  return lines.join("\n");
}

function normalize(text) {
  return String(text || "").trim().replace(/_/g, " ").replace(/[أإآ]/g, "ا").replace(/\s+/g, " ").toLowerCase();
}

// ============================================
// اختيار الصوت: /فويس صوت بيعرض 4 أصوات مرقمة، والرد برقم بيختار
// ============================================

const PICK_TTL_MS = 10 * 60 * 1000;
const voicePicks = new Map();
const GENDER_LABEL = { female: "👩 بنت", male: "👨 شب" };

function formatVoiceList(voices, currentId) {
  return [
    "🎙️ *اختار صوت سام*",
    "",
    ...voices.map((voice, i) => `${i + 1}. ${GENDER_LABEL[voice.gender]}: ${voice.name}${voice.id === currentId ? " ✅" : ""}`),
    `${voices.length + 1}. 🔁 الصوت الافتراضي`,
    "",
    "ارسل رقم الصوت."
  ].join("\n");
}

async function sendVoicePreviews(sock, jid, voices) {
  for (const [i, voice] of voices.entries()) {
    if (!voice.previewUrl) continue;
    try {
      await sock.sendMessage(jid, { audio: { url: voice.previewUrl }, mimetype: "audio/mpeg" });
    } catch (error) {
      console.warn(`Voice preview ${i + 1} failed:`, error.message);
    }
  }
}

async function chooseVoice(sock, jid, sender, voices, number) {
  const reply = (body) => sock.sendMessage(jid, { text: body });
  if (number === voices.length + 1) {
    await AssistantProfile.updateOne({ jid: sender }, { $set: { voiceId: null, voiceName: null } }, { upsert: true });
    await reply("🔁 رجعت للصوت الافتراضي.");
    return true;
  }
  const voice = voices[number - 1];
  if (!voice) {
    await reply(`❌ اختار رقم من 1 لـ ${voices.length + 1}.`);
    return false;
  }
  if (!await ensureVoiceInAccount(voice)) {
    await reply("❌ ما قدرت أضيف هاد الصوت لحساب ElevenLabs (ممكن الخطة المجانية ما بتسمح بأصوات المكتبة). جرب صوت ثاني.");
    return false;
  }
  // نجرب الصوت بجملة قصيرة قبل ما نحفظه، حتى ما يرجع سام يرد كتابة بصمت لو الصوت ما بيشتغل
  const sample = await createVoiceNote(`أهلين، أنا سام بصوت ${voice.name}. شو رأيك فيه؟`, { voiceId: voice.id, styleTags: (await getVoicePrefs(sender)).style });
  if (!sample) {
    await reply("❌ هاد الصوت ما اشتغل مع حساب ElevenLabs (ممكن الخطة الحالية ما بتسمح بأصوات المكتبة عبر الـAPI). جرب صوت ثاني.");
    return false;
  }
  await AssistantProfile.updateOne({ jid: sender }, { $set: { voiceId: voice.id, voiceName: voice.name } }, { upsert: true });
  await sock.sendMessage(jid, { audio: sample.audio, mimetype: sample.mimetype, ptt: true });
  const enabled = await isVoiceReplyEnabled(sender);
  await reply(`✅ صار صوت سام: ${voice.name}${enabled ? "" : "\nشغّل الردود الصوتية: /فويس تشغيل"}`);
  return true;
}

async function showVoicePicker(sock, jid, sender, numberArg) {
  const voices = await getVoiceCatalog();
  if (!voices.length) {
    await sock.sendMessage(jid, { text: "❌ ما قدرت أجيب الأصوات من ElevenLabs هسا.\nالمطور بقدر يثبتها بمتغير ELEVENLABS_VOICE_CHOICES." });
    return;
  }
  if (numberArg) {
    await chooseVoice(sock, jid, sender, voices, numberArg);
    return;
  }
  const { voiceId } = await getVoicePrefs(sender);
  voicePicks.set(`${jid}|${sender}`, { voices, at: Date.now() });
  await sock.sendMessage(jid, { text: formatVoiceList(voices, voiceId) });
  await sendVoicePreviews(sock, jid, voices);
}

/** رد برقم بعد /فويس صوت. أي رسالة ثانية بتسكر الاختيار. */
export async function handleVoicePickReply(sock, jid, sender, text) {
  const key = `${jid}|${sender}`;
  const pick = voicePicks.get(key);
  if (!pick) return false;
  const choice = String(text || "").trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (!/^\d{1,2}$/.test(choice) || Date.now() - pick.at > PICK_TTL_MS) {
    voicePicks.delete(key);
    return false;
  }
  if (await chooseVoice(sock, jid, sender, pick.voices, Number(choice))) voicePicks.delete(key);
  return true;
}

/** /فويس تشغيل | /فويس ايقاف | /فويس صوت | /فويس */
export async function handleVoiceCommand(sock, jid, sender, text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("/")) return false;
  const normalized = normalize(trimmed.slice(1));
  const name = [...VOICE_COMMANDS].find((cmd) => normalized === cmd || normalized.startsWith(`${cmd} `));
  if (!name) return false;
  const args = normalized.slice(name.length).trim();
  const reply = (body) => sock.sendMessage(jid, { text: body });

  if (!isElevenLabsConfigured()) {
    await reply("🎙️ الردود الصوتية مش مفعّلة على السيرفر بعد (لازم مفتاح ElevenLabs).");
    return true;
  }
  if (!canUseVoiceReplies(sender)) {
    await reply("🎙️ الردود الصوتية حاليًا لصاحب البوت بس.");
    return true;
  }

  if (/^(رصيد|الرصيد|حد|الحد|usage)/.test(args)) {
    await reply(formatUsage(await getElevenLabsUsage()));
    return true;
  }

  if (/^(صوت|الصوت|اصوات|الاصوات|voice)(\s|$)/.test(args)) {
    const number = Number(args.split(" ")[1]?.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
    await showVoicePicker(sock, jid, sender, Number.isInteger(number) && number > 0 ? number : null);
    return true;
  }

  if (/^(اسلوب|ستايل|style)/.test(args)) {
    const input = args.replace(/^(اسلوب|ستايل|style)\s*/, "");
    const tagsNote = modelSupportsAudioTags()
      ? ""
      : "\n⚠️ الأسلوب بيشتغل بس مع موديل eleven_v3 أو eleven_v4 (ELEVENLABS_MODEL_ID).";
    if (!input.trim()) {
      const current = await getVoiceStyle(sender);
      await reply(`🎭 أسلوب الصوت الحالي: ${current || "عادي"}\nللتغيير: /فويس اسلوب ناعم هادي رومانسي\nأو بتاجز ElevenLabs: /فويس اسلوب [softly] [warmly]\nللرجوع للعادي: /فويس اسلوب عادي${tagsNote}`);
      return true;
    }
    if (/^(عادي|افتراضي|الغاء|reset|default)$/i.test(normalize(input))) {
      await AssistantProfile.updateOne({ jid: sender }, { $set: { voiceStyle: null } }, { upsert: true });
      await reply("🎭 رجع الصوت للأسلوب العادي.");
      return true;
    }
    const style = parseVoiceStyle(input);
    if (!style) {
      await reply("🤔 ما فهمت الأسلوب. جرب كلمات مثل: ناعم، هادي، أنثوي، رومانسي، دافي، حنون، همس، حماسي، مرح\nأو تاجز بين قوسين: [softly] [warmly]");
      return true;
    }
    await AssistantProfile.updateOne({ jid: sender }, { $set: { voiceStyle: style } }, { upsert: true });
    await reply(`🎭 تمام! صار أسلوب الصوت: ${style}${tagsNote}`);
    return true;
  }

  if (/^(ايقاف|اوقف|وقف|الغاء|off|stop)/.test(args)) {
    await AssistantProfile.updateOne({ jid: sender }, { $set: { voiceReplies: false } }, { upsert: true });
    await reply("🔕 رجعت أرد عليك كتابة. ترجع الصوت بـ /فويس تشغيل");
    return true;
  }
  if (/^(تشغيل|شغل|فعل|on|start)/.test(args)) {
    await AssistantProfile.updateOne({ jid: sender }, { $set: { voiceReplies: true } }, { upsert: true });
    await reply("🎙️ تمام! من هسا بالخاص برد عليك بفويس. احكيلي بفويس أو اكتبلي، وأنا بجاوبك بصوت.\nللإيقاف: /فويس ايقاف");
    return true;
  }

  const enabled = await isVoiceReplyEnabled(sender);
  await reply(enabled
    ? "🎙️ الردود الصوتية شغالة. للإيقاف: /فويس ايقاف\n🗣️ لاختيار الصوت: /فويس صوت\n🎭 لتغيير أسلوب الصوت: /فويس اسلوب ناعم هادي\n📊 الرصيد: /فويس رصيد"
    : "🎙️ بقدر أرد عليك بفويس بالخاص بدل الكتابة.\nللتشغيل: /فويس تشغيل");
  return true;
}

/** تعليمات Gemini لما يبعت المستخدم فويس ووضع الصوت شغال: يفهمه ويرد عليه مباشرة. */
export function voiceConversationInstruction() {
  return [
    "You are Sam (سام), a friendly personal assistant on WhatsApp talking with the user by voice.",
    "Listen to the user's voice note and answer what they said or asked, in the same Arabic dialect they used (usually Jordanian).",
    "Your answer will be read aloud by a text-to-speech voice, so write natural spoken sentences: no emojis, no markdown, no bullet lists, no links.",
    "Keep it short and conversational: usually one to four sentences, longer only when they clearly ask for detail.",
    "If the audio is silent or unintelligible, set transcript to an empty string and ask them politely to repeat.",
    "These are the bot's real features and commands. When asked what you can do, describe them naturally in speech (say the command names in words, e.g. \"اكتب سلاش ذكرني\"), and never invent other features:",
    SAM_CAPABILITIES,
    assistantActionInstruction(),
    currentTimeContext(),
    "Put the command (or an empty string) in the command field; never put it in reply.",
    "Return JSON only: {\"transcript\":\"what the user said\",\"reply\":\"your spoken answer\",\"command\":\"/... or empty\"}"
  ].join("\n");
}
