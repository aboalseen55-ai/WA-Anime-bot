// ذاكرة سام لكل شخص بالخاص، بأقل توكنز ممكنة:
// - المعلومات المهمة بيطلعها رد الذكاء الاصطناعي نفسه بسطر [[MEM: ...]] (بدون طلب إضافي)
// - الأحاديث القديمة بتنضغط بملخص قصير كل كم رسالة بطلب صغير واحد، وبنتجاهل السلامات والردود القصيرة
// - للبرومبت بنبعت المعلومات + الملخص بس، مش كل التاريخ
import UserMemory from "../database/userMemoryModel.js";
import { generateSamBotAIFromParts, isSamBotAIAvailable } from "./samBotAI.js";

function envNumber(name, fallback) {
  const number = Number(process.env[name]);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

const MAX_FACTS = envNumber("SAM_MEMORY_MAX_FACTS", 15);
const MAX_FACT_LENGTH = 100;
const SUMMARY_MAX_LENGTH = 400;
const COMPACT_BATCH = envNumber("SAM_MEMORY_COMPACT_TURNS", 6);
const MAX_PENDING = 20;
const TRIVIAL_INTENTS = new Set(["greeting", "wellbeing", "wellbeing_answer", "ack", "thanks", "teasing"]);
const MEM_PATTERN = /\[\[\s*MEM\s*:\s*([^\]]+)\]\]/gi;

