// تسجيل المصاريف الشخصية بالخاص: /مصروف 5 قهوة، /مصاريفي، /حذف_مصروف، أو كلام طبيعي "صرفت 5 دنانير على قهوة"
import Expense from "../database/expenseModel.js";
import { DEFAULT_TIME_ZONE, getTimeZoneParts, zonedTimeToUtc } from "./quran.js";
import { generateSamBotAIFromParts, isSamBotAIAvailable } from "./samBotAI.js";
import { consumeAssistantQuota } from "./assistantQuota.js";
import { getRateToJOD } from "../services/exchangeRates.js";

const TIME_ZONE = process.env.PERSONAL_REMINDER_TIMEZONE || DEFAULT_TIME_ZONE;
const CURRENCY = process.env.EXPENSE_CURRENCY || "دينار";
const MAX_AMOUNT = 1_000_000;
const LIST_LIMIT = 10;

const ADD_COMMANDS = ["مصروف", "صرفت", "دفعت", "اضف مصروف"];
const LIST_COMMANDS = ["مصاريفي", "مصروفي", "مصاريف"];
const DELETE_COMMANDS = ["حذف مصروف", "الغاء مصروف"];

const CURRENCY_WORDS = /(?:^|\s)(?:دنانير|دينار|دينارين|ليرات|ليره|ليرة|jd|jod|قرش|قروش|شيكل|دولار|ريال|درهم)(?=\s|$)/gi;

function isPrivateChat(jid) {
  return /@(s\.whatsapp\.net|lid)$/.test(String(jid || ""));
}

function normalizeName(text) {
  return String(text || "").trim().replace(/_/g, " ").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").toLowerCase();
}

function toLatinDigits(text) {
  return String(text || "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".");
}

const VERBS = /^(?:انا\s+|أنا\s+|اليوم\s+|هسا\s+)?(?:صرفت|دفعت|اشتريت|(?:سجل|سجلي|سجللي|حط|ضيف)\s+(?:لي\s+)?(?:مصروف|مصاريف))\s*/;

// "/مصروف 20$ كلود /مصروف 22.5 نت" -> فاصل بين مصروفين
function splitInnerCommands(text) {
  return String(text || "").replace(/\s*\/(?:مصروف|صرفت|دفعت)\s*/g, " و ").replace(/^\s*و\s+/, "").trim();
}

function countAmounts(text) {
  return (toLatinDigits(text).match(/\d+(?:[.,]\d{1,3})?/g) || []).length;
}

function detectCurrency(text) {
  if (/\$|دولار|usd/i.test(text)) return "دولار";
  if (/€|يورو|eur/i.test(text)) return "يورو";
  return null;
}

/** مبلغ واحد: "5 دنانير على قهوة" -> { amount: 5, label: "قهوة", currency: null } أو null إذا ما في رقم. */
function parseOne(input) {
  const text = toLatinDigits(input).trim().replace(VERBS, "");
  const match = text.match(/(\d+(?:[.,]\d{1,3})?)/);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;
  const label = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length))
    .replace(/[$€]/g, " ")
    .replace(/(?:^|\s)(?:usd|eur|يورو)(?=\s|$)/gi, " ")
    .replace(CURRENCY_WORDS, " ")
    .replace(/(?:^|\s)(?:على|عَ|ع|ب|في|حق|ثمن|سعر|مصروف)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return { amount: Math.round(amount * 1000) / 1000, label, currency: detectCurrency(text) };
}

/**
 * رسالة فيها أكثر من مبلغ: "5 ستيم و 20$ كلود ودفعت النت 22.5" -> ثلاث مصاريف.
 * بنقسم عند " و" وبنضم الأجزاء اللي ما فيها رقم للجزء اللي بعدها ("ستيم وكلود 25" = مصروف واحد).
 */
export function parseExpenses(input) {
  const text = splitInnerCommands(toLatinDigits(input));
  const cuts = [0];
  for (const match of text.matchAll(/\s+(?=و)/g)) cuts.push(match.index);
  cuts.push(text.length);
  const segments = [];
  let pending = "";
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const part = pending + text.slice(cuts[i], cuts[i + 1]);
    if (/\d/.test(part)) {
      segments.push(part);
      pending = "";
    } else {
      pending = part;
    }
  }
  if (pending && segments.length) segments[segments.length - 1] += pending;

  return segments
    .map((segment, index) => {
      let value = segment.trim();
      // "و" هنا رابط بين مصروفين (و 20، و$20، ودفعت) مش أول حرف من كلمة مثل "وجبة"
      if (index > 0) value = value.replace(/^و(?=\s|\d|\$|صرفت|دفعت|اشتريت)\s*/, "");
      return parseOne(value);
    })
    .filter(Boolean);
}

/** أول مصروف بالنص (للتوافق). */
export function parseExpense(input) {
  return parseExpenses(input)[0] || null;
}

