import { DEVELOPER_JID, DEVELOPER_JIDS } from "../config.js";
import ShatreenComment from "../database/shatreenCommentModel.js";
import { generateSamBotAIJson } from "../utils/samBotAI.js";

// Comments on شاطرين's Instagram (@shatreen.app), answered with the developer's approval:
// every few minutes the bot reads new comments through Upload-Post, Gemini drafts a short reply
// in Bit's voice, and the draft goes to the developer on WhatsApp. Replying to that message with
// ✅ posts it, ❌ skips it, and any other text is posted instead. A comment made only of emoji is
// thanked straight away (SHATREEN_AUTO_THANKS=false turns that off). Nothing else is ever posted
// without the developer.
//
// Env: UPLOAD_POST_API_KEY (required to run), SHATREEN_UPLOAD_POST_USER (profile, default "default"),
// SHATREEN_COMMENTS_EVERY_MIN (default 10), SHATREEN_NOTIFY_JIDS (who approves; default the developer).

const API = "https://api.upload-post.com/api/uploadposts";
const OWN_HANDLE = "shatreen.app";
const RECENT_POSTS = 6;
const THANKS = "شكراً! 🤖";

const BIT = [
  "أنت بِت، الروبوت الصغير في منصة «شاطرين» (shatreen.com): منصة عربية مجانية يتعلّم فيها الأطفال من ٧ إلى ١٤ سنة البرمجة باللعب.",
  "اكتب رداً واحداً على تعليق إنستغرام، بالعربية الفصحى البسيطة.",
  "الرد قصير جداً (من ٣ إلى ١٢ كلمة) ويفي بالغرض، بلا مبالغة ولا مديح زائد، مع إيموجي واحد أو اثنين على الأكثر.",
  "لا تفترض جنس صاحب التعليق: تجنّب صيغ المذكر والمؤنث (مثلاً «شكراً لك» بدل «شكراً لكِ»).",
  "إن سأل عن المنصة فأجب باختصار، والرابط shatreen.com. لا تَعِد بشيء غير موجود، ولا تطلب بيانات شخصية.",
  "إن كان التعليق مسيئاً أو إعلاناً أو لا يستحق رداً، فاكتب كلمة واحدة فقط: تجاهل",
  "اكتب نص الرد فقط، بلا علامات اقتباس ولا شرح."
].join("\n");

// Post-specific knowledge, matched on the caption.
const PUZZLES = [
  {
    match: /تحدّي بِت|تحدي بت/,
    note: "هذا منشور «تحدّي بِت»: بِت أسفل يمين اللوحة وينظر يساراً، والجوهرة في العمود الثاني أعلى اللوحة. الحل الصحيح: تقدّم، تقدّم، استدر يميناً، تقدّم، تقدّم، تقدّم. إن كتب أحدهم الحل الصحيح فهنّئه باختصار، وإن أخطأ فقل إنه قريب وأعطه تلميحاً صغيراً دون كشف الحل. ومن كتب «مؤسس» تصله رسالة خاصة تلقائياً، فقل له إنها وصلته في الرسائل."
  }
];

let pollTimer = null;
let polling = false;

const apiKey = () => String(process.env.UPLOAD_POST_API_KEY || "").trim();
const profile = () => process.env.SHATREEN_UPLOAD_POST_USER || "default";
const approvers = () =>
  (process.env.SHATREEN_NOTIFY_JIDS || DEVELOPER_JID)
    .split(",")
    .map((j) => j.trim())
    .filter(Boolean);

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Apikey ${apiKey()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(`Upload-Post ${path.split("?")[0]}: ${res.status} ${data.message || data.error || ""}`.trim());
  return data;
}

const onlyEmoji = (text) => {
  const t = String(text || "").replace(/@\S+/g, "").trim();
  return t.length > 0 && !/[\p{L}\p{N}]/u.test(t);
};

