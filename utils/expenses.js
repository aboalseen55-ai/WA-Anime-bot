// تسجيل المصاريف الشخصية بالخاص: /مصروف 5 قهوة، /مصاريفي، /حذف_مصروف، أو كلام طبيعي "صرفت 5 دنانير على قهوة"
import ExcelJS from "exceljs";
import Expense from "../database/expenseModel.js";
import { DEFAULT_TIME_ZONE, getTimeZoneParts, zonedTimeToUtc } from "./quran.js";
import { generateSamBotAIFromParts, isSamBotAIAvailable } from "./samBotAI.js";
import { consumeAssistantQuota } from "./assistantQuota.js";
import { getRateToJOD } from "../services/exchangeRates.js";
import { monthTitle, parseMonthArg } from "./expensePeriods.js";
import { IMPORTANCE, IMPORTANCE_ORDER, addChartsToWorkbook, analyzeExpensesForExport, labelTotals, sheetRef } from "./expenseExportInsights.js";

const TIME_ZONE = process.env.PERSONAL_REMINDER_TIMEZONE || DEFAULT_TIME_ZONE;
const CURRENCY = process.env.EXPENSE_CURRENCY || "دينار";
const MAX_AMOUNT = 1_000_000;
const LIST_LIMIT = 10;

const ADD_COMMANDS = ["مصروف", "صرفت", "دفعت", "اضف مصروف"];
const LIST_COMMANDS = ["مصاريفي", "مصروفي", "مصاريف"];
const DELETE_COMMANDS = ["حذف مصروف", "الغاء مصروف"];
const EXPORT_COMMANDS = ["تصدير مصاريف", "تصدير مصروف", "مصاريف اكسل", "اكسل مصاريف", "اكسل"];

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
  if (period && typeof period === "object") {
    // شهر محدد: من أول الشهر لأول الشهر اللي بعده
    const start = zonedTimeToUtc(period.year, period.month, 1, 0, 0, 0, TIME_ZONE);
    const end = zonedTimeToUtc(period.year, period.month + 1, 1, 0, 0, 0, TIME_ZONE);
    const current = period.year === year && period.month === month;
    return { start, end, title: current ? "هالشهر" : `بشهر ${monthTitle(period)}`, month: period };
  }
  if (period === "today") return { start: startOfToday, title: "اليوم" };
  if (period === "yesterday") return { start: new Date(startOfToday.getTime() - 86400000), end: startOfToday, title: "امبارح" };
  if (period === "all") return { start: new Date(0), title: "من الأول" };
  if (period === "week") {
    // الأسبوع من السبت
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = الأحد
    const sinceSaturday = (weekday + 1) % 7;
    return { start: new Date(startOfToday.getTime() - sinceSaturday * 86400000), title: "هالأسبوع" };
  }
  return { start: zonedTimeToUtc(year, month, 1, 0, 0, 0, TIME_ZONE), title: "هالشهر" };
}

function spentAtQuery(range) {
  return range.end ? { $gte: range.start, $lt: range.end } : { $gte: range.start };
}

