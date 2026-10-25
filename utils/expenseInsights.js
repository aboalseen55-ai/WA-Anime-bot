// أسئلة المصاريف بالذكاء الاصطناعي: "قديش صرفت على البنزين هالشهر؟"، "حلل مصاريفي ووين بقدر أوفر".
// الذكاء بيحدد الفترة والتصنيفات المطلوبة، والكود بيحسب الأرقام من الداتا (حتى ما يغلط بالجمع)، وبعدين الذكاء بيصيغ الجواب.
import Expense from "../database/expenseModel.js";
import { DEFAULT_TIME_ZONE, getTimeZoneParts, zonedTimeToUtc } from "./quran.js";
import { generateSamBotAIFromParts, isSamBotAIAvailable } from "./samBotAI.js";
import { consumeAssistantQuota } from "./assistantQuota.js";

const TIME_ZONE = process.env.PERSONAL_REMINDER_TIMEZONE || DEFAULT_TIME_ZONE;
const CURRENCY = process.env.EXPENSE_CURRENCY || "دينار";
const DAY = 86400000;
const HISTORY_MONTHS = 12;
const MAX_ROWS = 5000;
const MAX_LABELS_FOR_AI = 150;

const ASK_COMMANDS = ["حلل مصاريف", "حلل مصاريفي", "تحليل مصاريف", "تحليل مصاريفي", "اسال مصاريف", "اسال عن مصاريفي", "سؤال مصاريف"];
const DEFAULT_ANALYSIS = "حلل مصاريفي هالشهر، ووين صرفت زيادة ووين بقدر أوفر";

const QUESTION_WORDS = /(^|\s)(كم|قديش|قدي|قداش|اديش|مجموع|اجمالي|حلل|تحليل|لخص|لخصلي|ملخص|قارن|مقارنه|معدل|متوسط|اكثر|اعلى|اغلى|وين راحت|وفر|توفير|نصيحه|انصحني|ميزانيه|ميزانيتي)(?=\s|$|[؟?])/;
const MONEY_WORDS = /(صرفت|صرفنا|اصرف|مصروف|مصاريف|مصاري|انفقت|دفعت|فلوس|مصروفي|مصاريفي)/;

function normalize(text) {
  return String(text || "").trim().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ً-ْـ]/g, "").replace(/\s+/g, " ").toLowerCase();
}

