import QuranReminderLog from "../database/quranReminderLogModel.js";
import { KINGDOMS } from "../config.js";

const QURAN_API_BASE = "https://api.alquran.cloud/v1";
const QURAN_CDN_BASE = "https://cdn.islamic.network/quran";
const DEFAULT_TEXT_EDITION = process.env.QURAN_TEXT_EDITION || "quran-uthmani";
const DEFAULT_AUDIO_EDITION = process.env.QURAN_AUDIO_EDITION || "ar.alafasy";
const DEFAULT_AUDIO_BITRATE = process.env.QURAN_AUDIO_BITRATE || "128";
const DEFAULT_TIME_ZONE = process.env.QURAN_REMINDER_TIMEZONE || "Asia/Amman";
const REMINDER_HOUR = Number(process.env.QURAN_REMINDER_HOUR ?? 9);
const REMINDER_MINUTE = Number(process.env.QURAN_REMINDER_MINUTE ?? 0);
const REMINDER_ENABLED = String(process.env.QURAN_REMINDER_ENABLED || "true").trim().toLowerCase() !== "false";
const REMINDER_GROUP_SCOPE = String(process.env.QURAN_REMINDER_GROUP_SCOPE || "all").trim().toLowerCase();
const MAX_SURAH_PREVIEW_AYAHS = 5;

const quranReminderTimers = new Map();
const QURAN_MODE_WORDS = new Set([
  "صوت",
  "تلاوه",
  "تلاوة",
  "استماع",
  "audio",
  "صوره",
  "صورة",
  "image",
  "ايه",
  "اية",
  "آيه",
  "آية",
  "سوره",
  "سورة"
]);
const QURAN_AUDIO_WORDS = new Set(["صوت", "تلاوه", "تلاوة", "استماع", "audio"]);
const QURAN_IMAGE_WORDS = new Set(["صوره", "صورة", "image"]);

const SURAH_NAMES = [
  "الفاتحة", "البقرة", "آل عمران", "النساء", "المائدة", "الأنعام", "الأعراف", "الأنفال", "التوبة", "يونس",
  "هود", "يوسف", "الرعد", "إبراهيم", "الحجر", "النحل", "الإسراء", "الكهف", "مريم", "طه",
  "الأنبياء", "الحج", "المؤمنون", "النور", "الفرقان", "الشعراء", "النمل", "القصص", "العنكبوت", "الروم",
  "لقمان", "السجدة", "الأحزاب", "سبأ", "فاطر", "يس", "الصافات", "ص", "الزمر", "غافر",
  "فصلت", "الشورى", "الزخرف", "الدخان", "الجاثية", "الأحقاف", "محمد", "الفتح", "الحجرات", "ق",
  "الذاريات", "الطور", "النجم", "القمر", "الرحمن", "الواقعة", "الحديد", "المجادلة", "الحشر", "الممتحنة",
  "الصف", "الجمعة", "المنافقون", "التغابن", "الطلاق", "التحريم", "الملك", "القلم", "الحاقة", "المعارج",
  "نوح", "الجن", "المزمل", "المدثر", "القيامة", "الإنسان", "المرسلات", "النبأ", "النازعات", "عبس",
  "التكوير", "الانفطار", "المطففين", "الانشقاق", "البروج", "الطارق", "الأعلى", "الغاشية", "الفجر", "البلد",
  "الشمس", "الليل", "الضحى", "الشرح", "التين", "العلق", "القدر", "البينة", "الزلزلة", "العاديات",
  "القارعة", "التكاثر", "العصر", "الهمزة", "الفيل", "قريش", "الماعون", "الكوثر", "الكافرون", "النصر",
  "المسد", "الإخلاص", "الفلق", "الناس"
];

const DAILY_REMINDERS = [
  "سُبْحَانَ اللهِ وَبِحَمْدِهِ، سُبْحَانَ اللهِ العَظِيمِ.",
  "لَا إِلٰهَ إِلَّا اللهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ المُلْكُ وَلَهُ الحَمْدُ.",
  "اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ.",
  "أَسْتَغْفِرُ اللهَ العَظِيمَ وَأَتُوبُ إِلَيْهِ.",
  "لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللهِ."
];

const SURAH_ALIASES = new Map([
  ["ام الكتاب", 1],
  ["الفاتحه", 1],
  ["البقره", 2],
  ["ال عمران", 3],
  ["آل عمران", 3],
  ["النساء", 4],
  ["المائده", 5],
  ["الانعام", 6],
  ["الاعراف", 7],
  ["الانفال", 8],
  ["التوبه", 9],
  ["الاسراء", 17],
  ["بني اسرائيل", 17],
  ["الكهف", 18],
  ["كهف", 18],
  ["طه", 20],
  ["يس", 36],
  ["ياسين", 36],
  ["ص", 38],
  ["ق", 50],
  ["الرحمن", 55],
  ["الملك", 67],
  ["تبارك", 67],
  ["النبأ", 78],
  ["عم", 78],
  ["الاعلى", 87],
  ["الضحى", 93],
  ["الشرح", 94],
  ["الم نشرح", 94],
  ["الاخلاص", 112],
  ["الفلق", 113],
  ["الناس", 114]
]);