/** اليوم، امبارح، الاسبوع، الكل، أو شهر معين (شهر 10، الشهر الماضي، تشرين الاول، 10/2025). الافتراضي هالشهر. */
function parsePeriod(args, now = new Date()) {
  const value = normalizeName(toLatinDigits(args));
  if (!value) return "month";
  if (/^(اليوم|today)/.test(value)) return "today";
  if (/^(امبارح|مبارح|امس|yesterday)/.test(value)) return "yesterday";
  if (/^(الاسبوع|اسبوع|هالاسبوع|week)/.test(value)) return "week";
  if (/^(الكل|كل|all)/.test(value)) return "all";
  const { year, month } = getTimeZoneParts(now, TIME_ZONE);
  return parseMonthArg(value, { year, month }) || "month";
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

// واتساب بيقرر اتجاه السطر من أول حرف، فالسطر اللي بيبلش برقم بيطلع من اليسار.
// علامة RLM بأول كل سطر بتخليه من اليمين لليسار.
function rtlLines(lines) {
  return lines.map((line) => (line ? `\u200F${line}` : line)).join("\n");
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
  lines.push("لعرض مصاريفك: /مصاريفي (أو /مصاريفي اليوم، /مصاريفي الاسبوع، /مصاريفي الشهر الماضي)");
  await sock.sendMessage(jid, { text: rtlLines(lines) });
}

async function listExpenses(sock, jid, sender, args, now) {
  const range = periodStart(parsePeriod(args, now), now);
  const { title } = range;
  const items = await Expense.find({ userJid: sender, spentAt: spentAtQuery(range) }).sort({ spentAt: -1 }).lean();
  if (!items.length) {
    await sock.sendMessage(jid, { text: `📭 ما في مصاريف مسجلة ${title}.\nللتسجيل: /مصروف 5 قهوة\nأو احكيلي: صرفت 5 دنانير على قهوة\nلشهر سابق: /مصاريفي الشهر الماضي أو /مصاريفي شهر 10` });
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
    `للحذف: /حذف_مصروف <رقم من القائمة>${args.trim() ? ` ${args.trim()}` : ""}`,
    "لشهر ثاني: /مصاريفي الشهر الماضي · /مصاريفي شهر 10 · /تصدير_مصاريف شهر 10"
  ];
  await sock.sendMessage(jid, { text: rtlLines(lines) });
}

async function deleteExpense(sock, jid, sender, args, now) {
  // "/حذف_مصروف 3 الشهر الماضي": الرقم من نفس القائمة اللي طلعت بـ /مصاريفي الشهر الماضي
  const latin = toLatinDigits(args).trim();
  const lead = latin.match(/^(\d+)\s*(.*)$/);
  const index = Number(lead?.[1] || latin.match(/\d+/)?.[0] || 1);
  const range = periodStart(parsePeriod(lead ? lead[2] : "", now), now);
  const items = await Expense.find({ userJid: sender, spentAt: spentAtQuery(range) }).sort({ spentAt: -1 }).limit(LIST_LIMIT).lean();
  const item = items[index - 1];
  if (!item) {
    await sock.sendMessage(jid, { text: "❌ ما لقيت هالمصروف. شوف الأرقام بـ /مصاريفي" });
    return;
  }
  await Expense.deleteOne({ _id: item._id, userJid: sender });
  await sock.sendMessage(jid, { text: `🗑️ حذفت: ${describeItem(item)}${item.label ? ` · ${item.label}` : ""}` });
}

const XLSX_COLORS = { header: "FF1F4E79", title: "FF2E75B6", band: "FFEAF1FB", total: "FFFCE4D6", border: "FFBFBFBF", converted: "FF7F7F7F" };

function styleRow(row, { fill, font, border = true } = {}) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    if (font) cell.font = { name: "Arial", size: 11, ...font };
    if (border) {
      const side = { style: "thin", color: { argb: XLSX_COLORS.border } };
      cell.border = { top: side, bottom: side, left: side, right: side };
    }
    cell.alignment = { vertical: "middle", horizontal: "center", readingOrder: "rtl", ...(cell.alignment || {}) };
  });
}

function addTitle(sheet, text, columns) {
  sheet.mergeCells(1, 1, 1, columns);
  const cell = sheet.getCell(1, 1);
  cell.value = text;
  cell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XLSX_COLORS.title } };
  cell.alignment = { vertical: "middle", horizontal: "center", readingOrder: "rtl" };
  sheet.getRow(1).height = 28;
}

const RED = { fill: "FFF8D7DA", font: "FF9C0006" };

