// المساعد الشخصي للوسائط: تفريغ الرسائل الصوتية وتلخيصها، وقراءة الصور وملفات PDF عبر Gemini
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { featureEnabled } from "../services/botControls.js";
import { isBusinessCustomerChat } from "../services/businessMode.js";
import { generateSamBotAIFromParts, isSamBotAIAvailable } from "./samBotAI.js";
import { consumeAssistantQuota, quotaExceededMessage } from "./assistantQuota.js";

const MB = 1024 * 1024;
const MAX_AUDIO_SECONDS = Number(process.env.ASSISTANT_MAX_AUDIO_SECONDS || 600);
const MAX_AUDIO_BYTES = 15 * MB;
const MAX_IMAGE_BYTES = 10 * MB;
const MAX_PDF_BYTES = 15 * MB;
const LONG_AUDIO_SECONDS = 30;
const MAX_REPLY_CHARS = 3500;

const TRANSCRIBE_COMMANDS = ["فرغ", "فرّغ", "تفريغ", "نص"];
const READ_COMMANDS = ["اقرا", "اقرأ", "اشرح", "لخص"];

// ============================================
// استخراج الوسائط من الرسالة أو من الرسالة المقتبسة
// ============================================

export function unwrapMessage(message) {
  let inner = message || {};
  for (let guard = 0; guard < 5; guard += 1) {
    const next = inner.ephemeralMessage?.message
      || inner.viewOnceMessage?.message
      || inner.viewOnceMessageV2?.message
      || inner.viewOnceMessageV2Extension?.message
      || inner.documentWithCaptionMessage?.message;
    if (!next) break;
    inner = next;
  }
  return inner;
}

/** يعيد وصف الوسائط في رسالة (صوت/صورة/PDF) أو null. */
export function describeMedia(message) {
  const inner = unwrapMessage(message);
  if (inner.audioMessage) {
    const node = inner.audioMessage;
    return { type: "audio", key: "audioMessage", node, mimetype: node.mimetype || "audio/ogg", seconds: Number(node.seconds) || 0, bytes: Number(node.fileLength) || 0, caption: "" };
  }
  if (inner.imageMessage) {
    const node = inner.imageMessage;
    return { type: "image", key: "imageMessage", node, mimetype: node.mimetype || "image/jpeg", bytes: Number(node.fileLength) || 0, caption: node.caption || "" };
  }
  if (inner.documentMessage) {
    const node = inner.documentMessage;
    const mimetype = String(node.mimetype || "");
    const isPdf = mimetype === "application/pdf" || /\.pdf$/i.test(node.fileName || "");
    return { type: isPdf ? "pdf" : "document", key: "documentMessage", node, mimetype: isPdf ? "application/pdf" : mimetype, bytes: Number(node.fileLength) || 0, caption: node.caption || "", fileName: node.fileName || "" };
  }
  return null;
}

function getContextInfo(message) {
  const inner = unwrapMessage(message);
  return inner.extendedTextMessage?.contextInfo
    || inner.imageMessage?.contextInfo
    || inner.documentMessage?.contextInfo
    || inner.audioMessage?.contextInfo
    || null;
}

/** أمر مثل "/فرغ" أو "/اقرأ ما المكتوب؟" -> { mode, question } */
export function parseMediaCommand(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawName, ...rest] = trimmed.slice(1).split(/\s+/);
  const name = rawName.replace(/_/g, "").replace(/[أإآ]/g, "ا").replace(/ّ/g, "");
  const question = rest.join(" ").trim();
  if (TRANSCRIBE_COMMANDS.map((c) => c.replace(/[أإآ]/g, "ا").replace(/ّ/g, "")).includes(name)) return { mode: "transcribe", question };
  if (READ_COMMANDS.map((c) => c.replace(/[أإآ]/g, "ا")).includes(name)) return { mode: "read", question };
  return null;
}

