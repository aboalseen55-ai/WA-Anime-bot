// المساعد الشخصي: تذكيرات، مهام، وملاحظات سريعة لكل عضو
import PersonalItem from "../database/personalItemModel.js";
import { featureEnabled, withBotContext } from "../services/botControls.js";
import { DEFAULT_TIME_ZONE, getTimeZoneParts, zonedTimeToUtc } from "./quran.js";

const TIME_ZONE = process.env.PERSONAL_REMINDER_TIMEZONE || DEFAULT_TIME_ZONE;
const CHECK_INTERVAL_MS = 30 * 1000;
const MAX_TEXT_LENGTH = 500;
const MAX_ATTEMPTS = 3;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
const LIMITS = { reminder: 50, todo: 100, note: 100 };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ============================================
// تحليل وقت التذكير
// ============================================

const END = "(?=\\s|$)";
const DAY_WORD_RE = new RegExp(`^(بعد\\s+بكر[هةا]|بكر[هةا]|غدا?|tomorrow|اليوم|today)${END}\\s*`, "iu");
const RELATIVE_START_RE = new RegExp(`^(?:بعد|خلال|in)\\s+`, "iu");
const DURATION_NUMBER_RE = new RegExp(
  `^(\\d+)\\s*(دقيق[هة]|دقائق|دقايق|د|minutes?|mins?|m|ساع[هة]|ساعات|س|hours?|hrs?|h|يوم|ايام|أيام|days?|d|اسبوع|أسبوع|اسابيع|أسابيع|weeks?|w)${END}\\s*`,
  "iu"
);
const DURATION_WORD_RE = new RegExp(
  `^(نص\\s+ساع[هة]|نصف\\s+ساع[هة]|ربع\\s+ساع[هة]|دقيقتين|دقيق[هة]|ساعتين|ساع[هة]|يومين|يوم|اسبوعين|أسبوعين|اسبوع|أسبوع)${END}\\s*`,
  "iu"
);
const DURATION_JOIN_RE = /^و\s*/u;
const TIME_RE = new RegExp(
  `^(?:(?:في|على|ع)\\s+)?((?:ال)?ساع[هة]\\s*|at\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*و\\s*(نص|النص|نصف|ربع|الربع))?` +
  `\\s*(صباحا|صباح|الصبح|الصباح|الفجر|ص|a\\.?m\\.?|مساءا|مساء|المساء|المسا|مسا|م|p\\.?m\\.?|الظهر|العصر|المغرب|الليل|بالليل|ليلا)?${END}\\s*`,
  "iu"
);
const AM_WORDS = new Set(["صباحا", "صباح", "الصبح", "الصباح", "الفجر", "ص", "am", "a.m.", "a.m", "am."]);
const LEADING_CONNECTOR_RE = /^(?:ب|عن|ان|أن|إن|انو|إنو|اني|إني|:|-|،|,)\s+/u;
const DURATION_FRACTION_RE = new RegExp(`^(نص|نصف|ربع)${END}\\s*`, "u");

function cleanInput(text) {
  return String(text || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/\s+/g, " ")
    .trim();
}

function durationFromNumber(amount, unit) {
  const u = unit.toLowerCase();
  if (/^(دقيق|دقائق|دقايق|د$|min|m$)/u.test(u)) return amount * MINUTE;
  if (/^(ساع|س$|hour|hr|h$)/u.test(u)) return amount * HOUR;
  if (/^(يوم|ايام|أيام|day|d$)/u.test(u)) return amount * DAY;
  if (/^(اسبوع|أسبوع|اسابيع|أسابيع|week|w$)/u.test(u)) return amount * 7 * DAY;
  return 0;
}

function durationFromWord(word) {
  const w = word.replace(/\s+/g, " ").replace(/ة/g, "ه");
  const table = {
    "نص ساعه": 30 * MINUTE,
    "نصف ساعه": 30 * MINUTE,
    "ربع ساعه": 15 * MINUTE,
    "دقيقتين": 2 * MINUTE,
    "دقيقه": MINUTE,
    "ساعتين": 2 * HOUR,
    "ساعه": HOUR,
    "يومين": 2 * DAY,
    "يوم": DAY,
    "اسبوعين": 14 * DAY,
    "أسبوعين": 14 * DAY,
    "اسبوع": 7 * DAY,
    "أسبوع": 7 * DAY
  };
  return table[w] || 0;
}