function addAnalysisSheet(sheet, { title, items, total, analysis, byLabel }) {
  sheet.columns = [{ width: 30 }, { width: 16 }, { width: 11 }, { width: 4 }, { width: 4 }, { width: 4 }];
  addTitle(sheet, `📊 تحليل مصاريفك ${title}`.trim(), 6);
  sheet.mergeCells(2, 1, 2, 6);
  const sub = sheet.getCell(2, 1);
  sub.value = analysis.source !== "code" ? "🤖 التصنيف والملاحظات من سام بالذكاء الاصطناعي، والأرقام محسوبة من سجلك" : "التصنيف تلقائي من أسماء المصاريف";
  sub.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF595959" } };
  sub.alignment = { horizontal: "center", readingOrder: "rtl" };

  const header = (row, values) => {
    const r = sheet.getRow(row);
    values.forEach((v, i) => { r.getCell(i + 1).value = v; });
    styleRow(r, { fill: XLSX_COLORS.header, font: { bold: true, color: { argb: "FFFFFFFF" } } });
    for (let c = values.length + 1; c <= 6; c += 1) { r.getCell(c).fill = undefined; r.getCell(c).border = undefined; }
    r.height = 22;
  };
  const amountFormat = "#,##0.00";
  const days = (() => {
    if (!items.length) return 1;
    const keys = items.map((item) => { const { year, month, day } = getTimeZoneParts(new Date(item.spentAt), TIME_ZONE); return Date.UTC(year, month - 1, day); });
    return Math.max(1, Math.round((Math.max(...keys) - Math.min(...keys)) / 86400000) + 1);
  })();
  const top = byLabel[0];

  header(4, ["الملخص", "", ""]);
  sheet.mergeCells(4, 1, 4, 3);
  const kpis = [
    ["المجموع", total, amountFormat],
    ["عدد المصاريف", items.length, "0"],
    ["المعدل اليومي", Math.round((total / days) * 1000) / 1000, amountFormat],
    ["أكثر اشي صرفت عليه", top ? `${top.label} (${Number(top.total.toFixed(3))} ${CURRENCY})` : "-", null]
  ];
  kpis.forEach(([label, value, format], index) => {
    const row = sheet.getRow(5 + index);
    row.getCell(1).value = label;
    row.getCell(2).value = value;
    sheet.mergeCells(5 + index, 2, 5 + index, 3);
    styleRow(row, { font: { bold: index === 0 } });
    for (let c = 4; c <= 6; c += 1) row.getCell(c).border = undefined;
    if (format) row.getCell(2).numFmt = format;
    if (index === 3) row.getCell(2).font = { name: "Arial", size: 11, bold: true, color: { argb: RED.font } };
  });

  header(10, ["الأهمية", "المبلغ", "النسبة"]);
  IMPORTANCE_ORDER.forEach((key, index) => {
    const level = IMPORTANCE[key];
    const value = analysis.byLevel[key] || 0;
    const row = sheet.getRow(11 + index);
    row.getCell(1).value = level.label;
    row.getCell(2).value = value;
    row.getCell(3).value = total ? value / total : 0;
    styleRow(row, { fill: level.fill, font: { bold: true, color: { argb: level.font } } });
    for (let c = 4; c <= 6; c += 1) { row.getCell(c).fill = undefined; row.getCell(c).border = undefined; }
    row.getCell(2).numFmt = amountFormat;
    row.getCell(3).numFmt = "0%";
  });

  let rowNo = 15;
  const block = (heading, lines) => {
    if (!lines.length) return;
    header(rowNo, [heading]);
    sheet.mergeCells(rowNo, 1, rowNo, 6);
    rowNo += 1;
    for (const line of lines) {
      sheet.mergeCells(rowNo, 1, rowNo, 6);
      const cell = sheet.getCell(rowNo, 1);
      cell.value = `• ${line}`;
      cell.font = { name: "Arial", size: 11 };
      cell.alignment = { vertical: "middle", horizontal: "right", wrapText: true, readingOrder: "rtl" };
      sheet.getRow(rowNo).height = Math.min(90, 20 + Math.ceil(line.length / 55) * 15);
      rowNo += 1;
    }
    rowNo += 1;
  };
  block("💡 ملاحظات", analysis.insights);
  block("✂️ وين بتقدر توفر", analysis.tips);
  sheet.mergeCells(rowNo, 1, rowNo, 6);
  const legend = sheet.getCell(rowNo, 1);
  legend.value = "🔴 الأحمر = أكثر اشي صرفت عليه · 🟢 أساسي · 🟡 ممكن تقلل · 🔴 ما إله داعي";
  legend.font = { name: "Arial", size: 10, color: { argb: "FF595959" } };
  legend.alignment = { horizontal: "right", wrapText: true, readingOrder: "rtl" };
}

/**
 * ملف إكسل مرتب: ورقة بكل المصاريف وسطر مجموع، وورقة ملخص حسب التصنيف. الصفحات من اليمين لليسار.
 * مع analysis (من analyzeExpensesForExport): ورقة تحليل أول، عمود أهمية بألوان، الأعلى صرف بالأحمر، وتشارتين.
 */