function quotedMediaTarget(msg) {
  const contextInfo = getContextInfo(msg.message);
  if (!contextInfo?.quotedMessage) return null;
  const media = describeMedia(contextInfo.quotedMessage);
  if (!media) return null;
  return {
    media,
    message: {
      key: {
        remoteJid: msg.key.remoteJid,
        id: contextInfo.stanzaId,
        participant: contextInfo.participant,
        fromMe: false
      },
      message: contextInfo.quotedMessage
    }
  };
}

function isPrivateChat(jid) {
  return /@(s\.whatsapp\.net|lid)$/.test(String(jid || ""));
}

// ============================================
// Gemini
// ============================================

function audioInstruction() {
  return [
    "You transcribe WhatsApp voice notes for an Arabic-speaking user.",
    "Transcribe exactly what is said, in the same language and dialect, with light punctuation. Do not translate.",
    "If the audio is silent or unintelligible, set transcript to an empty string.",
    "summary: one or two short sentences in Arabic with the main point and any request, date, time, amount or name mentioned. Use an empty string if the note is very short.",
    "Return JSON only: {\"transcript\":\"...\",\"summary\":\"...\"}"
  ].join(" ");
}

function readInstruction() {
  return [
    "أنت سام، مساعد شخصي على واتساب.",
    "اقرأ المرفق (صورة أو ملف PDF) وأجب بالعربية بلهجة بسيطة وبشكل مرتب يناسب واتساب.",
    "إذا كان هناك سؤال من المستخدم فأجب عنه بالاعتماد على المرفق.",
    "بدون سؤال: إذا كان المرفق مستندًا أو فاتورة أو ورقة رسمية أو لقطة شاشة فيها نص، استخرج أهم المعلومات (الموضوع، التواريخ، المبالغ، الأسماء، المطلوب) بنقاط قصيرة.",
    "إذا كانت صورة عادية فصفها باختصار في سطرين.",
    "إذا كان النص بلغة أجنبية فاذكر ترجمة عربية مختصرة.",
    "لا تخترع معلومات غير موجودة في المرفق."
  ].join(" ");
}