/** كلام طبيعي بالخاص: "صرفت 5 على قهوة"، "دفعت فاتورة الكهربا 30" (التقسيم بالكود بدون ذكاء اصطناعي). */
export function matchNaturalExpense(text) {
  if (!looksLikeSpending(text)) return null;
  const items = parseExpenses(text);
  return items.length ? items : null;
}

/** رسالة بتبلش بـ صرفت/دفعت/اشتريت. */
export function looksLikeSpending(text) {
  const trimmed = String(text || "").trim();
  return !trimmed.startsWith("/") && trimmed.length <= 300 && VERBS.test(trimmed);
}

function formatAmount(value, currency = null) {
  return `${Number(Number(value).toFixed(3))} ${currency || CURRENCY}`;
}

/** {دينار: 35, دولار: 20} -> "35 دينار + 20 دولار" */
function formatTotals(items) {
  const totals = new Map();
  for (const item of items) {
    const key = item.currency || CURRENCY;
    totals.set(key, (totals.get(key) || 0) + item.amount);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => (a === CURRENCY ? -1 : b === CURRENCY ? 1 : 0))
    .map(([currency, sum]) => formatAmount(sum, currency)).join(" + ");
}

// ============================================
// الذكاء الاصطناعي بيفصّل الرسالة لمصاريف، والكود بيتحقق منها وبيحفظها
// ============================================

const CURRENCY_CODES = { JOD: null, JD: null, USD: "دولار", EUR: "يورو", SAR: "ريال", AED: "درهم", ILS: "شيكل", EGP: "جنيه", GBP: "جنيه استرليني" };

function aiInstruction() {
  return [
    "Extract personal expenses from a short WhatsApp message written in Arabic (usually Jordanian dialect).",
    "Every separate amount is a separate item, even when joined with و. Items that share one amount (\"ستيم وكلود 25\") are one item.",
    "Write numbers that appear as words as digits (خمسة -> 5, ربع دينار -> 0.25, نص دينار -> 0.5).",
    "currency: ISO code. $ or دولار = USD, € or يورو = EUR; دينار, JD, ليرة or no currency = JOD.",
    "label: a short Arabic description of what was bought or paid, without the amount, the currency or verbs like صرفت/دفعت/اشتريت. Keep names like لسيدرا.",
    "If the message does not report money that was spent, return an empty list.",
    "Return JSON only: {\"items\":[{\"amount\":5,\"currency\":\"JOD\",\"label\":\"قهوة\"}]}"
  ].join("\n");
}

