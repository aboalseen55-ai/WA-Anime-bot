import ShatreenComment from "../database/shatreenCommentModel.js";
import { generateSamBotAIJson } from "../utils/samBotAI.js";

// Comments on شاطرين's Instagram (@shatreen.app), answered automatically as Bit. Every
// SHATREEN_COMMENTS_EVERY_MIN minutes the bot reads new comments through Upload-Post and replies:
// the common cases (emoji, «مؤسس», answers to a puzzle) with fixed replies that cost no tokens,
// and only real sentences with a short Gemini reply. Nothing is sent to WhatsApp as it happens:
// the day's comments and replies are added under the platform's evening summary
// (instagramDaySection, called by services/shatreenHook.js).
//
// Env: UPLOAD_POST_API_KEY (required to run), SHATREEN_UPLOAD_POST_USER (profile, default "default"),
// SHATREEN_COMMENTS_EVERY_MIN (default 20).

const API = "https://api.upload-post.com/api/uploadposts";
const OWN_HANDLE = "shatreen.app";
const RECENT_POSTS = 6;
const TZ = "Asia/Amman";

const REPLIES = {
  thanks: "شكراً! 🤖",
  founder: "وصلتكم رسالة خاصة 📩 أهلاً بكم!",
  solved: "صح! 🎉 أحسنتم",
  close: "قريب! 👀 انتبهوا للصخرة فوق بِت"
};

const BIT = [
  "أنت بِت، الروبوت الصغير في منصة «شاطرين» (shatreen.com): منصة عربية مجانية يتعلّم فيها الأطفال من ٧ إلى ١٤ سنة البرمجة باللعب.",
  "اكتب رداً واحداً على تعليق إنستغرام، بالعربية الفصحى البسيطة.",
  "الرد قصير جداً (من ٣ إلى ١٢ كلمة) ويفي بالغرض، بلا مبالغة ولا مديح زائد، مع إيموجي واحد على الأكثر.",
  "لا تفترض جنس صاحب التعليق: تجنّب صيغ المذكر والمؤنث (مثلاً «شكراً لك» بدل «شكراً لكِ»).",
  "إن سأل عن المنصة فأجب باختصار، والرابط shatreen.com. لا تَعِد بشيء غير موجود، ولا تطلب بيانات شخصية.",
  "إن كان التعليق مسيئاً أو إعلاناً أو لا يستحق رداً، فاكتب كلمة واحدة فقط: تجاهل",
  "اكتب نص الرد فقط، بلا علامات اقتباس ولا شرح."
].join("\n");

// Puzzles posted as challenges, recognised by the caption, with their solution as moves.
const PUZZLES = [{ match: /تحدّي بِت|تحدي بت/, solution: "FFRFFF" }];

let pollTimer = null;
let polling = false;

const apiKey = () => String(process.env.UPLOAD_POST_API_KEY || "").trim();
const profile = () => process.env.SHATREEN_UPLOAD_POST_USER || "default";

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