function parseJson(text) {
  const source = String(text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const match = source.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function clip(text) {
  const value = String(text || "").trim();
  return value.length > MAX_REPLY_CHARS ? `${value.slice(0, MAX_REPLY_CHARS)}…` : value;
}

export function formatTranscription(result, seconds = 0) {
  const transcript = String(result?.transcript || "").trim();
  const summary = String(result?.summary || "").trim();
  if (!transcript) return "🤷 ما قدرت أفهم الرسالة الصوتية. ممكن الصوت واطي أو فيه ضجة.";
  const lines = ["📝 *نص الرسالة:*", clip(transcript)];
  if (summary && seconds >= LONG_AUDIO_SECONDS) lines.push("", `📌 *الخلاصة:* ${summary}`);
  return lines.join("\n");
}

function mediaTooLarge(media) {
  if (media.type === "audio") {
    if (media.seconds > MAX_AUDIO_SECONDS) return `⏱️ الرسالة الصوتية طويلة. الحد ${Math.round(MAX_AUDIO_SECONDS / 60)} دقائق.`;
    if (media.bytes > MAX_AUDIO_BYTES) return "📦 الملف الصوتي كبير جدًا.";
  }
  if (media.type === "image" && media.bytes > MAX_IMAGE_BYTES) return "📦 الصورة كبيرة جدًا.";
  if (media.type === "pdf" && media.bytes > MAX_PDF_BYTES) return "📦 ملف PDF كبير جدًا (الحد 15 ميغا).";
  return null;
}

async function processMedia(sock, jid, sender, target, question, quoted) {
  const { media } = target;
  const reply = (text) => sock.sendMessage(jid, { text }, { quoted });

  if (media.type === "document") {
    await reply("📄 حاليًا بقدر أقرأ ملفات PDF والصور والرسائل الصوتية فقط.");
    return;
  }

  const tooLarge = mediaTooLarge(media);
  if (tooLarge) {
    await reply(tooLarge);
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

  try {
    await sock.sendPresenceUpdate("composing", jid);
  } catch {
    // مؤشر الكتابة اختياري
  }

  let buffer;
  try {
    buffer = await downloadMediaMessage(target.message, "buffer", {}, { reuploadRequest: sock.updateMediaMessage });
  } catch (error) {
    console.warn("Media download failed:", error.message);
    await reply("❌ ما قدرت أنزّل الملف. ابعته مرة ثانية.");
    return;
  }

  const inlineData = { inlineData: { mimeType: media.mimetype.split(";")[0], data: buffer.toString("base64") } };

  if (media.type === "audio") {
    const raw = await generateSamBotAIFromParts({
      systemInstruction: audioInstruction(),
      parts: [inlineData, { text: "Transcribe this voice note." }],
      json: true
    });
    const result = parseJson(raw);
    if (!raw) {
      await reply("❌ صار خطأ أثناء التفريغ، جرب بعد شوي.");
      return;
    }
    await reply(formatTranscription(result || { transcript: raw }, media.seconds));
    return;
  }

  const userQuestion = question || media.caption || "";
  const answer = await generateSamBotAIFromParts({
    systemInstruction: readInstruction(),
    parts: [inlineData, { text: userQuestion ? `سؤال المستخدم: ${userQuestion}` : "اقرأ المرفق وأعطني الخلاصة." }],
    temperature: 0.3
  });
  await reply(answer ? clip(answer) : "❌ ما قدرت أقرأ الملف، جرب بعد شوي.");
}

// ============================================
// نقطة الدخول من معالج الرسائل
// ============================================

/**
 * - في الخاص: أي رسالة صوتية أو صورة أو PDF تُعالج تلقائيًا (والتعليق على الصورة يعتبر سؤالًا).
 * - في أي محادثة: الرد على وسائط بـ /فرغ أو /اقرأ [سؤال].
 * يعيد true إذا تعامل مع الرسالة.
 */
export async function handleMediaAssistant(sock, msg, text) {
  const jid = msg?.key?.remoteJid;
  const sender = msg?.key?.participant || jid;
  if (!jid || msg.key.fromMe || !featureEnabled("ai")) return false;

  // الأمر قد يكون نصًا يرد على وسائط، أو تعليقًا على الصورة/الملف نفسه
  const command = parseMediaCommand(text || describeMedia(msg.message)?.caption || "");
  if (command) {
    const target = quotedMediaTarget(msg) || (describeMedia(msg.message) ? { media: describeMedia(msg.message), message: msg } : null);
    if (!target) {
      const hint = command.mode === "transcribe"
        ? "↩️ رد على رسالة صوتية واكتب /فرغ وبطلعلك نصها."
        : "↩️ رد على صورة أو ملف PDF واكتب /اقرأ أو /اقرأ مع سؤالك.";
      await sock.sendMessage(jid, { text: hint }, { quoted: msg });
      return true;
    }
    try {
      await processMedia(sock, jid, sender, target, command.question, msg);
    } catch (error) {
      console.error("Media assistant failed:", error.message);
      await sock.sendMessage(jid, { text: "❌ صار خطأ، جرب مرة ثانية." }, { quoted: msg });
    }
    return true;
  }

  if (!isPrivateChat(jid)) return false;
  const media = describeMedia(msg.message);
  if (!media) return false;
  // تعليق يبدأ بـ / هو أمر لميزة أخرى (مثل الأوامر المخصصة)
  if (String(text || media.caption || "").trim().startsWith("/")) return false;
  if (await isBusinessCustomerChat(jid)) return false;

  try {
    await processMedia(sock, jid, sender, { media, message: msg }, "", msg);
  } catch (error) {
    console.error("Media assistant failed:", error.message);
    await sock.sendMessage(jid, { text: "❌ صار خطأ، جرب مرة ثانية." }, { quoted: msg });
  }
  return true;
}
