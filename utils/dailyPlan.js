// خطة اليوم: "بكرة بدي أروح عالبنك الساعة 10 وأخلص التقرير وأتصل بأحمد العصر"
// سام بيرتبها كقائمة، بيذكّر بوقت كل مهمة ويسأل "خلصت؟"، بيذكّر بنص اليوم بالباقي، وبآخر اليوم بيلخص وبيعرض ينقل الباقي لبكرة.
import DailyPlan from "../database/dailyPlanModel.js";
import { DEFAULT_TIME_ZONE, getTimeZoneParts, zonedTimeToUtc } from "./quran.js";
import { generateSamBotAIFromParts, isSamBotAIAvailable } from "./samBotAI.js";
import { consumeAssistantQuota } from "./assistantQuota.js";

const TIME_ZONE = process.env.PERSONAL_REMINDER_TIMEZONE || DEFAULT_TIME_ZONE;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const MAX_TASKS = 30;
const MAX_TEXT = 200;
const FOLLOW_UP_AFTER = 60 * MINUTE;
const DEFAULT_SNOOZE = 30 * MINUTE;
const AWAITING_WINDOW = 6 * HOUR;
const MORNING_HOUR = Number(process.env.PLAN_MORNING_HOUR || 8);
const MIDDAY_HOUR = Number(process.env.PLAN_MIDDAY_HOUR || 13);
const EVENING_HOUR = Number(process.env.PLAN_EVENING_HOUR || 21);

