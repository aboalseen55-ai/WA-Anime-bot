// تسجيل المصاريف الشخصية بالخاص: /مصروف 5 قهوة، /مصاريفي، /حذف_مصروف، أو كلام طبيعي "صرفت 5 دنانير على قهوة"
import Expense from "../database/expenseModel.js";
import { DEFAULT_TIME_ZONE, getTimeZoneParts, zonedTimeToUtc } from "./quran.js";

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

/** "5 دنانير على قهوة" -> { amount: 5, label: "قهوة" } أو null إذا ما في رقم. */
export function parseExpense(input) {
  const text = toLatinDigits(input).trim();
  const match = text.match(/(\d+(?:[.,]\d{1,3})?)/);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;
  const label = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length))
    .replace(CURRENCY_WORDS, " ")
    .replace(/(?:^|\s)(?:على|عَ|ع|ب|في|حق|ثمن|سعر|مصروف)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return { amount: Math.round(amount * 1000) / 1000, label };
}

/** كلام طبيعي بالخاص: "صرفت 5 على قهوة"، "دفعت فاتورة الكهربا 30". */
export function matchNaturalExpense(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.startsWith("/") || trimmed.length > 200) return null;
  const match = trimmed.match(/^(?:انا\s+|أنا\s+|اليوم\s+|هسا\s+)?(?:صرفت|دفعت)\s+(.+)$/);
  if (!match) return null;
  return parseExpense(match[1]);
}

function formatAmount(value) {
  return `${Number(value.toFixed(3))} ${CURRENCY}`;
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

async function addExpense(sock, jid, sender, parsed, now) {
  await Expense.create({ userJid: sender, amount: parsed.amount, label: parsed.label, spentAt: now });
  const { start } = periodStart("month", now);
  const totals = await Expense.aggregate([
    { $match: { userJid: sender, spentAt: { $gte: start } } },
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]).catch(() => []);
  const monthTotal = totals[0]?.total;
  const lines = [`💸 سجلت مصروف: ${formatAmount(parsed.amount)}${parsed.label ? ` على ${parsed.label}` : ""}`];
  if (monthTotal) lines.push(`📊 مجموع هالشهر: ${formatAmount(monthTotal)}`);
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
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const byLabel = new Map();
  for (const item of items) {
    const key = item.label || "بدون تصنيف";
    byLabel.set(key, (byLabel.get(key) || 0) + item.amount);
  }
  const top = [...byLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const recent = items.slice(0, LIST_LIMIT).map((item, index) => {
    const date = item.spentAt.toLocaleDateString("ar-JO", { timeZone: TIME_ZONE, day: "numeric", month: "numeric" });
    return `${index + 1}. ${formatAmount(item.amount)}${item.label ? ` · ${item.label}` : ""} (${date})`;
  });
  const lines = [
    `💰 *مصاريفك ${title}*`,
    `المجموع: *${formatAmount(total)}* (${items.length} مصروف)`,
    "",
    "*أكثر اشي صرفت عليه:*",
    ...top.map(([label, sum]) => `▪️ ${label}: ${formatAmount(sum)}`),
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
  await sock.sendMessage(jid, { text: `🗑️ حذفت: ${formatAmount(item.amount)}${item.label ? ` · ${item.label}` : ""}` });
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
export async function handleExpenseCommand(sock, jid, sender, text, { now = new Date() } = {}) {
  const matched = matchCommand(text);
  if (!matched) return false;
  const target = isPrivateChat(jid) ? jid : sender;
  try {
    if (matched.action === "list") await listExpenses(sock, target, sender, matched.args, now);
    else if (matched.action === "delete") await deleteExpense(sock, target, sender, matched.args, now);
    else {
      const parsed = parseExpense(matched.args);
      if (!parsed) {
        await sock.sendMessage(target, { text: "✍️ اكتب المبلغ وعلى شو صرفت.\nمثال: /مصروف 5 قهوة\nأو: /مصروف 30 فاتورة كهربا" });
      } else {
        await addExpense(sock, target, sender, parsed, now);
      }
    }
    if (target !== jid) await sock.sendMessage(jid, { text: "📩 بعتلك على الخاص." });
  } catch (error) {
    console.error("Expense command failed:", error.message);
    await sock.sendMessage(jid, { text: "❌ صار خطأ، جرب مرة ثانية." });
  }
  return true;
}

/** "صرفت 5 على قهوة" بالخاص بتنسجل مصروف مباشرة بدون ذكاء اصطناعي. */
export async function handleNaturalExpense(sock, jid, sender, text, { now = new Date() } = {}) {
  if (!isPrivateChat(jid)) return false;
  const parsed = matchNaturalExpense(text);
  if (!parsed) return false;
  try {
    await addExpense(sock, jid, sender, parsed, now);
  } catch (error) {
    console.error("Natural expense failed:", error.message);
    return false;
  }
  return true;
}