function normalizeArabic(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}\s:]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedWords(text) {
  return normalizeArabic(text).split(/\s+/).filter(Boolean);
}

function includesAnyWord(normalized, words) {
  return normalizedWords(normalized).some((word) => words.has(word));
}

function removeQuranModeWords(normalized) {
  return normalizedWords(normalized).filter((word) => !QURAN_MODE_WORDS.has(word)).join(" ").trim();
}

function getTimeZoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - date.getTime();
}

function zonedTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  const firstUtc = utcGuess - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(new Date(firstUtc), timeZone);
  return new Date(utcGuess - secondOffset);
}

function getDateKey(date, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getNextReminderDate(timeZone) {
  const now = new Date();
  const parts = getTimeZoneParts(now, timeZone);
  const hour = Number.isFinite(REMINDER_HOUR) ? REMINDER_HOUR : 9;
  const minute = Number.isFinite(REMINDER_MINUTE) ? REMINDER_MINUTE : 0;
  let target = zonedTimeToUtc(parts.year, parts.month, parts.day, hour, minute, 0, timeZone);

  if (target <= now) {
    target = zonedTimeToUtc(parts.year, parts.month, parts.day + 1, hour, minute, 0, timeZone);
  }

  return target;
}

function getSurahNumber(input) {
  const normalized = normalizeArabic(input).replace(/^سوره\s+/, "");
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 114) return numeric;

  if (SURAH_ALIASES.has(normalized)) return SURAH_ALIASES.get(normalized);

  const index = SURAH_NAMES.findIndex((name) => normalizeArabic(name) === normalized);
  return index >= 0 ? index + 1 : null;
}

function parseAyahReference(input) {
  const normalized = normalizeArabic(input);

  if (/(ايه الكرسي|اية الكرسي|آية الكرسي)/.test(input) || normalized.includes("ايه الكرسي")) {
    return { surah: 2, ayah: 255 };
  }

  const colonMatch = normalized.match(/(\d{1,3})\s*:\s*(\d{1,3})/);
  if (colonMatch) {
    return { surah: Number(colonMatch[1]), ayah: Number(colonMatch[2]) };
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  const firstNumber = words.find((word) => /^\d+$/.test(word));
  const secondNumber = words.filter((word) => /^\d+$/.test(word))[1];
  if (firstNumber && secondNumber) {
    return { surah: Number(firstNumber), ayah: Number(secondNumber) };
  }

  return null;
}

function parseQuranRequest(text) {
  const raw = String(text || "").trim();
  const args = raw
    .replace(/^\/?(قرآن|قران|quran)(?:\s|$)/i, "")
    .replace(/^\//, "")
    .replace(/_/g, " ")
    .trim();
  const normalized = normalizeArabic(args);

  if (!args) return { type: "help" };
  if (/(عشوائي|عشوائيه|random)/.test(normalized)) return { type: "random" };

  const wantsAudio = includesAnyWord(normalized, QURAN_AUDIO_WORDS);
  const wantsImage = includesAnyWord(normalized, QURAN_IMAGE_WORDS);
  const cleaned = removeQuranModeWords(normalized);

  const ayah = parseAyahReference(args) || parseAyahReference(cleaned);
  if (ayah) {
    return {
      type: wantsImage ? "ayah_image" : wantsAudio ? "ayah_audio" : "ayah",
      ...ayah
    };
  }

  const surah = getSurahNumber(cleaned || args);
  if (surah) {
    return {
      type: wantsImage ? "surah_image" : wantsAudio ? "surah_audio" : "surah",
      surah
    };
  }

  return { type: "unknown", query: args };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!response.ok) throw new Error(`Quran API failed: ${response.status}`);
  const json = await response.json();
  if (json.code && json.code >= 400) throw new Error(json.status || "Quran API error");
  return json.data;
}

async function getAyah(surah, ayah, edition = DEFAULT_TEXT_EDITION) {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114 || !Number.isInteger(ayah) || ayah < 1) {
    throw new Error("invalid_ayah");
  }

  return fetchJson(`${QURAN_API_BASE}/ayah/${surah}:${ayah}/${edition}`);
}

async function getRandomAyah() {
  const globalAyah = Math.floor(Math.random() * 6236) + 1;
  return fetchJson(`${QURAN_API_BASE}/ayah/${globalAyah}/${DEFAULT_TEXT_EDITION}`);
}

