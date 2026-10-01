// وضع المحادثة الصوتية: سام يرد بفويس (ElevenLabs) بدل النص في الخاص
import AssistantProfile from "../database/assistantProfileModel.js";
import { createVoiceNote, getVoiceMaxChars, isElevenLabsConfigured } from "../services/elevenLabsService.js";
import { isUnlimitedUser } from "./assistantQuota.js";

const VOICE_COMMANDS = new Set(["فويس", "صوتي", "رد صوتي"]);

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
export async function sendVoiceOrText(sock, jid, text, { quoted, mentions } = {}) {
  const speakable = toSpeakableText(text);
  if (speakable && speakable.length <= getVoiceMaxChars()) {
    try {
      await sock.sendPresenceUpdate("recording", jid);
    } catch {
      // اختياري
    }
    const voice = await createVoiceNote(speakable);
    if (voice) {
      await sock.sendMessage(jid, { audio: voice.audio, mimetype: voice.mimetype, ptt: true }, quoted ? { quoted } : undefined);
      return "voice";
    }
  }
  await sock.sendMessage(jid, { text, ...(mentions ? { mentions } : {}) }, quoted ? { quoted } : undefined);
  return "text";
}

function normalize(text) {
  return String(text || "").trim().replace(/_/g, " ").replace(/[أإآ]/g, "ا").replace(/\s+/g, " ").toLowerCase();
}

/** /فويس تشغيل | /فويس ايقاف | /فويس */
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
    ? "🎙️ الردود الصوتية شغالة. للإيقاف: /فويس ايقاف"
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
    "Return JSON only: {\"transcript\":\"what the user said\",\"reply\":\"your spoken answer\"}"
  ].join(" ");
}