async function draftReply({ text, caption }) {
  const notes = PUZZLES.filter((p) => p.match.test(caption)).map((p) => p.note);
  const prompt = [
    `المنشور: «${String(caption).slice(0, 300)}»`,
    ...notes,
    `التعليق: «${String(text).slice(0, 500)}»`,
    "الرد:"
  ].join("\n");
  const out = await generateSamBotAIJson({ systemInstruction: BIT, prompt, maxOutputTokens: 80, temperature: 0.4 });
  return String(out || "").replace(/^[«"']+|[»"']+$/g, "").trim();
}

async function nextCode() {
  const last = await ShatreenComment.findOne({ code: { $gt: 0 } }).sort({ code: -1 }).select("code").lean();
  return (last?.code || 0) + 1;
}

async function postReply(doc, message) {
  await api("/comments/create", { method: "POST", body: { platform: "instagram", user: profile(), comment_id: doc.commentId, message } });
}

async function askDeveloper(sock, doc) {
  const caption = String(doc.postCaption || "").split("\n")[0].slice(0, 50);
  const text = [
    `💬 *تعليق جديد على إنستغرام* #${doc.code}`,
    `@${doc.username} على «${caption}»:`,
    `«${doc.text}»`,
    "",
    doc.draft === "تجاهل" ? "🤖 بِت يقترح: تجاهله" : `✍️ الرد المقترح:\n${doc.draft}`,
    "",
    "رُدّ على هذه الرسالة: ✅ للنشر · ❌ للتجاهل · أو اكتب رداً آخر"
  ].join("\n");
  let messageId = "";
  for (const jid of approvers()) {
    const sent = await sock.sendMessage(jid, { text });
    messageId ||= sent?.key?.id || "";
  }
  doc.waMessageId = messageId;
  await doc.save();
}

/** One pass: new comments on the latest posts → thanked, or drafted and sent for approval. */
export async function pollShatreenComments(getSock) {
  if (polling || !apiKey()) return;
  const sock = getSock();
  if (!sock) return;
  polling = true;
  try {
    // The first run only remembers what is already there (those were answered by hand).
    const firstRun = !(await ShatreenComment.exists({ commentId: "__start__" }));
    if (firstRun) await ShatreenComment.create({ commentId: "__start__", postId: "-", status: "seeded" });
    const { media = [] } = await api(`/media?platform=instagram&user=${encodeURIComponent(profile())}`);
    for (const post of media.slice(0, RECENT_POSTS)) {
      const { comments = [] } = await api(`/comments?platform=instagram&user=${encodeURIComponent(profile())}&post_id=${encodeURIComponent(post.id)}`);
      for (const c of comments) {
        const username = c.user?.username || c.username || "";
        if (!c.id || username === OWN_HANDLE) continue;
        if (await ShatreenComment.exists({ commentId: c.id })) continue;

        const base = { commentId: c.id, postId: post.id, postCaption: post.caption || "", username, text: c.text || "" };
        if (firstRun) {
          await ShatreenComment.create({ ...base, status: "seeded" });
          continue;
        }
        if (onlyEmoji(c.text) && process.env.SHATREEN_AUTO_THANKS !== "false") {
          const doc = await ShatreenComment.create({ ...base, status: "auto", reply: THANKS, decidedAt: new Date() });
          try {
            await postReply(doc, THANKS);
          } catch (error) {
            doc.status = "failed";
            await doc.save();
            console.warn("Shatreen auto-thanks failed:", error.message);
          }
          continue;
        }
        const draft = (await draftReply({ text: c.text, caption: post.caption || "" })) || THANKS;
        const doc = await ShatreenComment.create({ ...base, draft, code: await nextCode() });
        await askDeveloper(sock, doc);
      }
    }
  } catch (error) {
    console.warn("Shatreen comments poll failed:", error.message);
  } finally {
    polling = false;
  }
}

const YES = /^(✅|👍|نعم|اه|أه|ايوه|أيوه|انشر|نشر|ok|okay|yes|y)$/i;
const NO = /^(❌|👎|لا|تجاهل|تجاهله|no|n|skip)$/i;

/**
 * The developer's answer to a draft: a reply (quote) to the bot's message, or «#12 ✅».
 * Returns true when the message was an answer (so the normal handler skips it).
 */
export async function handleShatreenApproval(sock, msg) {
  if (!apiKey()) return false;
  const chat = msg.key?.remoteJid || "";
  const from = [chat, msg.key?.remoteJidAlt, msg.key?.participant].filter(Boolean);
  if (chat.endsWith("@g.us") || !from.some((j) => DEVELOPER_JIDS.includes(j) || approvers().includes(j))) return false;

  const m = msg.message || {};
  const body = String(m.conversation || m.extendedTextMessage?.text || "").trim();
  if (!body) return false;
  const quoted = m.extendedTextMessage?.contextInfo?.stanzaId || "";

  let doc = null;
  let answer = body;
  const byCode = body.match(/^#(\d+)\s*([\s\S]*)$/);
  if (byCode) {
    doc = await ShatreenComment.findOne({ code: Number(byCode[1]) });
    answer = byCode[2].trim() || "✅";
  } else if (quoted) {
    doc = await ShatreenComment.findOne({ waMessageId: quoted });
  }
  if (!doc) return false;

  const say = (text) => sock.sendMessage(chat, { text }, { quoted: msg });
  if (doc.status !== "pending") {
    await say(`#${doc.code} سبق التعامل معه (${doc.status === "sent" ? "نُشر" : "تُجوهل"}).`);
    return true;
  }
  if (NO.test(answer)) {
    doc.status = "ignored";
    doc.decidedAt = new Date();
    await doc.save();
    await say(`تم تجاهل #${doc.code} 👌`);
    return true;
  }
  const message = YES.test(answer) ? doc.draft : answer;
  if (!message || message === "تجاهل") {
    await say(`#${doc.code}: لا يوجد رد مقترح. اكتب الرد الذي تريده.`);
    return true;
  }
  try {
    await postReply(doc, message);
    doc.status = "sent";
    doc.reply = message;
    doc.decidedAt = new Date();
    await doc.save();
    await say(`✅ نُشر الرد على @${doc.username}:\n${message}`);
  } catch (error) {
    await say(`⚠️ لم يُنشر #${doc.code}: ${error.message}\nجرّب مرة أخرى بالرد على الرسالة نفسها.`);
  }
  return true;
}

/** Starts the watcher (no-op without UPLOAD_POST_API_KEY). */
export function startShatreenComments({ getSock }) {
  if (pollTimer || !apiKey()) return;
  const everyMin = Math.max(5, Number(process.env.SHATREEN_COMMENTS_EVERY_MIN) || 10);
  setTimeout(() => void pollShatreenComments(getSock), 60 * 1000);
  pollTimer = setInterval(() => void pollShatreenComments(getSock), everyMin * 60 * 1000);
  console.log(`📸 Shatreen Instagram comments: every ${everyMin} min`);
}