function normalize(text) {
  return String(text || "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

function isPrivateChat(jid) {
  return /@(s\.whatsapp\.net|lid)$/.test(String(jid || ""));
}

function rtlLines(lines) {
  return lines.map((line) => (line ? `‏${line}` : line)).join("\n");
}

export function planDateKey(now = new Date(), offsetDays = 0) {
  const { year, month, day } = getTimeZoneParts(now, TIME_ZONE);
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return date.toISOString().slice(0, 10);
}

function localHour(now) {
  return getTimeZoneParts(now, TIME_ZONE).hour;
}

function timeOn(dateKey, hour, minute) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return zonedTimeToUtc(year, month, day, hour, minute, 0, TIME_ZONE);
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString("ar-JO", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
}

function taskLine(task, index) {
  const mark = task.done ? "✅" : "⬜";
  const time = task.time ? `${formatTime(task.time)} · ` : "";
  return `${index + 1}. ${mark} ${time}${task.done ? `~${task.text}~` : task.text}`;
}

function pendingTasks(plan) {
  return plan.tasks.map((task, index) => ({ task, index })).filter(({ task }) => !task.done);
}

function formatPlan(plan, title) {
  const done = plan.tasks.filter((task) => task.done).length;
  return rtlLines([
    `📋 *${title}* (${done}/${plan.tasks.length} خلصت)`,
    "",
    ...plan.tasks.map(taskLine)
  ]);
}

// ============================================
// تحليل الخطة من الكلام
// ============================================

const DAY_PREFIX = /^(?:خطتي|خطه|خطة|جدولي|برنامجي)?\s*(اليوم|بكره|بكرا|بكرة|غدا|بعد بكره)?\s*(?:خطتي|برنامجي|جدولي)?\s*[:：-]?\s*/;
const INTENT_PREFIX = /^(?:انا\s+)?(?:بدي|ودي|لازم|رح|راح|ناوي|حابب|عندي|بدنا)\s+/;
const TIME_RE = /(?:(?:على|ع|عال|ال)?\s*ساع[هة]\s*|\b(?:at)\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:و\s*(نص|ربع))?\s*(الصبح|صباحا|الصباح|ص|الظهر|ظهرا|العصر|عصرا|المغرب|المسا|مساء|مساءا|م|بالليل|الليل|ليلا)?/;

function parseClock(segment) {
  const match = normalize(segment).match(TIME_RE);
  if (!match) return null;
  const [whole, hourText, minuteText, fraction, period] = match;
  // رقم لحاله (مثل "اشتري 2 خبز") مش وقت
  if (!/ساع/.test(whole) && !minuteText && !period) return null;
  let hour = Number(hourText);
  let minute = minuteText ? Number(minuteText) : 0;
  if (fraction) minute += fraction === "ربع" ? 15 : 30;
  if (hour > 23 || minute > 59) return null;
  const pm = period && /(الظهر|ظهرا|العصر|عصرا|المغرب|المسا|مساء|مساءا|^م$|بالليل|الليل|ليلا)/.test(period);
  if (pm && hour < 12) hour += 12;
  if (period && /(الصبح|صباحا|الصباح|^ص$)/.test(period) && hour === 12) hour = 0;
  // "الساعة 3" بدون صباح/مسا: من 1 لـ 7 غالبًا بعد الظهر
  if (!period && hour >= 1 && hour <= 7) hour += 12;
  return { hour, minute, whole };
}

function dayOffsetFrom(word) {
  if (!word) return 0;
  if (word.startsWith("بعد")) return 2;
  return /بكر|غدا/.test(word) ? 1 : 0;
}

/** بدون ذكاء اصطناعي: سطر أو فاصلة أو "وبعدين" = مهمة جديدة، و"الساعة 5" بأي مهمة = وقتها. */
export function parsePlanText(input) {
  let text = normalize(input);
  const prefix = text.match(DAY_PREFIX);
  const dayOffset = dayOffsetFrom(prefix?.[1]);
  text = text.slice(prefix?.[0].length || 0).replace(INTENT_PREFIX, "");
  const segments = String(text)
    .split(/\n|،|,|؛|;|\s+(?:وبعدين|بعدين|وبعدها|بعدها|ثم|وكمان)\s+|\s*(?:^|\s)\d+[.)-]\s+/)
    .map((part) => part.replace(/^[-•*▪️\s]+/, "").replace(INTENT_PREFIX, "").trim())
    .filter(Boolean);
  const tasks = segments.map((segment) => {
    const clock = parseClock(segment);
    const label = clock ? segment.replace(clock.whole, " ") : segment;
    return {
      text: label.replace(/\s+/g, " ").replace(/^(و|ب|ع)\s+/, "").trim().slice(0, MAX_TEXT),
      clock: clock ? { hour: clock.hour, minute: clock.minute } : null
    };
  }).filter((task) => task.text);
  return { dayOffset, tasks };
}

function aiInstruction(todayKey, nowTime) {
  return [
    "You turn a WhatsApp message (Arabic, usually Jordanian dialect) into a day plan / to-do list.",
    `Today is ${todayKey}, current local time ${nowTime} (${TIME_ZONE}).`,
    "is_plan: true only when the user is listing things they want or need to do today or tomorrow (or explicitly asks to add to their plan). Casual chat or a question is false.",
    "day: today or tomorrow (بكرة/غدا = tomorrow; default today).",
    "tasks: one item per separate thing to do, in the user's order. text = short Arabic description of the task without the time.",
    "time: 24h HH:MM when the user gave a time for that task, else null. Convert words: الصبح/صباحًا = morning, الظهر ≈ 12:00-14:00, العصر ≈ 15:30, المغرب ≈ 17:30 (approximate when only a part of day is given), بالليل/المسا = evening. A bare small hour like \"الساعة 4\" usually means 16:00.",
    "Return JSON only: {\"is_plan\":true,\"day\":\"today\",\"tasks\":[{\"text\":\"أروح عالبنك\",\"time\":\"10:00\"},{\"text\":\"أخلص التقرير\",\"time\":null}]}"
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

/** يرجع { isPlan, dayOffset, tasks:[{text, clock}] } من رد الذكاء، أو null إذا الرد مش صالح. */
export function parseAIPlan(raw) {
  const data = parseJson(raw);
  if (!data || !Array.isArray(data.tasks)) return null;
  const tasks = data.tasks.map((task) => {
    const text = String(task?.text || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
    const match = String(task?.time || "").match(/^(\d{1,2}):(\d{2})$/);
    const clock = match && Number(match[1]) <= 23 && Number(match[2]) <= 59 ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
    return text ? { text, clock } : null;
  }).filter(Boolean);
  return { isPlan: data.is_plan !== false && tasks.length > 0, dayOffset: data.day === "tomorrow" ? 1 : 0, tasks };
}

export async function extractPlan(text, sender, { now = new Date(), ai = generateSamBotAIFromParts, aiAvailable = isSamBotAIAvailable, quota = consumeAssistantQuota, requireIntent = false } = {}) {
  if (aiAvailable()) {
    const allowed = sender ? (await quota(sender).catch(() => ({ allowed: false }))).allowed : true;
    if (allowed) {
      try {
        const raw = await ai({ systemInstruction: aiInstruction(planDateKey(now), formatTime(now)), parts: [{ text: String(text).slice(0, 1500) }], json: true, temperature: 0, maxOutputTokens: 800 });
        const parsed = parseAIPlan(raw);
        if (parsed) return parsed;
      } catch (error) {
        console.warn("Plan AI parsing failed:", error.message);
      }
    }
  }
  const parsed = parsePlanText(text);
  // من الكلام الطبيعي بدون ذكاء: لازم يكون واضح إنها خطة (أكثر من مهمة أو مهمة بوقت)
  const isPlan = parsed.tasks.length > 0 && (!requireIntent || parsed.tasks.length > 1 || parsed.tasks.some((task) => task.clock));
  return { isPlan, ...parsed };
}

// ============================================
// التخزين
// ============================================

async function loadPlan(userJid, dateKey, model = DailyPlan) {
  return model.findOne({ userJid, dateKey }).lean();
}

async function savePlan(plan, fields, model = DailyPlan) {
  await model.updateOne({ _id: plan._id }, { $set: fields });
}

/** يضيف مهام لخطة يوم (بينشئها إذا مش موجودة). */
export async function addTasksToPlan(userJid, dayOffset, rawTasks, { now = new Date(), model = DailyPlan } = {}) {
  const dateKey = planDateKey(now, dayOffset);
  const tasks = rawTasks.map(({ text, clock }) => {
    const time = clock ? timeOn(dateKey, clock.hour, clock.minute) : null;
    // مهمة وقتها فات لحظة الإضافة ما بتنذكر
    const past = Boolean(time && time <= now);
    return { text, time, done: false, doneAt: null, remindedAt: past ? now : null, followedUpAt: past ? now : null, snoozeUntil: null };
  });
  const byTime = (a, b) => (a.time && b.time ? a.time - b.time : a.time ? -1 : b.time ? 1 : 0);
  const existing = await loadPlan(userJid, dateKey, model);
  if (!existing) {
    const sorted = [...tasks].sort(byTime).slice(0, MAX_TASKS);
    const lateStart = dayOffset === 0 && localHour(now) >= MIDDAY_HOUR;
    const created = await model.create({
      userJid,
      dateKey,
      tasks: sorted,
      // خطة انعملت بعد الظهر ما بدها تذكير "نص اليوم"، وخطة اليوم نفسه ما بدها رسالة الصبح
      middaySentAt: lateStart ? now : null,
      morningSentAt: dayOffset === 0 ? now : null
    });
    return { plan: { ...(created.toObject?.() || created), tasks: sorted }, added: sorted.length, dateKey };
  }
  const room = Math.max(0, MAX_TASKS - existing.tasks.length);
  const merged = [...existing.tasks, ...tasks.slice(0, room)];
  await savePlan(existing, { tasks: merged }, model);
  return { plan: { ...existing, tasks: merged }, added: Math.min(room, tasks.length), dateKey };
}

function dayTitle(dateKey, now) {
  if (dateKey === planDateKey(now)) return "خطتك اليوم";
  if (dateKey === planDateKey(now, 1)) return "خطتك بكرة";
  return `خطتك ${dateKey}`;
}

function nextTaskLine(plan) {
  const next = pendingTasks(plan)[0];
  if (!next) return "🎉 خلصت كل خطتك، عاش!";
  return `➡️ الجاي: ${next.task.time ? `${formatTime(next.task.time)} · ` : ""}${next.task.text}`;
}

async function markDone(plan, index, now, model) {
  const task = plan.tasks[index];
  if (!task) return null;
  const fields = { [`tasks.${index}.done`]: true, [`tasks.${index}.doneAt`]: now };
  if (plan.awaiting?.kind === "task" && plan.awaiting.index === index) fields.awaiting = { kind: null, index: null, at: null };
  await savePlan(plan, fields, model);
  const tasks = plan.tasks.map((t, i) => (i === index ? { ...t, done: true, doneAt: now } : t));
  return { ...plan, tasks };
}

// ============================================
// الأوامر
// ============================================

const COMMANDS = [
  { names: ["خطه بكره", "خطه بكرا", "خطة بكرة"], action: "addTomorrow" },
  { names: ["خطتي بكره", "خطتي بكرا"], action: "showTomorrow" },
  { names: ["خطتي", "جدولي"], action: "show" },
  { names: ["خطه", "اضف للخطه", "ضيف للخطه"], action: "add" },
  { names: ["خلصت", "خلصت مهمه"], action: "done" },
  { names: ["حذف من الخطه", "شيل من الخطه"], action: "remove" },
  { names: ["انقل لبكره", "انقل الباقي لبكره"], action: "move" },
  { names: ["امسح الخطه", "الغاء الخطه"], action: "clear" }
];

export function matchDailyPlanCommand(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("/")) return null;
  const value = normalize(raw.slice(1).replace(/_/g, " "));
  let best = null;
  for (const command of COMMANDS) {
    for (const name of command.names.map(normalize)) {
      if ((value === name || value.startsWith(`${name} `)) && (!best || name.length > best.name.length)) best = { name, action: command.action };
    }
  }
  if (!best) return null;
  const args = raw.slice(1).replace(/_/g, " ").trim().split(/\s+/).slice(best.name.split(" ").length).join(" ").trim();
  return { action: best.action, args };
}

const PLAN_HELP = rtlLines([
  "📋 *خطة اليوم*",
  "احكيلي شو بدك تعمل وأنا برتبها وبذكرك وبتابع معك:",
  "▪️ /خطة أروح عالبنك الساعة 10، أخلص التقرير، أتصل بأحمد العصر",
  "▪️ /خطة_بكرة ... لخطة بكرة",
  "▪️ /خطتي — شو خلص وشو ضل",
  "▪️ خلصت 2 — لما تخلص مهمة (أو بس: خلصت)",
  "▪️ /انقل_لبكرة — الباقي بينتقل لبكرة",
  "▪️ /حذف_من_الخطة <رقم> · /امسح_الخطة"
]);

function confirmText(plan, added, dateKey, now) {
  const timed = plan.tasks.some((task) => task.time && !task.done);
  return [
    formatPlan(plan, dayTitle(dateKey, now)),
    "",
    rtlLines([
      added ? `✍️ ضفت ${added} ${added === 1 ? "مهمة" : "مهام"}.` : "⚠️ الخطة مليانة، ما ضفت اشي جديد.",
      timed ? "⏰ بذكرك بوقت كل مهمة وبسألك إذا خلصتها." : "⏰ بذكرك بنص اليوم وآخره بشو ضل.",
      "لما تخلص اشي احكيلي *خلصت* أو *خلصت 2*."
    ])
  ].join("\n");
}

async function runCommand(sock, jid, sender, action, args, { now, model, extractOptions }) {
  const reply = (text) => sock.sendMessage(jid, { text });
  const today = planDateKey(now);
  switch (action) {
    case "add":
    case "addTomorrow": {
      if (!args) return reply(PLAN_HELP);
      const parsed = await extractPlan(action === "addTomorrow" ? `بكرة ${args}` : args, sender, { now, ...extractOptions });
      const dayOffset = action === "addTomorrow" ? 1 : parsed.dayOffset;
      if (!parsed.tasks.length) return reply(PLAN_HELP);
      const { plan, added, dateKey } = await addTasksToPlan(sender, dayOffset, parsed.tasks, { now, model });
      return reply(confirmText(plan, added, dateKey, now));
    }
    case "show":
    case "showTomorrow": {
      const dateKey = action === "showTomorrow" || /بكر|غدا/.test(normalize(args)) ? planDateKey(now, 1) : today;
      const plan = await loadPlan(sender, dateKey, model);
      if (!plan || !plan.tasks.length) return reply(`📭 ما في خطة ${dateKey === today ? "لليوم" : "لبكرة"}.\n\n${PLAN_HELP}`);
      return reply(`${formatPlan(plan, dayTitle(dateKey, now))}\n\n${rtlLines([nextTaskLine(plan)])}`);
    }
    case "done": {
      const plan = await loadPlan(sender, today, model);
      if (!plan || !plan.tasks.length) return reply("📭 ما في خطة لليوم. ابدأ بـ /خطة");
      return resolveDone(sock, jid, plan, args, now, model);
    }
    case "remove": {
      const plan = await loadPlan(sender, today, model);
      const index = Number(normalize(args).match(/\d+/)?.[0]) - 1;
      if (!plan || !plan.tasks[index]) return reply("❌ رقم غير صحيح. شوف الأرقام بـ /خطتي");
      const tasks = plan.tasks.filter((_, i) => i !== index);
      await savePlan(plan, { tasks, awaiting: { kind: null, index: null, at: null } }, model);
      return reply(`🗑️ شلت: ${plan.tasks[index].text}`);
    }
    case "move":
      return moveToTomorrow(sock, jid, sender, now, model);
    case "clear": {
      const plan = await loadPlan(sender, today, model);
      if (!plan) return reply("📭 ما في خطة لليوم أصلًا.");
      await model.deleteOne({ _id: plan._id });
      return reply("🧹 مسحت خطة اليوم.");
    }
    default:
      return null;
  }
}

async function resolveDone(sock, jid, plan, args, now, model) {
  const reply = (text) => sock.sendMessage(jid, { text });
  const value = normalize(args);
  const pending = pendingTasks(plan);
  if (!pending.length) return reply("🎉 كل مهام اليوم خالصة أصلًا!");
  if (/(الكل|كلهم|كلها|all)/.test(value)) {
    const fields = { awaiting: { kind: null, index: null, at: null } };
    for (const { index } of pending) Object.assign(fields, { [`tasks.${index}.done`]: true, [`tasks.${index}.doneAt`]: now });
    await savePlan(plan, fields, model);
    return reply(`🎉 عاش! خلصت كل خطة اليوم (${plan.tasks.length} مهام).`);
  }
  let index = null;
  const number = value.match(/\d+/);
  if (number) index = Number(number[0]) - 1;
  else if (plan.awaiting?.kind === "task" && now - new Date(plan.awaiting.at) < AWAITING_WINDOW && plan.tasks[plan.awaiting.index] && !plan.tasks[plan.awaiting.index].done) index = plan.awaiting.index;
  else if (pending.length === 1) index = pending[0].index;
  else {
    const reminded = pending.filter(({ task }) => task.remindedAt);
    if (reminded.length === 1) index = reminded[0].index;
  }
  if (index === null) {
    return reply(rtlLines(["👌 أي وحدة خلصت؟ رد بـ *خلصت* ورقمها:", ...pending.map(({ task, index: i }) => taskLine(task, i))]));
  }
  const task = plan.tasks[index];
  if (!task) return reply("❌ رقم غير صحيح. شوف الأرقام بـ /خطتي");
  if (task.done) return reply(`ℹ️ "${task.text}" مخلصة من قبل.\n${nextTaskLine(plan)}`);
  const updated = await markDone(plan, index, now, model);
  const left = pendingTasks(updated).length;
  return reply(rtlLines([`👏 عاش! خلصت: ${task.text}`, left ? `ضايلك ${left} من ${updated.tasks.length}.` : "", nextTaskLine(updated)].filter(Boolean)));
}

async function moveToTomorrow(sock, jid, sender, now, model) {
  const plan = await loadPlan(sender, planDateKey(now), model);
  const pending = plan ? pendingTasks(plan) : [];
  if (!pending.length) return sock.sendMessage(jid, { text: "👌 ما ضل اشي ينتقل لبكرة." });
  // الوقت بينتقل لنفس الساعة بكرة
  const raw = pending.map(({ task }) => {
    if (!task.time) return { text: task.text, clock: null };
    const { hour, minute } = getTimeZoneParts(new Date(task.time), TIME_ZONE);
    return { text: task.text, clock: { hour, minute } };
  });
  const { plan: next, dateKey } = await addTasksToPlan(sender, 1, raw, { now, model });
  await savePlan(plan, { tasks: plan.tasks.filter((task) => task.done), awaiting: { kind: null, index: null, at: null } }, model);
  return sock.sendMessage(jid, { text: `➡️ نقلت ${raw.length} ${raw.length === 1 ? "مهمة" : "مهام"} لبكرة.\n\n${formatPlan(next, dayTitle(dateKey, now))}` });
}

export async function handleDailyPlanCommand(sock, jid, sender, text, { now = new Date(), model = DailyPlan, extractOptions = {} } = {}) {
  const matched = matchDailyPlanCommand(text);
  if (!matched) return false;
  // الخطة شخصية، فبالقروب الرد بيروح عالخاص
  const target = isPrivateChat(jid) ? jid : sender;
  try {
    await runCommand(sock, target, sender, matched.action, matched.args, { now, model, extractOptions });
    if (target !== jid) await sock.sendMessage(jid, { text: "📩 بعتلك على الخاص." });
  } catch (error) {
    console.error("Daily plan command failed:", error.message);
    await sock.sendMessage(jid, { text: "❌ صار خطأ، جرب مرة ثانية." });
  }
  return true;
}

// ============================================
// الردود الطبيعية بالخاص: "خلصت"، "لسا"، "انقل"، و"بكرة بدي..."
// ============================================

const DONE_RE = /^(?:تم|تمت|خلصت|خلصتها|خلصته|خلصتهم|خلصنا|خلص|انتهيت|خلصت منها|done)(?:\s+(.*))?$/;
const LATER_RE = /^(?:لا\s+)?(?:لسا|لسه|لسى|مش هلا|مش هلق|بعدين|اجلها|اجله|اجل|بعد شوي)(?:\s+(.*))?$/;
const MOVE_RE = /^(?:انقل|انقلها|انقلهم|اه انقل|اه|ايوا|ايوه|نعم|ماشي|اوكي|ok)$/;
const NATURAL_PLAN_RE = /^(?:(?:خطتي|خطه|جدولي|برنامجي)\s+)?(?:اليوم|بكره|بكرا|غدا|بعد بكره)?\s*(?:انا\s+)?(?:بدي|لازم|رح|ناوي|عندي|بدنا)\s+/;
const PLAN_WORD_RE = /^(?:خطتي|خطه|جدولي|برنامجي)\s+(?:اليوم|بكره|بكرا|غدا)/;

function snoozeMs(rest) {
  const value = normalize(rest);
  const number = Number(value.match(/\d+/)?.[0] || 0);
  if (/ساع/.test(value)) return (number || 1) * HOUR;
  if (/نص/.test(value)) return 30 * MINUTE;
  if (/ربع/.test(value)) return 15 * MINUTE;
  if (number && /(دقيق|دقايق|د\b)/.test(value)) return number * MINUTE;
  return DEFAULT_SNOOZE;
}

/** رد على سؤال سام ("خلصت؟"، "انقل لبكرة؟"). بيرجع true إذا الرسالة كانت رد على الخطة. */
export async function handleDailyPlanReply(sock, jid, sender, text, { now = new Date(), model = DailyPlan } = {}) {
  if (!isPrivateChat(jid)) return false;
  const value = normalize(text);
  if (!value || value.length > 60 || value.startsWith("/")) return false;
  const isDone = DONE_RE.test(value);
  const isLater = LATER_RE.test(value);
  const isMove = MOVE_RE.test(value);
  if (!isDone && !isLater && !isMove) return false;

  const plan = await loadPlan(sender, planDateKey(now), model);
  if (!plan || !plan.tasks.length) return false;
  const awaiting = plan.awaiting?.kind && now - new Date(plan.awaiting.at) < AWAITING_WINDOW ? plan.awaiting : null;

  try {
    if (isMove) {
      if (awaiting?.kind !== "move") return false;
      await moveToTomorrow(sock, jid, sender, now, model);
      return true;
    }
    if (isLater) {
      if (awaiting?.kind !== "task") return false;
      const task = plan.tasks[awaiting.index];
      if (!task || task.done) return false;
      const until = new Date(now.getTime() + snoozeMs(value.match(LATER_RE)?.[1] || ""));
      await savePlan(plan, { [`tasks.${awaiting.index}.snoozeUntil`]: until, [`tasks.${awaiting.index}.followedUpAt`]: null, awaiting: { kind: null, index: null, at: null } }, model);
      await sock.sendMessage(jid, { text: `👌 ماشي، برجع بذكرك بـ "${task.text}" الساعة ${formatTime(until)}.` });
      return true;
    }
    // "خلصت" لحالها بدون سؤال مفتوح وبدون مهام فات وقتها: يمكن مش عن الخطة
    const rest = value.match(DONE_RE)?.[1] || "";
    const relevant = awaiting?.kind === "task" || /\d|الكل|كلهم|كلها/.test(rest) || pendingTasks(plan).some(({ task }) => task.remindedAt);
    if (!relevant) return false;
    await resolveDone(sock, jid, plan, rest, now, model);
    return true;
  } catch (error) {
    console.error("Daily plan reply failed:", error.message);
    return false;
  }
}

/** "بكرة بدي أروح عالبنك الساعة 10 وأخلص التقرير" بالخاص بتصير خطة. */
export async function handleNaturalDailyPlan(sock, jid, sender, text, { now = new Date(), model = DailyPlan, extractOptions = {} } = {}) {
  if (!isPrivateChat(jid)) return false;
  const value = normalize(text);
  if (!value || value.startsWith("/") || value.length > 1500) return false;
  if (!NATURAL_PLAN_RE.test(value) && !PLAN_WORD_RE.test(value)) return false;
  // "بدي" لحالها كثير بتيجي بالدردشة؛ لازم يوم أو كلمة خطة أو أكثر من سطر
  if (!/^(?:خطتي|خطه|جدولي|برنامجي|اليوم|بكره|بكرا|غدا|بعد بكره)/.test(value) && !String(text).includes("\n")) return false;
  try {
    const parsed = await extractPlan(text, sender, { now, requireIntent: true, ...extractOptions });
    if (!parsed.isPlan || !parsed.tasks.length) return false;
    const { plan, added, dateKey } = await addTasksToPlan(sender, parsed.dayOffset, parsed.tasks, { now, model });
    await sock.sendMessage(jid, { text: confirmText(plan, added, dateKey, now) });
    return true;
  } catch (error) {
    console.error("Natural daily plan failed:", error.message);
    return false;
  }
}

// ============================================
// المتابعة التلقائية (كل 30 ثانية مع التذكيرات)
// ============================================

/** يبعت رسالة واحدة لكل خطة بالدورة الواحدة: تذكير مهمة، متابعة، الصبح، نص اليوم، أو آخر اليوم. */
export async function runDailyPlanTick(sock, now = new Date(), { model = DailyPlan } = {}) {
  const today = planDateKey(now);
  const hour = localHour(now);
  const plans = await model.find({ dateKey: today }).limit(500).lean();
  let sent = 0;
  for (const plan of plans) {
    try {
      const message = nextPlanMessage(plan, now, hour);
      if (!message) continue;
      // نحجز الرسالة قبل الإرسال حتى ما تنبعت مرتين
      await savePlan(plan, message.fields, model);
      await sock.sendMessage(plan.userJid, { text: message.text });
      sent += 1;
    } catch (error) {
      console.warn(`Daily plan ${plan._id} tick failed:`, error.message);
    }
  }
  return sent;
}

export function nextPlanMessage(plan, now, hour = localHour(now)) {
  const pending = pendingTasks(plan);
  const ask = (index) => ({ kind: "task", index, at: now });

  // 1) مهمة إجا وقتها (أو خلص التأجيل)
  const due = pending.find(({ task }) => task.time && new Date(task.time) <= now && (!task.remindedAt || (task.snoozeUntil && new Date(task.snoozeUntil) <= now)));
  if (due) {
    return {
      fields: { [`tasks.${due.index}.remindedAt`]: now, [`tasks.${due.index}.snoozeUntil`]: null, [`tasks.${due.index}.followedUpAt`]: null, awaiting: ask(due.index) },
      text: rtlLines([`⏰ هلأ وقت: *${due.task.text}*`, "خلصتها؟ رد بـ *خلصت* أو *لسا* (أو لسا ساعة)."])
    };
  }

  // 2) متابعة إذا ما رد بعد ساعة
  const silent = pending.find(({ task }) => task.remindedAt && !task.followedUpAt && !task.snoozeUntil && now - new Date(task.remindedAt) >= FOLLOW_UP_AFTER);
  if (silent && hour < EVENING_HOUR) {
    return {
      fields: { [`tasks.${silent.index}.followedUpAt`]: now, awaiting: ask(silent.index) },
      text: rtlLines([`👀 شو صار مع "${silent.task.text}"؟ خلصتها؟`, "رد بـ *خلصت* أو *لسا*."])
    };
  }

  // 3) الصبح: خطة انعملت من مبارح
  if (!plan.morningSentAt && hour >= MORNING_HOUR && hour < MIDDAY_HOUR && pending.length) {
    return {
      fields: { morningSentAt: now },
      text: `${rtlLines(["☀️ صباح الخير! هاي خطتك اليوم:"])}\n${formatPlan(plan, "خطتك اليوم")}`
    };
  }

  // 4) نص اليوم
  if (!plan.middaySentAt && hour >= MIDDAY_HOUR && hour < EVENING_HOUR && pending.length) {
    const done = plan.tasks.length - pending.length;
    return {
      fields: { middaySentAt: now },
      text: rtlLines([
        `🕐 صرنا بنص اليوم! خلصت ${done} من ${plan.tasks.length}.`,
        "ضايلك:",
        ...pending.map(({ task, index }) => taskLine(task, index)),
        "لا تنسى 💪"
      ])
    };
  }

  // 5) آخر اليوم: ملخص وعرض نقل الباقي
  if (!plan.eveningSentAt && hour >= EVENING_HOUR && plan.tasks.length) {
    const done = plan.tasks.length - pending.length;
    const lines = pending.length
      ? [`🌙 ملخص اليوم: خلصت ${done} من ${plan.tasks.length}.`, "ما خلص:", ...pending.map(({ task, index }) => taskLine(task, index)), "بدك أنقلهم لبكرة؟ رد بـ *انقل*."]
      : [`🌙 يومك خلص وخلصت كل خطتك (${plan.tasks.length} مهام). عاش! 🎉`];
    return {
      fields: { eveningSentAt: now, awaiting: pending.length ? { kind: "move", index: null, at: now } : { kind: null, index: null, at: null } },
      text: rtlLines(lines)
    };
  }
  return null;
}