function parseDurations(input) {
  let rest = input;
  let total = 0;
  while (rest) {
    const numberMatch = rest.match(DURATION_NUMBER_RE);
    const wordMatch = numberMatch ? null : rest.match(DURATION_WORD_RE);
    if (numberMatch) {
      total += durationFromNumber(Number(numberMatch[1]), numberMatch[2]);
      rest = rest.slice(numberMatch[0].length);
    } else if (wordMatch) {
      total += durationFromWord(wordMatch[1]);
      rest = rest.slice(wordMatch[0].length);
    } else {
      break;
    }
    const join = rest.match(DURATION_JOIN_RE);
    if (!join) break;
    const afterJoin = rest.slice(join[0].length);
    const fraction = afterJoin.match(DURATION_FRACTION_RE);
    if (fraction) {
      // "ساعة ونص" أو "ساعتين وربع"
      total += (fraction[1] === "ربع" ? 15 : 30) * MINUTE;
      rest = afterJoin.slice(fraction[0].length);
      break;
    }
    if (DURATION_NUMBER_RE.test(afterJoin) || DURATION_WORD_RE.test(afterJoin)) rest = afterJoin;
    else break;
  }
  return { total, rest };
}

function dayOffsetFromWord(word) {
  const w = word.toLowerCase().replace(/\s+/g, " ");
  if (w.startsWith("بعد")) return 2;
  if (w === "اليوم" || w === "today") return 0;
  return 1;
}

/**
 * يحوّل نص مثل "الساعة 6 مساء اتصل بأحمد" أو "بعد 10 دقائق الفرن"
 * إلى { dueAt, message } أو { error }.
 */
export function parseReminderRequest(input, { now = new Date(), timeZone = TIME_ZONE } = {}) {
  let rest = cleanInput(input);
  let dayOffset = null;
  let durationMs = 0;
  let time = null;

  for (let guard = 0; guard < 6 && rest; guard += 1) {
    const dayMatch = rest.match(DAY_WORD_RE);
    if (dayMatch && dayOffset === null) {
      dayOffset = dayOffsetFromWord(dayMatch[1]);
      rest = rest.slice(dayMatch[0].length);
      continue;
    }

    const relativeMatch = rest.match(RELATIVE_START_RE);
    if (relativeMatch && !durationMs) {
      const parsed = parseDurations(rest.slice(relativeMatch[0].length));
      if (parsed.total > 0) {
        durationMs = parsed.total;
        rest = parsed.rest;
        continue;
      }
    }

    const timeMatch = rest.match(TIME_RE);
    if (timeMatch && !time) {
      const [, clockWord, hourText, minuteText, fraction, meridiem] = timeMatch;
      const looksLikeTime = clockWord || minuteText || fraction || meridiem || dayOffset !== null;
      if (looksLikeTime) {
        time = { hour: Number(hourText), minute: minuteText ? Number(minuteText) : 0, meridiem: meridiem?.toLowerCase() || null };
        if (fraction) time.minute += /ربع/u.test(fraction) ? 15 : 30;
        rest = rest.slice(timeMatch[0].length);
        continue;
      }
    }

    break;
  }

  let message = rest;
  while (LEADING_CONNECTOR_RE.test(message)) message = message.replace(LEADING_CONNECTOR_RE, "");
  message = message.trim();

  if (!durationMs && !time && dayOffset === null) return { error: "no_time" };
  if (!message) return { error: "no_text" };

  let dueAt;
  if (durationMs) {
    dueAt = new Date(now.getTime() + durationMs);
  } else {
    let hour = time ? time.hour : 9;
    const minute = time ? time.minute : 0;
    const meridiem = time?.meridiem;
    if (meridiem && AM_WORDS.has(meridiem)) {
      if (hour === 12) hour = 0;
    } else if (meridiem && hour < 12) {
      hour += 12;
    }
    if (hour > 23 || minute > 59) return { error: "bad_time" };

    const parts = getTimeZoneParts(now, timeZone);
    dueAt = zonedTimeToUtc(parts.year, parts.month, parts.day + (dayOffset ?? 0), hour, minute, 0, timeZone);

    if (dueAt <= now && dayOffset === null) {
      // "الساعة 6" بعد السادسة صباحًا تعني غالبًا السادسة مساءً
      const evening = !meridiem && hour >= 1 && hour < 12
        ? zonedTimeToUtc(parts.year, parts.month, parts.day, hour + 12, minute, 0, timeZone)
        : null;
      dueAt = evening && evening > now
        ? evening
        : zonedTimeToUtc(parts.year, parts.month, parts.day + 1, hour, minute, 0, timeZone);
    }
  }

  if (dueAt <= now) return { error: "past" };
  if (dueAt.getTime() - now.getTime() > MAX_AHEAD_MS) return { error: "too_far" };

  return { dueAt, message: message.slice(0, MAX_TEXT_LENGTH) };
}