function trimText(text, limit) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit - 1).trim()}…`;
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** يفصل أسطر [[MEM: ...]] عن نص الرد. */
export function extractMemoryNotes(text) {
  const source = String(text || "");
  const notes = [...source.matchAll(MEM_PATTERN)]
    .map((match) => trimText(match[1], MAX_FACT_LENGTH))
    .filter(Boolean);
  const reply = source.replace(MEM_PATTERN, "").replace(/\n{3,}/g, "\n\n").trim();
  return { reply, notes };
}

/** يدمج معلومات جديدة بدون تكرار، والأقدم بيطلع إذا وصلنا الحد. */
export function mergeFacts(existing = [], notes = [], now = new Date()) {
  const facts = existing.map((fact) => ({ text: fact.text, at: fact.at || now }));
  for (const note of notes) {
    const text = trimText(note, MAX_FACT_LENGTH);
    const key = normalize(text);
    if (!key) continue;
    const index = facts.findIndex((fact) => {
      const other = normalize(fact.text);
      return other === key || other.includes(key) || key.includes(other);
    });
    // المعلومة الأحدث بتحل محل القديمة المشابهة (مثلًا غيّر شغله)
    if (index >= 0) facts.splice(index, 1);
    facts.push({ text, at: now });
  }
  return facts.slice(-MAX_FACTS);
}

export async function getUserMemory(userJid) {
  if (!userJid) return null;
  return UserMemory.findOne({ userJid }).lean();
}

/** السياق اللي بيروح مع كل رسالة: مختصر جدًا. */
export function buildUserMemoryContext(memory) {
  if (!memory) return "";
  const facts = (memory.facts || []).map((fact) => `- ${fact.text}`).join("\n");
  return [
    facts ? `facts:\n${facts}` : "",
    memory.summary ? `earlier: ${memory.summary}` : ""
  ].filter(Boolean).join("\n");
}

export async function rememberUserFacts(userJid, notes, now = new Date()) {
  if (!userJid || !notes?.length) return null;
  const memory = await getUserMemory(userJid);
  const facts = mergeFacts(memory?.facts || [], notes, now);
  await UserMemory.updateOne({ userJid }, { $set: { facts } }, { upsert: true });
  return facts;
}

export async function wipeUserMemory(userJid) {
  if (!userJid) return;
  await UserMemory.deleteOne({ userJid });
}

export async function forgetUserMemory(userJid, index) {
  if (!userJid || !index) return null;
  const memory = await getUserMemory(userJid);
  const fact = memory?.facts?.[index - 1];
  if (!fact) return null;
  const facts = memory.facts.filter((_, i) => i !== index - 1);
  await UserMemory.updateOne({ userJid }, { $set: { facts } });
  return fact;
}

export function formatUserMemory(memory) {
  const facts = memory?.facts || [];
  if (!facts.length && !memory?.summary) {
    return "🧠 لسا ما بعرف عنك اشي مهم.\nاحكيلي عن حالك أو اكتب: /تذكر <المعلومة>";
  }
  return [
    "*🧠 شو بتذكر عنك*",
    "",
    ...(facts.length ? facts.map((fact, i) => `${i + 1}. ${fact.text}`) : ["(ما في معلومات محفوظة)"]),
    ...(memory.summary ? ["", `*📌 آخر أحاديثنا:* ${memory.summary}`] : []),
    "",
    "للحذف: /انسى <رقم> · لمسح كل اشي: /انسى الكل"
  ].join("\n");
}

const COMPACT_INSTRUCTION = [
  "You maintain a compact long-term memory about one WhatsApp user for an assistant called Sam.",
  "Input: current facts, current summary, and older chat turns.",
  "Return JSON only: {\"summary\": string, \"facts\": string[]}.",
  "summary: at most 2 short sentences in the user's language about ongoing topics, plans, or open questions worth recalling next time. Drop greetings, small talk, and finished one-off questions.",
  "facts: only lasting, important facts about the user (name, job, city, family, preferences, goals, important dates). Keep existing facts unless contradicted. Max 15 items, each under 15 words.",
  "Never store passwords, card numbers, or codes."
].join(" ");

function parseJson(raw) {
  try {
    const text = String(raw || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** يضغط الرسائل المنتظرة بالملخص بطلب واحد صغير. */
const compacting = new Set();

export async function compactUserMemory(userJid, options = {}) {
  // رسالتين ورا بعض ما بيعملوا طلبين ضغط لنفس الشخص
  if (compacting.has(userJid)) return null;
  compacting.add(userJid);
  try {
    return await runCompaction(userJid, options);
  } finally {
    compacting.delete(userJid);
  }
}

async function runCompaction(userJid, { ai = generateSamBotAIFromParts, aiAvailable = isSamBotAIAvailable, now = new Date() } = {}) {
  const memory = await getUserMemory(userJid);
  const pending = memory?.pendingTurns || [];
  if (pending.length < COMPACT_BATCH || !aiAvailable()) return null;

  const prompt = [
    `facts:\n${(memory.facts || []).map((fact) => `- ${fact.text}`).join("\n") || "-"}`,
    `summary: ${memory.summary || "-"}`,
    `turns:\n${pending.map((turn) => `${turn.role}: ${turn.text}`).join("\n")}`
  ].join("\n");

  const parsed = parseJson(await ai({
    systemInstruction: COMPACT_INSTRUCTION,
    parts: [{ text: prompt }],
    maxOutputTokens: 300,
    temperature: 0.1,
    json: true
  }));
  if (!parsed) return null;

  const facts = Array.isArray(parsed.facts)
    ? mergeFacts([], parsed.facts.filter((fact) => typeof fact === "string"), now)
    : memory.facts || [];
  const summary = trimText(parsed.summary || memory.summary, SUMMARY_MAX_LENGTH);

  // نشيل بس الرسائل اللي انضغطت، لو وصل غيرها بالنص بتضل للمرة الجاية
  await UserMemory.updateOne({ userJid }, {
    $set: { facts, summary, summarizedAt: now },
    $pull: { pendingTurns: { _id: { $in: pending.map((turn) => turn._id) } } }
  });
  return { facts, summary };
}

/** الرسائل اللي طلعت من نافذة آخر الرسائل: المهم منها بيستنى الضغط، والسلامات بتنرمى. */
export async function queueTurnsForSummary(userJid, turns = [], options = {}) {
  if (!userJid) return null;
  const useful = turns
    .filter((turn) => !TRIVIAL_INTENTS.has(turn.intent))
    .filter((turn) => normalize(turn.text).length >= 4)
    .map((turn) => ({ role: turn.role, text: trimText(turn.text, 180), at: turn.at || new Date() }));
  if (!useful.length) return null;

  await UserMemory.updateOne(
    { userJid },
    { $push: { pendingTurns: { $each: useful, $slice: -MAX_PENDING } } },
    { upsert: true }
  );
  return compactUserMemory(userJid, options);
}