/** Arabic without diacritics, tatweel or alef/ya/ta-marbuta variants, for matching. */
export const plainArabic = (text) =>
  String(text || "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase();

export const onlyEmoji = (text) => {
  const t = String(text || "").replace(/@\S+/g, "").trim();
  return t.length > 0 && !/[\p{L}\p{N}]/u.test(t);
};

/** The moves written in a comment («تقدم تقدم يمين…» → "FFR…"), or "" when it isn't an answer. */
export function movesIn(text) {
  const t = plainArabic(text);
  const moves = [];
  for (const m of t.matchAll(/(تقدم|للامام|امام|forward|يمين|يمينا|right|يسار|يسارا|left)(?:\s*[x×*]\s*(\d))?/g)) {
    const kind = /تقدم|امام|forward/.test(m[1]) ? "F" : /يمين|right/.test(m[1]) ? "R" : "L";
    moves.push(kind.repeat(Math.min(Number(m[2] || 1), 9)));
  }
  const all = moves.join("");
  return all.length >= 3 ? all : "";
}

/** A reply that needs no model, or null. */
export function fixedReply(text, caption) {
  if (onlyEmoji(text)) return REPLIES.thanks;
  if (/مؤسس/.test(plainArabic(text))) return REPLIES.founder;
  const puzzle = PUZZLES.find((p) => p.match.test(caption || ""));
  const moves = puzzle ? movesIn(text) : "";
  if (moves) return moves === puzzle.solution ? REPLIES.solved : REPLIES.close;
  if (/^(شكرا|شكراً|رائع|حلو|جميل|ممتاز|واو|wow|nice|great)[!.\s]*$/i.test(plainArabic(text).trim())) return REPLIES.thanks;
  return null;
}

async function aiReply(text, caption) {
  const prompt = [`المنشور: «${String(caption).slice(0, 200)}»`, `التعليق: «${String(text).slice(0, 400)}»`, "الرد:"].join("\n");
  const out = await generateSamBotAIJson({ systemInstruction: BIT, prompt, maxOutputTokens: 60, temperature: 0.4 });
  return String(out || "").replace(/^[«"']+|[»"']+$/g, "").trim();
}

async function postReply(commentId, message) {
  await api("/comments/create", { method: "POST", body: { platform: "instagram", user: profile(), comment_id: commentId, message } });
}

/** One pass over the latest posts: every new comment gets its reply. */
export async function pollShatreenComments() {
  if (polling || !apiKey()) return;
  polling = true;
  try {
    // The first run only remembers what is already there (those were answered by hand).
    const firstRun = !(await ShatreenComment.exists({ commentId: "__start__" }));
    if (firstRun) await ShatreenComment.create({ commentId: "__start__", postId: "-", status: "seeded" });
    const user = encodeURIComponent(profile());
    const { media = [] } = await api(`/media?platform=instagram&user=${user}`);
    for (const post of media.slice(0, RECENT_POSTS)) {
      const { comments = [] } = await api(`/comments?platform=instagram&user=${user}&post_id=${encodeURIComponent(post.id)}`);
      for (const c of comments) {
        const username = c.user?.username || c.username || "";
        if (!c.id || username === OWN_HANDLE) continue;
        if (await ShatreenComment.exists({ commentId: c.id })) continue;
        const caption = post.caption || "";
        const base = { commentId: c.id, postId: post.id, postCaption: caption, username, text: c.text || "" };
        if (firstRun) {
          await ShatreenComment.create({ ...base, status: "seeded" });
          continue;
        }
        let reply = fixedReply(c.text, caption);
        const how = reply ? "fixed" : "ai";
        if (!reply) reply = await aiReply(c.text, caption);
        if (!reply || reply === "تجاهل") {
          await ShatreenComment.create({ ...base, status: "ignored", how, decidedAt: new Date() });
          continue;
        }
        const doc = await ShatreenComment.create({ ...base, reply, how, status: "sent", decidedAt: new Date() });
        try {
          await postReply(c.id, reply);
        } catch (error) {
          doc.status = "failed";
          await doc.save();
          console.warn("Shatreen reply failed:", error.message);
        }
      }
    }
  } catch (error) {
    console.warn("Shatreen comments poll failed:", error.message);
  } finally {
    polling = false;
  }
}

const num = (n) => Number(n || 0).toLocaleString("ar-EG");

function startOfToday() {
  // Midnight in Amman, as a UTC Date.
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  return new Date(now.getTime() - (local.getHours() * 3600 + local.getMinutes() * 60 + local.getSeconds()) * 1000 - local.getMilliseconds());
}

/** The Instagram part of the evening summary: what came in today and what Bit answered. */
export async function instagramDaySection() {
  if (!apiKey()) return "";
  const docs = await ShatreenComment.find({ createdAt: { $gte: startOfToday() }, status: { $ne: "seeded" }, commentId: { $ne: "__start__" } })
    .sort({ createdAt: 1 })
    .lean();
  const sent = docs.filter((d) => d.status === "sent");
  const ai = sent.filter((d) => d.how === "ai").length;
  const ignored = docs.filter((d) => d.status === "ignored").length;
  const failed = docs.filter((d) => d.status === "failed").length;
  const lines = ["", "*إنستغرام*"];
  if (!docs.length) return [...lines, "💬 لا تعليقات جديدة اليوم"].join("\n");
  lines.push(`💬 تعليقات: ${num(docs.length)} · ردّ بِت على ${num(sent.length)}${ai ? ` (${num(ai)} بالذكاء)` : ""}`);
  if (ignored || failed) lines.push(`🙈 تجاهل: ${num(ignored)}${failed ? ` · ⚠️ لم يُنشر: ${num(failed)}` : ""}`);
  const short = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));
  for (const d of docs.slice(-8)) lines.push(`• @${d.username}: «${short(d.text, 40)}»${d.reply ? ` ← ${short(d.reply, 30)}` : " ← (تجاهل)"}`);
  if (docs.length > 8) lines.push(`… و${num(docs.length - 8)} غيرها`);
  return lines.join("\n");
}

/** Starts the watcher (no-op without UPLOAD_POST_API_KEY). */
export function startShatreenComments() {
  if (pollTimer || !apiKey()) return;
  const everyMin = Math.max(5, Number(process.env.SHATREEN_COMMENTS_EVERY_MIN) || 20);
  setTimeout(() => void pollShatreenComments(), 60 * 1000);
  pollTimer = setInterval(() => void pollShatreenComments(), everyMin * 60 * 1000);
  console.log(`📸 Shatreen Instagram comments: every ${everyMin} min`);
}