export function formatDueAt(date, timeZone = TIME_ZONE) {
  return new Date(date).toLocaleString("ar-EG", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit"
  });
}

// ============================================
// الأوامر
// ============================================

function normalizeCommand(text) {
  return cleanInput(text)
    .replace(/_/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

const COMMANDS = [
  { names: ["الغاء تذكير", "حذف تذكير"], action: "cancelReminder" },
  { names: ["تذكيراتي"], action: "listReminders" },
  { names: ["ذكرني", "نبهني"], action: "addReminder" },
  { names: ["حذف مهمه"], action: "deleteTodo" },
  { names: ["مهامي"], action: "listTodos" },
  { names: ["مهمه", "اضف مهمه"], action: "addTodo" },
  { names: ["تم", "تمت", "انجاز"], action: "completeTodo" },
  { names: ["حذف ملاحظه"], action: "deleteNote" },
  { names: ["ملاحظاتي"], action: "listNotes" },
  { names: ["ملاحظه"], action: "addNote" },
  { names: ["مساعدي", "المساعد"], action: "help" }
];

/** يعيد { action, args } أو null إن لم يكن الأمر من أوامر المساعد. */
export function matchPersonalCommand(text) {
  const raw = cleanInput(text);
  if (!raw.startsWith("/")) return null;

  const normalized = normalizeCommand(raw.slice(1));
  let best = null;
  for (const command of COMMANDS) {
    for (const name of command.names) {
      if ((normalized === name || normalized.startsWith(`${name} `)) && (!best || name.length > best.name.length)) {
        best = { name, action: command.action };
      }
    }
  }
  if (!best) return null;

  // الوسيط يؤخذ من النص الأصلي حتى لا تتغير كتابة العضو
  const words = best.name.split(" ").length;
  const args = raw.slice(1).replace(/_/g, " ").split(" ").slice(words).join(" ").trim();
  return { action: best.action, args };
}

export function isPersonalCommand(text) {
  return Boolean(matchPersonalCommand(text));
}

const REMINDER_ERRORS = {
  no_time: "⏰ حدد وقت التذكير.\nمثال: /ذكرني الساعة 6 مساءً اتصل بأحمد\nأو: /ذكرني بعد 20 دقيقة أطفئ الفرن",
  no_text: "✍️ اكتب ماذا أذكرك به بعد الوقت.\nمثال: /ذكرني بكرة الساعة 9 اجتماع العمل",
  bad_time: "❌ الوقت غير صحيح. استخدم ساعة بين 0 و 23 ودقائق بين 0 و 59.",
  past: "❌ هذا الوقت مضى. اختر وقتًا قادمًا.",
  too_far: "❌ أقصى مدة للتذكير سنة واحدة."
};

export function buildPersonalHelp() {
  return [
    "*🗂️ مساعدك الشخصي*",
    "",
    "*⏰ التذكيرات* (تصلك على الخاص)",
    "▪️ /ذكرني الساعة 6 مساءً <النص>",
    "▪️ /ذكرني بعد 30 دقيقة <النص>",
    "▪️ /ذكرني بكرة الساعة 9 <النص>",
    "▪️ /تذكيراتي — التذكيرات القادمة",
    "▪️ /الغاء_تذكير <رقم>",
    "",
    "*✅ المهام*",
    "▪️ /مهمة <النص> — إضافة مهمة",
    "▪️ /مهامي — عرض المهام",
    "▪️ /تم <رقم> — إنجاز مهمة",
    "▪️ /حذف_مهمة <رقم>",
    "",
    "*📝 الملاحظات*",
    "▪️ /ملاحظة <النص> — حفظ ملاحظة",
    "▪️ /ملاحظاتي — عرض الملاحظات",
    "▪️ /حذف_ملاحظة <رقم>"
  ].join("\n");
}

function isGroup(jid) {
  return String(jid || "").endsWith("@g.us");
}

function parseIndex(args) {
  const value = Number(cleanInput(args).split(" ")[0]);
  return Number.isInteger(value) && value >= 1 ? value : null;
}

async function listItems(kind, userJid) {
  const query = kind === "reminder"
    ? { kind, userJid, status: { $in: ["pending", "sending"] } }
    : { kind, userJid };
  const sort = kind === "reminder" ? { dueAt: 1 } : { createdAt: 1 };
  return PersonalItem.find(query).sort(sort).lean();
}

async function addItem(kind, userJid, chatJid, text, extra = {}) {
  const count = await PersonalItem.countDocuments(
    kind === "reminder" ? { kind, userJid, status: { $in: ["pending", "sending"] } } : { kind, userJid }
  );
  if (count >= LIMITS[kind]) return null;
  return PersonalItem.create({ kind, userJid, chatJid, text: text.slice(0, MAX_TEXT_LENGTH), ...extra });
}

async function itemAt(kind, userJid, index) {
  const items = await listItems(kind, userJid);
  return index ? items[index - 1] || null : null;
}

function formatList(kind, items) {
  if (kind === "reminder") {
    if (!items.length) return "⏰ لا توجد تذكيرات قادمة.\nأضف واحدًا: /ذكرني الساعة 6 مساءً <النص>";
    return ["*⏰ تذكيراتك القادمة*", "", ...items.map((item, i) => `${i + 1}. ${item.text}\n   🕒 ${formatDueAt(item.dueAt)}`), "", "للإلغاء: /الغاء_تذكير <رقم>"].join("\n");
  }
  if (kind === "todo") {
    if (!items.length) return "✅ قائمة مهامك فارغة.\nأضف مهمة: /مهمة <النص>";
    const open = items.filter((item) => !item.done).length;
    return [`*✅ مهامك* (${open} متبقية من ${items.length})`, "", ...items.map((item, i) => `${i + 1}. ${item.done ? "✔️ ~" + item.text + "~" : "▫️ " + item.text}`), "", "للإنجاز: /تم <رقم> · للحذف: /حذف_مهمة <رقم>"].join("\n");
  }
  if (!items.length) return "📝 لا توجد ملاحظات.\nاحفظ ملاحظة: /ملاحظة <النص>";
  return ["*📝 ملاحظاتك*", "", ...items.map((item, i) => `${i + 1}. ${item.text}`), "", "للحذف: /حذف_ملاحظة <رقم>"].join("\n");
}

async function runAction(sock, jid, sender, action, args, now) {
  const reply = (text) => sock.sendMessage(jid, { text });
  // القوائم خاصة بصاحبها، فترسل على الخاص إذا طُلبت من مجموعة
  const replyPrivately = async (text) => {
    await sock.sendMessage(sender, { text });
    if (isGroup(jid)) await reply("📩 أرسلت لك القائمة على الخاص.");
  };

  switch (action) {
    case "help":
      return reply(buildPersonalHelp());

    case "addReminder": {
      const parsed = parseReminderRequest(args, { now });
      if (parsed.error) return reply(REMINDER_ERRORS[parsed.error]);
      const item = await addItem("reminder", sender, jid, parsed.message, { dueAt: parsed.dueAt });
      if (!item) return reply(`❌ وصلت للحد الأقصى (${LIMITS.reminder}) من التذكيرات. احذف بعضها أولًا: /تذكيراتي`);
      return reply(`✅ تم! سأذكرك على الخاص:\n📌 ${parsed.message}\n🕒 ${formatDueAt(parsed.dueAt)}`);
    }

    case "listReminders":
      return replyPrivately(formatList("reminder", await listItems("reminder", sender)));

    case "cancelReminder": {
      const item = await itemAt("reminder", sender, parseIndex(args));
      if (!item) return reply("❌ رقم غير صحيح. اعرض تذكيراتك أولًا: /تذكيراتي");
      await PersonalItem.deleteOne({ _id: item._id, userJid: sender });
      return reply(`🗑️ ألغيت التذكير: ${item.text}`);
    }

    case "addTodo": {
      const text = cleanInput(args);
      if (!text) return reply("✍️ اكتب المهمة بعد الأمر.\nمثال: /مهمة شراء خبز");
      const item = await addItem("todo", sender, jid, text);
      if (!item) return reply(`❌ وصلت للحد الأقصى (${LIMITS.todo}) من المهام. احذف بعضها أولًا: /مهامي`);
      return reply(`✅ أضفت المهمة: ${item.text}\nاعرض مهامك: /مهامي`);
    }

    case "listTodos":
      return replyPrivately(formatList("todo", await listItems("todo", sender)));

    case "completeTodo": {
      const item = await itemAt("todo", sender, parseIndex(args));
      if (!item) return reply("❌ رقم غير صحيح. اعرض مهامك أولًا: /مهامي");
      if (item.done) return reply(`ℹ️ المهمة منجزة مسبقًا: ${item.text}`);
      await PersonalItem.updateOne({ _id: item._id, userJid: sender }, { $set: { done: true, doneAt: now } });
      return reply(`🎉 أحسنت! أنجزت: ${item.text}`);
    }

    case "deleteTodo": {
      const item = await itemAt("todo", sender, parseIndex(args));
      if (!item) return reply("❌ رقم غير صحيح. اعرض مهامك أولًا: /مهامي");
      await PersonalItem.deleteOne({ _id: item._id, userJid: sender });
      return reply(`🗑️ حذفت المهمة: ${item.text}`);
    }

    case "addNote": {
      const text = cleanInput(args);
      if (!text) return reply("✍️ اكتب الملاحظة بعد الأمر.\nمثال: /ملاحظة رقم الطلب 4521");
      const item = await addItem("note", sender, jid, text);
      if (!item) return reply(`❌ وصلت للحد الأقصى (${LIMITS.note}) من الملاحظات. احذف بعضها أولًا: /ملاحظاتي`);
      return reply("📝 حفظت الملاحظة.\nاعرض ملاحظاتك: /ملاحظاتي");
    }

    case "listNotes":
      return replyPrivately(formatList("note", await listItems("note", sender)));

    case "deleteNote": {
      const item = await itemAt("note", sender, parseIndex(args));
      if (!item) return reply("❌ رقم غير صحيح. اعرض ملاحظاتك أولًا: /ملاحظاتي");
      await PersonalItem.deleteOne({ _id: item._id, userJid: sender });
      return reply(`🗑️ حذفت الملاحظة: ${item.text}`);
    }

    default:
      return null;
  }
}

/** يعالج أوامر المساعد الشخصي. يعيد true إذا كان الأمر من أوامره. */
export async function handlePersonalCommand(sock, jid, sender, text, { now = new Date() } = {}) {
  const matched = matchPersonalCommand(text);
  if (!matched) return false;

  try {
    await runAction(sock, jid, sender, matched.action, matched.args, now);
  } catch (error) {
    console.error("Personal assistant command failed:", error.message);
    await sock.sendMessage(jid, { text: "❌ حدث خطأ، حاول مرة أخرى بعد قليل." });
  }
  return true;
}

// ============================================
// إرسال التذكيرات المستحقة على الخاص
// ============================================

export async function deliverDueReminders(sock, now = new Date()) {
  const due = await PersonalItem.find({ kind: "reminder", status: "pending", dueAt: { $lte: now } })
    .sort({ dueAt: 1 })
    .limit(25)
    .lean();

  let sent = 0;
  for (const item of due) {
    // حجز التذكير قبل الإرسال حتى لا يُرسل مرتين
    const claimed = await PersonalItem.findOneAndUpdate(
      { _id: item._id, status: "pending" },
      { $set: { status: "sending" } }
    ).lean();
    if (!claimed) continue;

    try {
      await sock.sendMessage(item.userJid, { text: `⏰ *تذكير*\n\n${item.text}` });
      await PersonalItem.updateOne({ _id: item._id }, { $set: { status: "sent", sentAt: new Date() } });
      sent += 1;
    } catch (error) {
      const attempts = (item.attempts || 0) + 1;
      console.warn(`Personal reminder ${item._id} failed (attempt ${attempts}):`, error.message);
      await PersonalItem.updateOne(
        { _id: item._id },
        { $set: { status: attempts >= MAX_ATTEMPTS ? "failed" : "pending", attempts, dueAt: new Date(Date.now() + MINUTE) } }
      );
    }
  }
  return sent;
}

let personalReminderTimer = null;
let personalReminderRunning = false;

export function schedulePersonalReminders(sock, { intervalMs = CHECK_INTERVAL_MS } = {}) {
  if (personalReminderTimer) clearInterval(personalReminderTimer);

  const tick = async () => {
    if (personalReminderRunning) return;
    personalReminderRunning = true;
    try {
      // نفس بوابات تذكير القرآن اليومي: الرسائل التلقائية + التذكيرات المجدولة
      if (featureEnabled("automatic") && featureEnabled("reminders")) {
        await withBotContext("automatic", () => deliverDueReminders(sock));
      }
    } catch (error) {
      console.warn("Personal reminders interrupted:", error.message);
    } finally {
      personalReminderRunning = false;
    }
  };

  // تذكيرات علقت أثناء إعادة تشغيل سابقة تعود للانتظار
  PersonalItem.updateMany({ kind: "reminder", status: "sending" }, { $set: { status: "pending" } })
    .catch((error) => console.warn("Could not reset stuck personal reminders:", error.message))
    .finally(tick);

  personalReminderTimer = setInterval(tick, intervalMs);
  personalReminderTimer.unref?.();
  console.log(`Personal reminders check every ${Math.round(intervalMs / 1000)}s (${TIME_ZONE})`);
  return personalReminderTimer;
}

export function stopPersonalReminders() {
  if (personalReminderTimer) clearInterval(personalReminderTimer);
  personalReminderTimer = null;
}