export async function buildExpensesWorkbook(items, title = "", analysis = null) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sam";
  const sorted = [...items].sort((a, b) => new Date(a.spentAt) - new Date(b.spentAt));
  const amountFormat = "#,##0.00";
  const byLabel = labelTotals(sorted);
  const total = Math.round(sorted.reduce((sum, item) => sum + item.amount, 0) * 1000) / 1000;
  const topLabels = new Set(byLabel.slice(0, 3).filter((e) => e.total > 0).map((e) => e.label));
  const importanceOf = (label) => (analysis ? IMPORTANCE[analysis.importance[label || "بدون تصنيف"]] : null);

  const analysisSheet = analysis ? workbook.addWorksheet("التحليل", { views: [{ rightToLeft: true }] }) : null;

  const sheet = workbook.addWorksheet("المصاريف", { views: [{ rightToLeft: true, state: "frozen", ySplit: 2 }] });
  const headers = ["التاريخ", "الوقت", "على شو", "المبلغ", "العملة", "المبلغ الأصلي", "العملة الأصلية", ...(analysis ? ["الأهمية"] : [])];
  sheet.columns = [{ width: 13 }, { width: 9 }, { width: 28 }, { width: 13 }, { width: 10 }, { width: 14 }, { width: 14 }, ...(analysis ? [{ width: 16 }] : [])];
  addTitle(sheet, `💰 مصاريفي ${title}`.trim(), headers.length);
  const headerRow = sheet.addRow(headers);
  headerRow.height = 22;
  styleRow(headerRow, { fill: XLSX_COLORS.header, font: { bold: true, color: { argb: "FFFFFFFF" } } });

  // أكبر 5 مصاريف بالأحمر
  const biggest = new Set([...sorted].sort((a, b) => b.amount - a.amount).slice(0, Math.min(5, Math.ceil(sorted.length / 3))));
  sorted.forEach((item, index) => {
    const { year, month, day, hour, minute } = getTimeZoneParts(new Date(item.spentAt), TIME_ZONE);
    // إكسل ما بيعرف المناطق الزمنية، فبنحط وقت عمّان كأنه UTC حتى يطلع زي ما هو
    const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
    const level = importanceOf(item.label);
    const row = sheet.addRow([local, local, item.label || "بدون تصنيف", item.amount, item.currency || CURRENCY, item.originalAmount ?? null, item.originalCurrency || null, ...(level ? [level.label] : [])]);
    styleRow(row, { fill: index % 2 ? XLSX_COLORS.band : undefined, font: {} });
    row.getCell(1).numFmt = "dd/mm/yyyy";
    row.getCell(2).numFmt = "hh:mm";
    row.getCell(3).alignment = { vertical: "middle", horizontal: "right", readingOrder: "rtl" };
    row.getCell(4).numFmt = amountFormat;
    row.getCell(6).numFmt = amountFormat;
    if (item.originalAmount != null) [6, 7].forEach((n) => { row.getCell(n).font = { name: "Arial", size: 11, color: { argb: XLSX_COLORS.converted } }; });
    if (biggest.has(item)) row.getCell(4).font = { name: "Arial", size: 11, bold: true, color: { argb: RED.font } };
    if (level) {
      row.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: level.fill } };
      row.getCell(8).font = { name: "Arial", size: 11, bold: true, color: { argb: level.font } };
    }
  });

  const firstData = 3;
  const lastData = firstData + sorted.length - 1;
  const totalRow = sheet.addRow(["المجموع", "", `${sorted.length} مصروف`, { formula: `SUM(D${firstData}:D${lastData})`, result: total }, CURRENCY, "", "", ...(analysis ? [""] : [])]);
  totalRow.height = 22;
  styleRow(totalRow, { fill: XLSX_COLORS.total, font: { bold: true, size: 12 } });
  totalRow.getCell(4).numFmt = amountFormat;
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: lastData, column: headers.length } };

  const summary = workbook.addWorksheet("حسب التصنيف", { views: [{ rightToLeft: true }] });
  const summaryHeaders = ["التصنيف", "المجموع", "العدد", "النسبة", ...(analysis ? ["الأهمية"] : [])];
  summary.columns = [{ width: 28 }, { width: 14 }, { width: 10 }, { width: 12 }, ...(analysis ? [{ width: 16 }] : [])];
  addTitle(summary, "📊 وين راحت المصاري", summaryHeaders.length);
  styleRow(summary.addRow(summaryHeaders), { fill: XLSX_COLORS.header, font: { bold: true, color: { argb: "FFFFFFFF" } } });
  byLabel.forEach((group, index) => {
    const level = importanceOf(group.label);
    const row = summary.addRow([group.label, group.total, group.count, total ? group.total / total : 0, ...(level ? [level.label] : [])]);
    const red = topLabels.has(group.label);
    styleRow(row, { fill: red ? RED.fill : index % 2 ? XLSX_COLORS.band : undefined, font: red ? { bold: true, color: { argb: RED.font } } : {} });
    row.getCell(1).alignment = { vertical: "middle", horizontal: "right", readingOrder: "rtl" };
    row.getCell(2).numFmt = amountFormat;
    row.getCell(4).numFmt = "0%";
    if (level) {
      row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: level.fill } };
      row.getCell(5).font = { name: "Arial", size: 11, bold: true, color: { argb: level.font } };
    }
  });
  styleRow(summary.addRow(["المجموع", total, sorted.length, 1, ...(analysis ? [""] : [])]), { fill: XLSX_COLORS.total, font: { bold: true, size: 12 } });
  summary.lastRow.getCell(2).numFmt = amountFormat;
  summary.lastRow.getCell(4).numFmt = "0%";

  if (analysisSheet) addAnalysisSheet(analysisSheet, { title, items: sorted, total, analysis, byLabel });

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  if (!analysis || !byLabel.length) return buffer;
  try {
    const shown = byLabel.slice(0, 10);
    return await addChartsToWorkbook(buffer, "التحليل", [
      {
        type: "pie",
        title: "المصاريف حسب الأهمية",
        seriesName: "الأهمية",
        categories: IMPORTANCE_ORDER.map((key) => IMPORTANCE[key].label),
        values: IMPORTANCE_ORDER.map((key) => analysis.byLevel[key] || 0),
        colors: IMPORTANCE_ORDER.map((key) => IMPORTANCE[key].color),
        categoryRef: sheetRef("التحليل", "A", 11, 13),
        valueRef: sheetRef("التحليل", "B", 11, 13),
        anchor: [7, 1, 15, 17]
      },
      {
        type: "bar",
        title: "أكثر اشي صرفت عليه",
        seriesName: `المبلغ (${CURRENCY})`,
        categories: shown.map((e) => e.label),
        values: shown.map((e) => e.total),
        colors: shown.map((e) => (topLabels.has(e.label) ? "E74C3C" : null)),
        color: "2E75B6",
        categoryRef: sheetRef("حسب التصنيف", "A", 3, 2 + shown.length),
        valueRef: sheetRef("حسب التصنيف", "B", 3, 2 + shown.length),
        anchor: [7, 18, 15, 18 + Math.max(14, shown.length * 2)]
      }
    ]);
  } catch (error) {
    console.warn("Adding expense charts failed:", error.message);
    return buffer;
  }
}