/** يرجع مصفوفة مصاريف من رد الذكاء الاصطناعي، أو null إذا الرد مش صالح. */
export function parseAIExpenses(raw) {
  const source = String(raw || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const match = source.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let data;
  try {
    data = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(data?.items)) return null;
  return data.items
    .map((item) => {
      const amount = Number(item?.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;
      const code = String(item?.currency || "JOD").toUpperCase().trim();
      const currency = code in CURRENCY_CODES ? CURRENCY_CODES[code] : code.slice(0, 12);
      const label = String(item?.label || "").replace(/\s+/g, " ").trim().slice(0, 80);
      return { amount: Math.round(amount * 1000) / 1000, label, currency };
    })
    .filter(Boolean);
}

/**
 * يفصّل الرسالة لمصاريف: أولًا بالذكاء الاصطناعي (بيفهم الأرقام بالكلمات والجمل المعقدة)،
 * وإذا مش متاح أو فشل، بالتقسيم العادي بالكود.
 */
export async function extractExpenses(text, sender, { ai = generateSamBotAIFromParts, aiAvailable = isSamBotAIAvailable, quota = consumeAssistantQuota } = {}) {
  if (aiAvailable()) {
    const allowed = sender ? (await quota(sender).catch(() => ({ allowed: false }))).allowed : true;
    if (allowed) {
      try {
        const raw = await ai({ systemInstruction: aiInstruction(), parts: [{ text: String(text).slice(0, 500) }], json: true, temperature: 0, maxOutputTokens: 400 });
        const items = parseAIExpenses(raw);
        if (items) return { items, source: "ai" };
      } catch (error) {
        console.warn("Expense AI parsing failed:", error.message);
      }
    }
  }
  return { items: parseExpenses(text), source: "code" };
}

function periodStart(period, now) {
  const { year, month, day } = getTimeZoneParts(now, TIME_ZONE);
  const startOfToday = zonedTimeToUtc(year, month, day, 0, 0, 0, TIME_ZONE);
  if (period === "today") return { start: startOfToday, title: "اليوم" };
  if (period === "week") {
    // الأسبوع من السبت
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = الأحد
    const sinceSaturday = (weekday + 1) % 7;
    return { start: new Date(startOfToday.getTime() - sinceSaturday * 86400000), title: "هالأسبوع" };
  }
  return { start: zonedTimeToUtc(year, month, 1, 0, 0, 0, TIME_ZONE), title: "هالشهر" };
}

function parsePeriod(args) {
  const value = normalizeName(args);
  if (/^(اليوم|today)/.test(value)) return "today";
  if (/^(الاسبوع|اسبوع|هالاسبوع|week)/.test(value)) return "week";
  return "month";
}

const NAME_TO_CODE = { "دولار": "USD", "يورو": "EUR", "ريال": "SAR", "درهم": "AED", "شيكل": "ILS", "جنيه": "EGP", "جنيه استرليني": "GBP" };

/** أي عملة غير الدينار بتتحول لدينار بسعر الصرف، وبينحفظ المبلغ الأصلي جنبه. */
export async function convertToJOD(item, rateOptions) {
  if (!item.currency || process.env.EXPENSE_CONVERT === "false" || CURRENCY !== "دينار") return item;
  const code = NAME_TO_CODE[item.currency] || (/^[A-Z]{3}$/.test(item.currency) ? item.currency : null);
  const found = code ? await getRateToJOD(code, rateOptions).catch(() => null) : null;
  if (!found) return item;
  return {
    ...item,
    amount: Math.round(item.amount * found.rate * 1000) / 1000,
    currency: null,
    originalAmount: item.amount,
    originalCurrency: item.currency
  };
}

/** تحويل المصاريف القديمة اللي انحفظت بعملة ثانية قبل ما يصير التحويل تلقائي. آمنة لو اشتغلت أكثر من مرة. */
export async function migrateForeignExpenses({ model = Expense, rateOptions } = {}) {
  if (process.env.EXPENSE_CONVERT === "false" || CURRENCY !== "دينار") return { converted: 0, skipped: 0 };
  const docs = await model.find({ currency: { $ne: null }, originalAmount: null }).lean();
  let converted = 0;
  let skipped = 0;
  for (const doc of docs) {
    const item = await convertToJOD({ amount: doc.amount, currency: doc.currency }, rateOptions);
    if (item.currency) { skipped += 1; continue; }
    await model.updateOne({ _id: doc._id, originalAmount: null }, {
      $set: { amount: item.amount, currency: null, originalAmount: item.originalAmount, originalCurrency: item.originalCurrency }
    });
    converted += 1;
  }
  if (converted || skipped) console.log(`💱 Converted ${converted} old expenses to JOD (${skipped} skipped)`);
  return { converted, skipped };
}

function describeItem(item) {
  const original = item.originalAmount ? ` (${formatAmount(item.originalAmount, item.originalCurrency)})` : "";
  return `${formatAmount(item.amount, item.currency)}${original}`;
}

async function addExpenses(sock, jid, sender, rawItems, now, rateOptions) {
  const items = [];
  for (const raw of rawItems) items.push(await convertToJOD(raw, rateOptions));
  for (const item of items) {
    await Expense.create({
      userJid: sender,
      amount: item.amount,
      label: item.label,
      currency: item.currency || null,
      originalAmount: item.originalAmount ?? null,
      originalCurrency: item.originalCurrency ?? null,
      spentAt: now
    });
  }
  const { start } = periodStart("month", now);
  const monthItems = await Expense.find({ userJid: sender, spentAt: { $gte: start } }).lean().catch(() => []);
  const describe = (item) => `${describeItem(item)}${item.label ? ` على ${item.label}` : ""}`;
  const lines = items.length === 1
    ? [`💸 سجلت مصروف: ${describe(items[0])}`]
    : [`💸 سجلت ${items.length} مصاريف:`, ...items.map((item) => `▪️ ${describe(item)}`)];
  if (monthItems.length) lines.push(`📊 مجموع هالشهر: ${formatTotals(monthItems)}`);
  lines.push("لعرض مصاريفك: /مصاريفي (أو /مصاريفي اليوم، /مصاريفي الاسبوع)");
  await sock.sendMessage(jid, { text: lines.join("\n") });
}

async function listExpenses(sock, jid, sender, args, now) {
  const { start, title } = periodStart(parsePeriod(args), now);
  const items = await Expense.find({ userJid: sender, spentAt: { $gte: start } }).sort({ spentAt: -1 }).lean();
  if (!items.length) {
    await sock.sendMessage(jid, { text: `📭 ما في مصاريف مسجلة ${title}.\nللتسجيل: /مصروف 5 قهوة\nأو احكيلي: صرفت 5 دنانير على قهوة` });
    return;
  }
  const byLabel = new Map();
  for (const item of items) {
    const currency = item.currency || CURRENCY;
    const key = `${item.label || "بدون تصنيف"}\u0000${currency}`;
    byLabel.set(key, (byLabel.get(key) || 0) + item.amount);
  }
  const top = [...byLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([key, sum]) => { const [label, currency] = key.split("\u0000"); return [label, formatAmount(sum, currency)]; });
  const recent = items.slice(0, LIST_LIMIT).map((item, index) => {
    const date = item.spentAt.toLocaleDateString("ar-JO", { timeZone: TIME_ZONE, day: "numeric", month: "numeric" });
    return `${index + 1}. ${describeItem(item)}${item.label ? ` · ${item.label}` : ""} (${date})`;
  });
  const lines = [
    `💰 *مصاريفك ${title}*`,
    `المجموع: *${formatTotals(items)}* (${items.length} مصروف)`,
    "",
    "*أكثر اشي صرفت عليه:*",
    ...top.map(([label, amount]) => `▪️ ${label}: ${amount}`),
    "",
    "*آخر المصاريف:*",
    ...recent,
    "",
    "للحذف: /حذف_مصروف <رقم من القائمة>"
  ];
  await sock.sendMessage(jid, { text: lines.join("\n") });
}

async function deleteExpense(sock, jid, sender, args, now) {
  const index = Number(toLatinDigits(args).match(/\d+/)?.[0] || 1);
  const { start } = periodStart("month", now);
  const items = await Expense.find({ userJid: sender, spentAt: { $gte: start } }).sort({ spentAt: -1 }).limit(LIST_LIMIT).lean();
  const item = items[index - 1];
  if (!item) {
    await sock.sendMessage(jid, { text: "❌ ما لقيت هالمصروف. شوف الأرقام بـ /مصاريفي" });
    return;
  }
  await Expense.deleteOne({ _id: item._id, userJid: sender });
  await sock.sendMessage(jid, { text: `🗑️ حذفت: ${describeItem(item)}${item.label ? ` · ${item.label}` : ""}` });
}

function matchCommand(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("/")) return null;
  const normalized = normalizeName(trimmed.slice(1));
  const find = (names) => names.map(normalizeName).filter((n) => normalized === n || normalized.startsWith(`${n} `)).sort((a, b) => b.length - a.length)[0];
  for (const [action, names] of [["delete", DELETE_COMMANDS], ["list", LIST_COMMANDS], ["add", ADD_COMMANDS]]) {
    const name = find(names);
    if (name) {
      const args = trimmed.slice(1).replace(/_/g, " ").trim().split(/\s+/).slice(name.split(" ").length).join(" ");
      return { action, args };
    }
  }
  return null;
}

export function isExpenseCommand(text) {
  return Boolean(matchCommand(text));
}

/** أوامر المصاريف. بالقروب بتنرد بالخاص حتى تضل مصاريفك إلك. */
export async function handleExpenseCommand(sock, jid, sender, text, { now = new Date(), extractOptions, rateOptions } = {}) {
  const matched = matchCommand(text);
  if (!matched) return false;
  const target = isPrivateChat(jid) ? jid : sender;
  try {
    if (matched.action === "list") await listExpenses(sock, target, sender, matched.args, now);
    else if (matched.action === "delete") await deleteExpense(sock, target, sender, matched.args, now);
    else {
      // مبلغ واحد بسيط بينحفظ مباشرة، وأي اشي أعقد (أكثر من مبلغ، أرقام بالكلام) بيروح للذكاء الاصطناعي
      const args = splitInnerCommands(matched.args);
      const simple = countAmounts(args) === 1 && !/\s+و/.test(args);
      const { items: parsed } = simple
        ? { items: parseExpenses(args) }
        : await extractExpenses(args, sender, extractOptions);
      if (!parsed.length) {
        await sock.sendMessage(target, { text: "✍️ اكتب المبلغ وعلى شو صرفت.\nمثال: /مصروف 5 قهوة\nأو: /مصروف 30 فاتورة كهربا" });
      } else {
        await addExpenses(sock, target, sender, parsed, now, rateOptions);
      }
    }
    if (target !== jid) await sock.sendMessage(jid, { text: "📩 بعتلك على الخاص." });
  } catch (error) {
    console.error("Expense command failed:", error.message);
    await sock.sendMessage(jid, { text: "❌ صار خطأ، جرب مرة ثانية." });
  }
  return true;
}

/** "صرفت 5 على قهوة" بالخاص بتنسجل مصروف (أو أكثر) مباشرة. */
export async function handleNaturalExpense(sock, jid, sender, text, { now = new Date(), extractOptions, rateOptions } = {}) {
  if (!isPrivateChat(jid) || !looksLikeSpending(text)) return false;
  try {
    const { items } = await extractExpenses(text, sender, extractOptions);
    if (!items.length) return false;
    await addExpenses(sock, jid, sender, items, now, rateOptions);
  } catch (error) {
    console.error("Natural expense failed:", error.message);
    return false;
  }
  return true;
}