async function getSurah(surah) {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) throw new Error("invalid_surah");
  return fetchJson(`${QURAN_API_BASE}/surah/${surah}/${DEFAULT_TEXT_EDITION}`);
}

function formatAyahMessage(ayah, title = "آية من القرآن الكريم") {
  const surahName = ayah?.surah?.name || "";
  const surahNumber = ayah?.surah?.number;
  const ayahNumber = ayah?.numberInSurah;

  return [
    `۞ *${title}* ۞`,
    "",
    `﴿ ${ayah.text} ﴾`,
    "",
    `سورة ${surahName}${surahNumber ? ` (${surahNumber}:${ayahNumber})` : ""}`,
    "",
    "نسأل الله أن يجعل القرآن نورًا لقلوبنا."
  ].join("\n");
}

function formatSurahPreviewMessage(surah) {
  const ayahs = (surah.ayahs || []).slice(0, MAX_SURAH_PREVIEW_AYAHS);
  const body = ayahs.map((ayah) => `﴿ ${ayah.text} ﴾ (${ayah.numberInSurah})`).join("\n\n");

  return [
    `۞ *سورة ${surah.name}* ۞`,
    `عدد الآيات: ${surah.numberOfAyahs}`,
    "",
    body,
    "",
    `للاستماع اكتب: /قرآن صوت ${surah.name}`
  ].join("\n");
}

function getAyahAudioUrl(globalAyahNumber) {
  return `${QURAN_CDN_BASE}/audio/${DEFAULT_AUDIO_BITRATE}/${DEFAULT_AUDIO_EDITION}/${globalAyahNumber}.mp3`;
}

function getSurahAudioUrl(surah) {
  return `${QURAN_CDN_BASE}/audio-surah/${DEFAULT_AUDIO_BITRATE}/${DEFAULT_AUDIO_EDITION}/${surah}.mp3`;
}

function getAyahImageUrl(surah, ayah) {
  return `${QURAN_CDN_BASE}/images/high-resolution/${surah}_${ayah}.png`;
}

function buildQuranHelp() {
  return [
    "۞ *أوامر القرآن* ۞",
    "",
    "▪️ /قرآن عشوائي — آية عشوائية",
    "▪️ /قرآن 2:255 — آية محددة",
    "▪️ /قرآن آية الكرسي — آية الكرسي",
    "▪️ /قرآن الكهف — بداية سورة",
    "▪️ /الكهف — اختصار لعرض السورة",
    "▪️ /قرآن صوت الكهف — تلاوة السورة",
    "▪️ /قرآن صوت 2:255 — صوت آية",
    "▪️ /قرآن صورة 2:255 — صورة الآية",
    "",
    "القارئ الافتراضي: مشاري العفاسي."
  ].join("\n");
}

export function isQuranCommand(text) {
  const raw = String(text || "").trim();
  if (/^\/?(قرآن|قران|quran)(?:\s|$)/i.test(raw)) return true;
  if (!raw.startsWith("/")) return false;

  const normalized = normalizeArabic(raw.slice(1).replace(/_/g, " "));
  if (normalized === "ايه الكرسي" || normalized === "اية الكرسي") return true;

  const shortcut = removeQuranModeWords(normalized);

  return Boolean(parseAyahReference(normalized) || parseAyahReference(shortcut) || getSurahNumber(shortcut));
}

