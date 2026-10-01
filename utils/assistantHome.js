// واجهة المساعد الشخصي: رسالة التعريف الأولى، /مساعدة، والملخص الصباحي
import AssistantProfile from "../database/assistantProfileModel.js";
import PersonalItem from "../database/personalItemModel.js";
import { featureEnabled, withBotContext } from "../services/botControls.js";
import { isBusinessCustomerChat } from "../services/businessMode.js";
import { DEFAULT_TIME_ZONE, getTimeZoneParts, zonedTimeToUtc } from "./quran.js";
import { localDayKey } from "./assistantQuota.js";

const TIME_ZONE = process.env.PERSONAL_REMINDER_TIMEZONE || DEFAULT_TIME_ZONE;
const DEFAULT_CITY = process.env.ASSISTANT_DEFAULT_CITY || "Amman, Jordan";
const PRAYER_METHOD = process.env.PRAYER_TIMES_METHOD || "23";
const BRIEF_CHECK_MS = 60 * 1000;
const BRIEF_LATE_WINDOW_MS = 3 * 60 * 60 * 1000;

function isPrivateChat(jid) {
  return /@(s\.whatsapp\.net|lid)$/.test(String(jid || ""));
}

function normalize(text) {
  return String(text || "")
    .trim()
    .replace(/_/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// ============================================
// الرسائل
// ============================================

export function buildIntroMessage(name) {
  return [
    `أهلًا${name ? ` ${name}` : ""} 👋 أنا *سام*، مساعدك الشخصي على واتساب.`,
    "",
    "🎙️ ابعتلي أو حوّللي رسالة صوتية، وبرجعلك نصها وخلاصتها",
    "📄 ابعتلي صورة أو ملف PDF، وبطلعلك أهم اللي فيه (واكتب سؤالك مع الصورة لو بدك)",
    "⏰ /ذكرني بكرة الساعة 9 اجتماع",
    "✅ /مهمة و /ملاحظة لترتيب يومك",
    "💬 اسألني أي سؤال أو اطلب مني أكتبلك رسالة",
    "",
    "اكتب /مساعدة لتشوف كل اشي."
  ].join("\n");
}

export function buildMainHelp() {
  return [
    "*🤖 سام: كل اللي بقدر أعمله*",
    "",
    "*💬 بالخاص*",
    "▪️ اكتبلي أي سؤال أو طلب (ترجمة، صياغة رسالة، فكرة…)",
    "▪️ ابعت رسالة صوتية ← نصها وخلاصتها",
    "▪️ ابعت صورة أو PDF ← قراءة وتلخيص (اكتب سؤالك كتعليق)",
    "",
    "*⏰ التذكيرات والمهام*",
    "▪️ /ذكرني بعد 20 دقيقة الفرن",
    "▪️ /ذكرني كل يوم الساعة 8 مساءً الدوا",
    "▪️ /تذكيراتي · /مهمة · /مهامي · /ملاحظة · /ملاحظاتي",
    "▪️ /مساعدي ← شرح كامل للتذكيرات والمهام",
    "",
    "*☀️ الملخص الصباحي*",
    "▪️ /صباحي تشغيل 7 ← كل يوم الساعة 7: مواقيت الصلاة وتذكيراتك ومهامك",
    "▪️ /مدينتي اربد ← لمواقيت الصلاة",
    "▪️ /صباحي ايقاف",
    "",
    "*👥 بالقروبات*",
    "▪️ /ملخص ← شو فاتني؟ ملخص آخر الرسائل",
    "▪️ رد على فويس واكتب /فرغ",
    "▪️ رد على صورة أو PDF واكتب /اقرأ أو /اقرأ <سؤالك>",
    "▪️ نادِ «سام» أو منشن البوت لتسأله",
    "",
    "*🛡️ لمشرفين القروب*",
    "▪️ /حماية ← منع الروابط والسبام",
    "▪️ /نداء <رسالة> ← منشن للكل",
    "▪️ /ذكر_القروب كل جمعة الساعة 12 <النص>",
    "▪️ /تذكيرات_القروب · /الغاء_تذكير_القروب <رقم>",
    "",
    "*📖 وأكثر*",
    "▪️ /قرآن · /ألعاب · /أوامر (القائمة الكاملة)"
  ].join("\n");
}

/** يرسل رسالة التعريف مرة واحدة لكل شخص يراسل البوت بالخاص لأول مرة. لا يوقف معالجة الرسالة. */
export async function handleFirstContact(sock, msg) {
  const jid = msg?.key?.remoteJid;
  if (!jid || msg.key.fromMe || !isPrivateChat(jid)) return false;
  if (!featureEnabled("replies")) return false;
  if (await isBusinessCustomerChat(jid)) return false;

  let isNew = false;
  try {
    const result = await AssistantProfile.updateOne(
      { jid, introducedAt: null },
      { $set: { introducedAt: new Date() } },
      { upsert: true }
    );
    isNew = Boolean(result.upsertedCount || result.modifiedCount);
  } catch (error) {
    if (error?.code !== 11000) console.warn("Assistant intro check failed:", error.message);
    return false;
  }
  if (!isNew) return false;

  await sock.sendMessage(jid, { text: buildIntroMessage(String(msg.pushName || "").slice(0, 40)) });
  return false;
}

// ============================================
// الملخص الصباحي
// ============================================

const prayerCache = new Map();

export async function fetchPrayerTimes(city, now = new Date(), fetchImpl = globalThis.fetch) {
  const { year, month, day } = getTimeZoneParts(now, TIME_ZONE);
  const date = `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
  const cacheKey = `${normalize(city)}|${date}`;
  if (prayerCache.has(cacheKey)) return prayerCache.get(cacheKey);

  try {
    const url = `https://api.aladhan.com/v1/timingsByAddress/${date}?address=${encodeURIComponent(city)}&method=${encodeURIComponent(PRAYER_METHOD)}`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const body = await response.json();
    const timings = body?.data?.timings;
    if (!timings?.Fajr) return null;
    const clean = (value) => String(value || "").split(" ")[0];
    const result = {
      الفجر: clean(timings.Fajr),
      الظهر: clean(timings.Dhuhr),
      العصر: clean(timings.Asr),
      المغرب: clean(timings.Maghrib),
      العشاء: clean(timings.Isha)
    };
    if (prayerCache.size > 200) prayerCache.clear();
    prayerCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.warn("Prayer times fetch failed:", error.message);
    return null;
  }
}

function formatClock(date) {
  return new Date(date).toLocaleTimeString("ar-EG", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
}

export async function buildMorningBrief(profile, { now = new Date(), name = "", fetchImpl } = {}) {
  const city = profile?.brief?.city || DEFAULT_CITY;
  const { year, month, day } = getTimeZoneParts(now, TIME_ZONE);
  const dayEnd = zonedTimeToUtc(year, month, day + 1, 0, 0, 0, TIME_ZONE);

  const gregorian = now.toLocaleDateString("ar-EG", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" });
  let hijri = "";
  try {
    hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { timeZone: TIME_ZONE, day: "numeric", month: "long", year: "numeric" }).format(now);
  } catch {
    hijri = "";
  }

  const [prayers, reminders, todos] = await Promise.all([
    fetchPrayerTimes(city, now, fetchImpl),
    PersonalItem.find({ kind: "reminder", userJid: profile.jid, status: "pending", dueAt: { $lte: dayEnd } }).sort({ dueAt: 1 }).limit(8).lean(),
    PersonalItem.find({ kind: "todo", userJid: profile.jid, done: false }).sort({ createdAt: 1 }).limit(5).lean()
  ]);

  const lines = [`☀️ *صباح الخير${name ? ` ${name}` : ""}*`, `📅 ${gregorian}${hijri ? ` · ${hijri}` : ""}`];
  if (prayers) {
    lines.push("", `🕌 *مواقيت الصلاة* (${city.split(",")[0]})`, Object.entries(prayers).map(([label, time]) => `${label} ${time}`).join(" · "));
  }
  lines.push("", "⏰ *تذكيرات اليوم*");
  lines.push(reminders.length ? reminders.map((item) => `▪️ ${formatClock(item.dueAt)}: ${item.text}`).join("\n") : "ما في تذكيرات اليوم.");
  lines.push("", "✅ *مهامك المفتوحة*");
  lines.push(todos.length ? todos.map((item) => `▫️ ${item.text}`).join("\n") : "ما في مهام مفتوحة. يوم موفق!");
  return lines.join("\n");
}

function parseBriefTime(text) {
  const match = String(text || "").match(/(\d{1,2})(?:[:.](\d{2}))?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

async function getOrCreateProfile(jid) {
  return AssistantProfile.findOneAndUpdate(
    { jid },
    { $setOnInsert: { jid } },
    { upsert: true, new: true }
  ).lean();
}

// ============================================
// الأوامر
// ============================================

const HELP_COMMANDS = new Set(["مساعده", "help", "start", "ابدا"]);

export async function handleAssistantHomeCommand(sock, jid, sender, text, msg) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("/")) return false;
  const normalized = normalize(trimmed.slice(1));
  const [name, ...rest] = normalized.split(" ");
  const args = rest.join(" ");
  const reply = (body) => sock.sendMessage(jid, { text: body });

  if (HELP_COMMANDS.has(name)) {
    await reply(buildMainHelp());
    return true;
  }

  if (name === "مدينتي") {
    const city = trimmed.split(/\s+/).slice(1).join(" ").trim().slice(0, 60);
    if (!city) {
      const profile = await getOrCreateProfile(sender);
      await reply(`🏙️ مدينتك الحالية: ${profile?.brief?.city || DEFAULT_CITY}\nللتغيير: /مدينتي اربد`);
      return true;
    }
    await AssistantProfile.updateOne({ jid: sender }, { $set: { "brief.city": city } }, { upsert: true });
    await reply(`✅ صارت مدينتك: ${city}\nمواقيت الصلاة بالملخص الصباحي رح تكون حسبها.`);
    return true;
  }

  if (name === "صباحي") {
    if (/^(ايقاف|اوقف|الغاء|وقف|off|stop)/.test(args)) {
      await AssistantProfile.updateOne({ jid: sender }, { $set: { "brief.enabled": false } }, { upsert: true });
      await reply("🔕 وقفت الملخص الصباحي. ترجعه بـ /صباحي تشغيل 7");
      return true;
    }

    if (/^(تشغيل|شغل|فعل|on|start)/.test(args)) {
      const time = parseBriefTime(args) || { hour: 7, minute: 0 };
      // إذا الوقت مضى اليوم، أول ملخص يكون بكرة
      const now = new Date();
      const today = getTimeZoneParts(now, TIME_ZONE);
      const passedToday = zonedTimeToUtc(today.year, today.month, today.day, time.hour, time.minute, 0, TIME_ZONE) <= now;
      await AssistantProfile.updateOne(
        { jid: sender },
        { $set: { "brief.enabled": true, "brief.hour": time.hour, "brief.minute": time.minute, "brief.lastSentDay": passedToday ? localDayKey(now) : null } },
        { upsert: true }
      );
      const clock = `${time.hour}:${String(time.minute).padStart(2, "0")}`;
      await reply(`✅ تمام! كل يوم الساعة ${clock} ببعتلك على الخاص مواقيت الصلاة وتذكيراتك ومهامك.\nلتغيير المدينة: /مدينتي اربد\nللإيقاف: /صباحي ايقاف`);
      return true;
    }

    // بدون وسيط: معاينة الآن على الخاص
    const profile = await getOrCreateProfile(sender);
    const brief = await buildMorningBrief(profile, { name: String(msg?.pushName || "").slice(0, 40) });
    const status = profile?.brief?.enabled
      ? `🔔 الملخص مفعّل كل يوم الساعة ${profile.brief.hour}:${String(profile.brief.minute).padStart(2, "0")}.`
      : "💡 لتوصلك هاي الرسالة كل يوم: /صباحي تشغيل 7";
    await sock.sendMessage(sender, { text: `${brief}\n\n${status}` });
    if (!isPrivateChat(jid)) await reply("📩 بعتلك الملخص على الخاص.");
    return true;
  }

  return false;
}

// ============================================
// الجدولة
// ============================================

export async function deliverMorningBriefs(sock, now = new Date(), { fetchImpl } = {}) {
  const day = localDayKey(now);
  const { year, month, day: dayOfMonth } = getTimeZoneParts(now, TIME_ZONE);
  const profiles = await AssistantProfile.find({ "brief.enabled": true, "brief.lastSentDay": { $ne: day } }).limit(200).lean();

  let sent = 0;
  for (const profile of profiles) {
    const due = zonedTimeToUtc(year, month, dayOfMonth, profile.brief.hour, profile.brief.minute, 0, TIME_ZONE);
    if (now < due || now - due > BRIEF_LATE_WINDOW_MS) continue;

    // حجز اليوم قبل الإرسال حتى لا يتكرر بعد إعادة الاتصال
    const claimed = await AssistantProfile.updateOne(
      { _id: profile._id, "brief.lastSentDay": { $ne: day } },
      { $set: { "brief.lastSentDay": day } }
    );
    if (!claimed.modifiedCount) continue;

    try {
      await sock.sendMessage(profile.jid, { text: await buildMorningBrief(profile, { now, fetchImpl }) });
      sent += 1;
    } catch (error) {
      console.warn(`Morning brief for ${profile.jid} failed:`, error.message);
    }
  }
  return sent;
}

let briefTimer = null;
let briefRunning = false;

export function scheduleMorningBriefs(sock, { intervalMs = BRIEF_CHECK_MS } = {}) {
  if (briefTimer) clearInterval(briefTimer);
  const tick = async () => {
    if (briefRunning) return;
    briefRunning = true;
    try {
      if (featureEnabled("automatic") && featureEnabled("reminders")) {
        await withBotContext("automatic", () => deliverMorningBriefs(sock));
      }
    } catch (error) {
      console.warn("Morning briefs interrupted:", error.message);
    } finally {
      briefRunning = false;
    }
  };
  briefTimer = setInterval(tick, intervalMs);
  briefTimer.unref?.();
  return briefTimer;
}