async function exportExpenses(sock, jid, sender, args, now, insightOptions = {}) {
  const range = periodStart(parsePeriod(args, now), now);
  const { title } = range;
  const items = await Expense.find({ userJid: sender, spentAt: spentAtQuery(range) }).sort({ spentAt: 1 }).lean();
  if (!items.length) {
    await sock.sendMessage(jid, { text: `📭 ما في مصاريف مسجلة ${title} عشان أصدرها.` });
    return;
  }
  const { year, month, day } = getTimeZoneParts(now, TIME_ZONE);
  const pad = (n) => String(n).padStart(2, "0");
  const fileName = range.month
    ? `مصاريف-${range.month.year}-${pad(range.month.month)}.xlsx`
    : `مصاريف-${year}-${pad(month)}-${pad(day)}.xlsx`;
  // طلب ذكاء واحد بيصنف الأهمية وبيكتب الملاحظات؛ إذا فشل بنكمل بتصنيف الكلمات
  const analysis = await analyzeExpensesForExport(items, sender, { title, currency: CURRENCY, ...insightOptions }).catch((error) => {
    console.warn("Expense export analysis failed:", error.message);
    return null;
  });
  const unnecessary = analysis?.byLevel.unnecessary ? `\n🔴 ما إله داعي: ${formatAmount(analysis.byLevel.unnecessary)}` : "";
  await sock.sendMessage(jid, {
    document: await buildExpensesWorkbook(items, title, analysis),
    mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileName,
    caption: `📊 مصاريفك ${title}: ${items.length} مصروف، المجموع ${formatTotals(items)}${unnecessary}\nبالملف: ورقة تحليل وتشارت، والأحمر أكثر اشي صرفت عليه\nلفترة ثانية: /تصدير_مصاريف اليوم · الاسبوع · الكل · الشهر الماضي · شهر 10`
  });
}

function matchCommand(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("/")) return null;
  const normalized = normalizeName(trimmed.slice(1));
  const find = (names) => names.map(normalizeName).filter((n) => normalized === n || normalized.startsWith(`${n} `)).sort((a, b) => b.length - a.length)[0];
  for (const [action, names] of [["export", EXPORT_COMMANDS], ["delete", DELETE_COMMANDS], ["list", LIST_COMMANDS], ["add", ADD_COMMANDS]]) {
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
export async function handleExpenseCommand(sock, jid, sender, text, { now = new Date(), extractOptions, rateOptions, insightOptions } = {}) {
  const matched = matchCommand(text);
  if (!matched) return false;
  const target = isPrivateChat(jid) ? jid : sender;
  try {
    if (matched.action === "list") await listExpenses(sock, target, sender, matched.args, now);
    else if (matched.action === "export") await exportExpenses(sock, target, sender, matched.args, now, insightOptions);
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