export async function handleQuranCommand(sock, jid, text) {
  if (!isQuranCommand(text)) return false;

  const request = parseQuranRequest(text);

  try {
    if (request.type === "help") {
      await sock.sendMessage(jid, { text: buildQuranHelp() });
      return true;
    }

    if (request.type === "random") {
      const ayah = await getRandomAyah();
      await sock.sendMessage(jid, { text: formatAyahMessage(ayah, "آية عشوائية") });
      return true;
    }

    if (request.type === "ayah") {
      const ayah = await getAyah(request.surah, request.ayah);
      await sock.sendMessage(jid, { text: formatAyahMessage(ayah) });
      return true;
    }

    if (request.type === "ayah_audio") {
      const ayah = await getAyah(request.surah, request.ayah);
      await sock.sendMessage(jid, { text: formatAyahMessage(ayah, "تلاوة آية") });
      await sock.sendMessage(jid, {
        audio: { url: getAyahAudioUrl(ayah.number) },
        mimetype: "audio/mpeg",
        ptt: false
      });
      return true;
    }

    if (request.type === "ayah_image") {
      const ayah = await getAyah(request.surah, request.ayah);
      await sock.sendMessage(jid, {
        image: { url: getAyahImageUrl(request.surah, request.ayah) },
        caption: formatAyahMessage(ayah, "صورة آية")
      });
      return true;
    }

    if (request.type === "surah") {
      const surah = await getSurah(request.surah);
      await sock.sendMessage(jid, { text: formatSurahPreviewMessage(surah) });
      return true;
    }

    if (request.type === "surah_audio") {
      const surah = await getSurah(request.surah);
      await sock.sendMessage(jid, { text: `۞ *تلاوة سورة ${surah.name}* ۞\nالقارئ: مشاري العفاسي` });
      await sock.sendMessage(jid, {
        audio: { url: getSurahAudioUrl(request.surah) },
        mimetype: "audio/mpeg",
        ptt: false
      });
      return true;
    }

    if (request.type === "surah_image") {
      const surah = await getSurah(request.surah);
      const firstAyah = surah.ayahs?.[0];
      await sock.sendMessage(jid, {
        image: { url: getAyahImageUrl(request.surah, 1) },
        caption: formatAyahMessage(firstAyah, `صورة من سورة ${surah.name}`)
      });
      return true;
    }

    await sock.sendMessage(jid, {
      text: `لم أفهم طلب القرآن.\nجرّب مثلًا: /قرآن الكهف أو /قرآن 2:255`
    });
    return true;
  } catch (error) {
    console.error("Quran command error:", error.message);
    await sock.sendMessage(jid, {
      text: "تعذر جلب طلب القرآن الآن. جرّب بعد قليل."
    });
    return true;
  }
}

function getKingdomTimeZone(kingdomData = {}) {
  return kingdomData.timeZone || kingdomData.timezone || DEFAULT_TIME_ZONE;
}

function getReminderGroups(kingdomData = {}) {
  if (REMINDER_GROUP_SCOPE === "main") {
    return [kingdomData.mainGroup].filter(Boolean);
  }

  const groups = [
    ...(kingdomData.groupIds || []),
    kingdomData.mainGroup,
    kingdomData.receptionGroup,
    kingdomData.workGroup,
    kingdomData.adminGroup
  ].filter((jid) => jid && String(jid).endsWith("@g.us"));

  return [...new Set(groups)];
}

function getDailyReminderText(kingdomId, dateKey) {
  let seed = 0;
  for (const char of `${kingdomId}:${dateKey}`) seed += char.charCodeAt(0);
  const dhikr = DAILY_REMINDERS[seed % DAILY_REMINDERS.length];

  return [
    "۞ *تذكير اليوم* ۞",
    "",
    `﴿ ${dhikr} ﴾`,
    "",
    "اللهم اجعل هذا اليوم خيرًا وبركة."
  ].join("\n");
}

async function sendDailyReminderToGroup(sock, groupJid, kingdomId, dateKey) {
  const reminderText = getDailyReminderText(kingdomId, dateKey);

  try {
    await QuranReminderLog.create({
      groupJid,
      kingdomId,
      dateKey,
      reminderText
    });
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }

  await sock.sendMessage(groupJid, { text: reminderText });
  return true;
}

async function runKingdomQuranReminder(sock, kingdomId) {
  const kingdomData = KINGDOMS[kingdomId];
  if (!kingdomData) return;

  const timeZone = getKingdomTimeZone(kingdomData);
  const dateKey = getDateKey(new Date(), timeZone);
  const groups = getReminderGroups(kingdomData);

  for (const groupJid of groups) {
    try {
      const sent = await sendDailyReminderToGroup(sock, groupJid, kingdomId, dateKey);
      if (sent) await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (error) {
      console.error(`Quran reminder failed for ${groupJid}:`, error.message);
    }
  }
}

export function scheduleDailyQuranReminders(sock) {
  if (!REMINDER_ENABLED) {
    console.log("Quran daily reminders are disabled.");
    return;
  }

  for (const timer of quranReminderTimers.values()) {
    clearTimeout(timer);
  }
  quranReminderTimers.clear();

  function scheduleNext(kingdomId) {
    const kingdomData = KINGDOMS[kingdomId];
    if (!kingdomData) return;

    const timeZone = getKingdomTimeZone(kingdomData);
    const nextDate = getNextReminderDate(timeZone);
    const delay = Math.max(1000, nextDate.getTime() - Date.now());

    console.log(`Quran reminder next run for ${kingdomId}: ${nextDate.toLocaleString("ar-EG", { timeZone })} (${timeZone})`);

    const timer = setTimeout(async () => {
      await runKingdomQuranReminder(sock, kingdomId);
      quranReminderTimers.delete(kingdomId);
      scheduleNext(kingdomId);
    }, delay);

    quranReminderTimers.set(kingdomId, timer);
  }

  for (const kingdomId of Object.keys(KINGDOMS)) {
    scheduleNext(kingdomId);
  }
}
