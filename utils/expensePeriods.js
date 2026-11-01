// فترة شهر محددة من الكلام: "شهر 10"، "10/2025"، "تشرين الاول"، "اكتوبر"، "الشهر الماضي".
// بتستخدمها أوامر المصاريف (/مصاريفي شهر 10) وأسئلة المصاريف ("كم صرفت الشهر الماضي").

function normalize(text) {
  return String(text || "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim().replace(/_/g, " ").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ً-ْـ]/g, "")
    .replace(/\s+/g, " ").toLowerCase();
}

export const MONTH_NAMES_AR = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];

// الأطول أول حتى "تشرين الثاني" ما ينقرأ "تشرين"
const MONTH_WORDS = [
  [/كانون (الثاني|ثاني|التاني|تاني)/, 1], [/كانون (الاول|اول)/, 12],
  [/تشرين (الثاني|ثاني|التاني|تاني)/, 11], [/تشرين (الاول|اول)/, 10],
  [/يناير/, 1], [/فبراير|شباط/, 2], [/مارس|اذار/, 3], [/ابريل|نيسان/, 4], [/مايو|ايار/, 5],
  [/يونيو|يونيه|حزيران/, 6], [/يوليو|يوليه|تموز/, 7], [/اغسطس|اغسطوس/, 8], [/شهر اب(?=\s|$)/, 8],
  [/سبتمبر|ايلول/, 9], [/اكتوبر|اوكتوبر/, 10], [/نوفمبر/, 11], [/ديسمبر/, 12]
];

function yearFrom(value) {
  const match = value.match(/(?:^|\D)(20\d{2})(?!\d)/);
  return match ? Number(match[1]) : null;
}

/**
 * يرجع { year, month } لشهر مذكور بالكلام، أو null.
 * بدون سنة: الشهر بهالسنة، وإذا لسا ما إجا (مثلًا شهر 12 واحنا بشهر 11) فهو من السنة الماضية.
 */
export function parseMonthMention(text, today) {
  const value = normalize(text);
  if (!value) return null;
  const { year: thisYear, month: thisMonth } = today;
  const previous = () => (thisMonth === 1 ? { year: thisYear - 1, month: 12 } : { year: thisYear, month: thisMonth - 1 });

  if (/(الشهر|شهر) (الماضي|اللي فات|الي فات|يلي فات|الفائت|الفات|السابق|اللي قبل|الي قبل|قبل)/.test(value)) return previous();

  let month = null;
  // "شهر 10"، "شهر 10/2025"، "شهر 10 2025"
  const numbered = value.match(/شهر\s*(\d{1,2})(?!\d)/);
  if (numbered) month = Number(numbered[1]);
  // "10/2025" أو "2025-10"
  if (!month) {
    const slash = value.match(/(?:^|\s)(\d{1,2})\s*[/\-.]\s*(20\d{2})(?=\s|$)/) || null;
    const iso = value.match(/(?:^|\s)(20\d{2})\s*[/\-.]\s*(\d{1,2})(?=\s|$)/) || null;
    if (slash) month = Number(slash[1]);
    else if (iso) month = Number(iso[2]);
  }
  if (!month) {
    const named = MONTH_WORDS.find(([re]) => re.test(value));
    if (named) month = named[1];
  }
  if (!month || month < 1 || month > 12) return null;
  let year = yearFrom(value);
  if (!year) year = month > thisMonth ? thisYear - 1 : thisYear;
  return { year, month };
}

/** "شهر 10" لوحدها (أو "10"، "10/2025") كوسيط للأوامر: /مصاريفي 10 */
export function parseMonthArg(args, today) {
  const value = normalize(args);
  const bare = value.match(/^(\d{1,2})(?:\s*[/\-.]?\s*(20\d{2}))?$/);
  if (bare) {
    const month = Number(bare[1]);
    if (month < 1 || month > 12) return null;
    const year = bare[2] ? Number(bare[2]) : (month > today.month ? today.year - 1 : today.year);
    return { year, month };
  }
  return parseMonthMention(value, today);
}

export function monthTitle({ year, month }) {
  return `${MONTH_NAMES_AR[month - 1]} ${year}`;
}

export function monthKeyRange({ year, month }) {
  const pad = (n) => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}