function isPrivateChat(jid) {
  return /@(s\.whatsapp\.net|lid)$/.test(String(jid || ""));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function formatAmount(value) {
  return `${Number(round(value).toFixed(3))} ${CURRENCY}`;
}

function rtlLines(lines) {
  return lines.map((line) => (line ? `‏${line}` : line)).join("\n");
}

function dateKey(date) {
  const { year, month, day } = getTimeZoneParts(new Date(date), TIME_ZONE);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function startOfDay(key) {
  const [year, month, day] = key.split("-").map(Number);
  return zonedTimeToUtc(year, month, day, 0, 0, 0, TIME_ZONE);
}

function validKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? value : null;
}

function addDays(key, days) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function monthStartKey(now) {
  const { year, month } = getTimeZoneParts(now, TIME_ZONE);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** سؤال عن المصاريف (مش تسجيل مصروف): فيه كلمة سؤال/تحليل، ومعها كلمة مصاري أو تصنيف صرف عليه المستخدم قبل. */
export function looksLikeExpenseQuestion(text, knownLabels = []) {
  const raw = String(text || "").trim();
  if (!raw || raw.startsWith("/") || raw.length > 400) return false;
  const value = normalize(raw);
  // "صرفت 5 على قهوة" تسجيل مش سؤال
  if (/^(انا\s+|اليوم\s+|هسا\s+)?(صرفت|دفعت|اشتريت)\s/.test(value) && /\d/.test(value)) return false;
  if (!QUESTION_WORDS.test(value)) return false;
  if (MONEY_WORDS.test(value)) return true;
  return knownLabels.some((label) => {
    const key = normalize(label);
    return key.length >= 3 && value.includes(key);
  });
}

export function matchExpenseQuestionCommand(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("/")) return null;
  const value = normalize(raw.slice(1).replace(/_/g, " "));
  const name = ASK_COMMANDS.map(normalize).filter((n) => value === n || value.startsWith(`${n} `)).sort((a, b) => b.length - a.length)[0];
  if (!name) return null;
  const question = raw.slice(1).replace(/_/g, " ").trim().split(/\s+/).slice(name.split(" ").length).join(" ").trim();
  return { question: question || DEFAULT_ANALYSIS };
}

async function loadHistory(sender, now, model) {
  const { year, month } = getTimeZoneParts(now, TIME_ZONE);
  const from = zonedTimeToUtc(year, month - HISTORY_MONTHS + 1, 1, 0, 0, 0, TIME_ZONE);
  return model.find({ userJid: sender, spentAt: { $gte: from } }).sort({ spentAt: -1 }).limit(MAX_ROWS).lean();
}

function labelOf(item) {
  return item.label || "بدون تصنيف";
}

function labelCatalog(items) {
  const map = new Map();
  for (const item of items) {
    const key = labelOf(item);
    const entry = map.get(key) || { label: key, count: 0, total: 0 };
    entry.count += 1;
    entry.total += item.amount;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// ============================================
// الخطوة 1: الذكاء بيحوّل السؤال لاستعلام (فترة + تصنيفات)
// ============================================

function planInstruction(todayKey, weekday) {
  return [
    "You turn a user's question about their own personal expenses into a precise query. The user writes Arabic (usually Jordanian dialect).",
    `Today is ${todayKey} (${weekday}) in ${TIME_ZONE}. Weeks start on Saturday. "هالشهر" = from the 1st of this month to today.`,
    "You get the list of expense labels the user has used (label, count, total). Pick ONLY labels from that list, written exactly as listed.",
    "Pick every label that matches the meaning of the question, including synonyms and spelling variants (e.g. بنزين، بنزينه، وقود، تعبئة سيارة، كاز for fuel). Use an empty list when the question is about all spending.",
    "groupBy: how to break the answer down: none, label, month, week or day.",
    "compare: a second period when the user asks to compare (e.g. this month vs last month), else null.",
    "analysis: true ONLY when the user explicitly asks for analysis, advice, savings, where to cut, a budget opinion or a summary with recommendations. A plain question like \"how much did I spend on X\" is false.",
    "about_expenses: false when the question is not about the user's own spending (e.g. today's fuel price).",
    "Return JSON only: {\"about_expenses\":true,\"from\":\"YYYY-MM-DD\",\"to\":\"YYYY-MM-DD\",\"labels\":[\"بنزين\"],\"groupBy\":\"none\",\"compare\":null,\"analysis\":false}",
    "compare shape when used: {\"from\":\"YYYY-MM-DD\",\"to\":\"YYYY-MM-DD\"}."
  ].join("\n");
}

function parseJson(raw) {
  const source = String(raw || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const match = source.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/** يتحقق من استعلام الذكاء: تواريخ صحيحة، وتصنيفات موجودة فعلًا عند المستخدم. */
export function normalizeQueryPlan(value, { todayKey, knownLabels }) {
  if (!value || typeof value !== "object") return null;
  if (value.about_expenses === false) return { aboutExpenses: false };
  let from = validKey(value.from) || monthStartKey(startOfDay(todayKey));
  let to = validKey(value.to) || todayKey;
  if (to > todayKey) to = todayKey;
  if (from > to) [from, to] = [to, from];
  const known = new Set(knownLabels);
  const labels = Array.isArray(value.labels) ? [...new Set(value.labels.map(String).filter((label) => known.has(label)))] : [];
  const groupBy = ["none", "label", "month", "week", "day"].includes(value.groupBy) ? value.groupBy : "none";
  let compare = null;
  if (value.compare && typeof value.compare === "object") {
    const cFrom = validKey(value.compare.from);
    const cTo = validKey(value.compare.to);
    if (cFrom && cTo) compare = cFrom <= cTo ? { from: cFrom, to: cTo } : { from: cTo, to: cFrom };
  }
  return { aboutExpenses: true, from, to, labels, groupBy, compare, analysis: value.analysis === true };
}

const PERIOD_HINTS = [
  [/(^|\s)اليوم(?=\s|$)/, (today) => ({ from: today, to: today })],
  [/(^|\s)(امبارح|مبارح|امس)(?=\s|$)/, (today) => ({ from: addDays(today, -1), to: addDays(today, -1) })],
  [/الشهر (الماضي|اللي فات|الفائت|السابق)/, (today) => {
    const thisMonth = `${today.slice(0, 7)}-01`;
    const lastDay = addDays(thisMonth, -1);
    return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
  }],
  [/(الاسبوع|هالاسبوع|اسبوع)/, (today) => {
    const [y, m, d] = today.split("-").map(Number);
    const sinceSaturday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1) % 7;
    return { from: addDays(today, -sinceSaturday), to: today };
  }],
  [/(السنه|هالسنه)/, (today) => ({ from: `${today.slice(0, 4)}-01-01`, to: today })]
];

/** بدون ذكاء اصطناعي: فترة من كلمات واضحة، وتصنيفات مذكورة بالسؤال حرفيًا. */
export function fallbackQueryPlan(question, { todayKey, knownLabels }) {
  const value = normalize(question);
  const hint = PERIOD_HINTS.find(([re]) => re.test(value));
  const period = hint ? hint[1](todayKey) : { from: `${todayKey.slice(0, 7)}-01`, to: todayKey };
  const labels = knownLabels.filter((label) => {
    const key = normalize(label);
    return key.length >= 2 && value.includes(key);
  });
  const analysis = /(حلل|تحليل|وفر|توفير|نصيحه|انصحني|ميزانيه)/.test(value);
  return { aboutExpenses: true, ...period, labels, groupBy: labels.length > 1 || (!labels.length && analysis) ? "label" : "none", compare: null, analysis };
}

// ============================================
// الحساب من الداتا
// ============================================

function inRange(item, from, to) {
  const key = dateKey(item.spentAt);
  return key >= from && key <= to;
}

function bucketKey(item, groupBy) {
  if (groupBy === "label") return labelOf(item);
  const key = dateKey(item.spentAt);
  if (groupBy === "month") return key.slice(0, 7);
  if (groupBy === "day") return key;
  if (groupBy === "week") {
    const [y, m, d] = key.split("-").map(Number);
    const sinceSaturday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1) % 7;
    return `أسبوع ${addDays(key, -sinceSaturday)}`;
  }
  return null;
}

function summarize(items, { from, to, labels, groupBy }) {
  const selected = items.filter((item) => inRange(item, from, to) && (!labels.length || labels.includes(labelOf(item))));
  const total = selected.reduce((sum, item) => sum + item.amount, 0);
  const groups = new Map();
  if (groupBy !== "none") {
    for (const item of selected) {
      const key = bucketKey(item, groupBy);
      const entry = groups.get(key) || { key, total: 0, count: 0 };
      entry.total += item.amount;
      entry.count += 1;
      groups.set(key, entry);
    }
  }
  const days = Math.max(1, Math.round((startOfDay(to) - startOfDay(from)) / DAY) + 1);
  return {
    from,
    to,
    labels,
    total: round(total),
    count: selected.length,
    dailyAverage: round(total / days),
    groups: [...groups.values()].map((g) => ({ ...g, total: round(g.total) })).sort((a, b) => (groupBy === "label" ? b.total - a.total : a.key.localeCompare(b.key))).slice(0, 40),
    biggest: [...selected].sort((a, b) => b.amount - a.amount).slice(0, 8).map((item) => ({ date: dateKey(item.spentAt), label: labelOf(item), amount: round(item.amount) })),
    selected
  };
}

/** الأرقام اللي بتنبعت للذكاء: كلها محسوبة بالكود. */
export function computeExpenseAnswer(items, plan) {
  const main = summarize(items, plan);
  const result = { period: { from: main.from, to: main.to }, labels: main.labels, total: main.total, count: main.count, dailyAverage: main.dailyAverage, breakdown: main.groups, biggest: main.biggest };
  if (plan.compare) {
    const other = summarize(items, { ...plan.compare, labels: plan.labels, groupBy: "none" });
    result.compare = { period: plan.compare, total: other.total, count: other.count, difference: round(main.total - other.total) };
  }
  if (plan.analysis) {
    // للتحليل: توزيع الفترة حسب التصنيف، ونفس طول الفترة اللي قبلها للمقارنة
    result.byLabel = summarize(items, { ...plan, labels: [], groupBy: "label" }).groups;
    const length = Math.round((startOfDay(plan.to) - startOfDay(plan.from)) / DAY) + 1;
    const previous = summarize(items, { from: addDays(plan.from, -length), to: addDays(plan.from, -1), labels: [], groupBy: "label" });
    result.previousPeriod = { from: previous.from, to: previous.to, total: previous.total, byLabel: previous.groups.slice(0, 15) };
    // مصاريف متكررة (قهوة، دخان، توصيل...) هي أكثر مكان بينفع فيه التوفير
    const counts = new Map();
    for (const item of main.selected) {
      const key = labelOf(item);
      const entry = counts.get(key) || { label: key, count: 0, total: 0 };
      entry.count += 1;
      entry.total += item.amount;
      counts.set(key, entry);
    }
    result.frequent = [...counts.values()].filter((e) => e.count >= 3).sort((a, b) => b.count - a.count).slice(0, 8).map((e) => ({ ...e, total: round(e.total) }));
  }
  return result;
}

// ============================================
// الخطوة 2: صياغة الجواب
// ============================================

function answerInstruction(analysis) {
  const base = [
    "You are Sam, a personal assistant on WhatsApp. Reply in Jordanian Arabic, short and clear, like a friend who is good with money.",
    `Amounts are in ${CURRENCY}. Use ONLY the numbers in the data. Never invent, recompute or round them differently.`,
    "Answer exactly what the user asked. If they asked about one category, talk about that category only, not their whole spending.",
    "If the total is 0 or count is 0, say you found no expenses for that in that period, and mention the label names you searched.",
    "Plain WhatsApp text, *bold* allowed, no markdown headers or tables. Start each line with text, not a number."
  ];
  if (!analysis) {
    base.push("Do NOT give financial advice or saving tips unless the user asked for them. Keep it to 2-5 lines.");
  } else {
    base.push(
      "The user asked for analysis. Act as a practical financial analyst:",
      "1) summarize where the money went (biggest categories with amounts and share),",
      "2) compare with the previous period where useful,",
      "3) point out spending that looks unnecessary or easy to cut (frequent small purchases, subscriptions, delivery, etc.) with a concrete monthly saving estimate based on the data,",
      "4) suggest cheaper alternatives or what the saved money could go to.",
      "Be honest and specific to the data, kind, not preachy. Up to about 15 lines."
    );
  }
  return base.join("\n");
}

function fallbackAnswer(question, plan, data) {
  const what = plan.labels.length ? `على ${plan.labels.join("، ")}` : "";
  const period = plan.from === plan.to ? plan.from : `من ${plan.from} لـ ${plan.to}`;
  if (!data.count) return rtlLines([`📭 ما لقيت مصاريف ${what} ${period}.`.replace(/\s+/g, " ")]);
  const lines = [`💰 صرفت ${what} ${period}: *${formatAmount(data.total)}* (${data.count} مصروف)`.replace(/\s+/g, " ")];
  if (data.compare) lines.push(`وبالفترة اللي قارنت فيها: ${formatAmount(data.compare.total)} (الفرق ${formatAmount(data.compare.difference)})`);
  for (const group of data.breakdown.slice(0, 10)) lines.push(`▪️ ${group.key}: ${formatAmount(group.total)}`);
  return rtlLines(lines);
}

/**
 * يجاوب سؤال عن المصاريف. يرجع { handled, text }؛ handled=false إذا السؤال مش عن مصاريف المستخدم.
 */
export async function answerExpenseQuestion(question, sender, {
  now = new Date(),
  model = Expense,
  ai = generateSamBotAIFromParts,
  aiAvailable = isSamBotAIAvailable,
  quota = consumeAssistantQuota
} = {}) {
  const items = await loadHistory(sender, now, model);
  const catalog = labelCatalog(items);
  const knownLabels = catalog.map((entry) => entry.label);
  const todayKey = dateKey(now);
  const weekday = now.toLocaleDateString("en-US", { timeZone: TIME_ZONE, weekday: "long" });

  let useAI = aiAvailable();
  if (useAI) useAI = (await quota(sender).catch(() => ({ allowed: false }))).allowed;

  let plan = null;
  if (useAI) {
    try {
      const raw = await ai({
        systemInstruction: planInstruction(todayKey, weekday),
        parts: [{ text: JSON.stringify({ question: String(question).slice(0, 500), labels: catalog.slice(0, MAX_LABELS_FOR_AI).map((e) => [e.label, e.count, round(e.total)]) }) }],
        json: true,
        temperature: 0,
        maxOutputTokens: 400
      });
      plan = normalizeQueryPlan(parseJson(raw), { todayKey, knownLabels });
    } catch (error) {
      console.warn("Expense question planning failed:", error.message);
    }
  }
  if (!plan) plan = fallbackQueryPlan(question, { todayKey, knownLabels });
  if (!plan.aboutExpenses) return { handled: false };

  const data = computeExpenseAnswer(items, plan);
  if (useAI) {
    try {
      const text = await ai({
        systemInstruction: answerInstruction(plan.analysis),
        parts: [{ text: `سؤال المستخدم: ${String(question).slice(0, 500)}\n\nالبيانات (محسوبة من سجل مصاريفه):\n${JSON.stringify(data)}` }],
        temperature: plan.analysis ? 0.4 : 0.2,
        maxOutputTokens: plan.analysis ? 1200 : 400
      });
      const clean = String(text || "").trim();
      if (clean) return { handled: true, text: rtlLines(clean.split("\n")), plan, data };
    } catch (error) {
      console.warn("Expense answer failed:", error.message);
    }
  }
  return { handled: true, text: fallbackAnswer(question, plan, data), plan, data };
}

/** /حلل_مصاريف <سؤال> (بالقروب الجواب بيروح عالخاص). */
export async function handleExpenseQuestionCommand(sock, jid, sender, text, options = {}) {
  const matched = matchExpenseQuestionCommand(text);
  if (!matched) return false;
  const target = isPrivateChat(jid) ? jid : sender;
  try {
    const result = await answerExpenseQuestion(matched.question, sender, options);
    await sock.sendMessage(target, { text: result.handled ? result.text : "🤔 هاد السؤال مش عن مصاريفك. جرب: /حلل_مصاريف قديش صرفت على البنزين هالشهر" });
    if (target !== jid) await sock.sendMessage(jid, { text: "📩 بعتلك على الخاص." });
  } catch (error) {
    console.error("Expense question failed:", error.message);
    await sock.sendMessage(jid, { text: "❌ صار خطأ، جرب مرة ثانية." });
  }
  return true;
}

/** سؤال طبيعي بالخاص: "كم مجموع البنزين هالشهر؟" */
export async function handleNaturalExpenseQuestion(sock, jid, sender, text, options = {}) {
  if (!isPrivateChat(jid)) return false;
  const model = options.model || Expense;
  const value = normalize(text);
  if (!QUESTION_WORDS.test(value)) return false;
  let labels = [];
  if (!MONEY_WORDS.test(value)) {
    const rows = await model.find({ userJid: sender }).sort({ spentAt: -1 }).limit(500).lean().catch(() => []);
    labels = [...new Set(rows.map((row) => row.label).filter(Boolean))];
  }
  if (!looksLikeExpenseQuestion(text, labels)) return false;
  try {
    const result = await answerExpenseQuestion(text, sender, options);
    if (!result.handled) return false;
    await sock.sendMessage(jid, { text: result.text });
    return true;
  } catch (error) {
    console.error("Natural expense question failed:", error.message);
    return false;
  }
}
