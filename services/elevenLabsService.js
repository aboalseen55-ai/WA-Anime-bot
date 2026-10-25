// تحويل النص إلى صوت عبر ElevenLabs لإرسال ردود سام كرسائل صوتية
import axios from "axios";

const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "opus_48000_32";

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

export function getVoiceMaxChars() {
  const value = Number(process.env.ELEVENLABS_MAX_CHARS);
  return Number.isFinite(value) && value > 0 ? value : 900;
}

export function getModelId() {
  return env("ELEVENLABS_MODEL_ID", DEFAULT_MODEL);
}

/** موديلات v3 و v4 بتفهم تاجز الأسلوب مثل [softly] و[whispers]، الباقي بيقرأها بصوت عالي. */
export function modelSupportsAudioTags(model = getModelId()) {
  return /^eleven_v[34]/i.test(String(model || ""));
}

/** يحط تاجز الأسلوب قبل النص إذا الموديل بيدعمها. */
export function applyStyleTags(text, styleTags, model = getModelId()) {
  const tags = String(styleTags || "").trim();
  return tags && modelSupportsAudioTags(model) ? `${tags} ${text}` : text;
}

export function isElevenLabsConfigured() {
  return Boolean(env("ELEVENLABS_API_KEY") && env("ELEVENLABS_VOICE_ID"));
}

// رسالة ElevenLabs الفعلية (مثلًا الصوت يحتاج خطة مدفوعة أو الرصيد خلص) بدل "status code 402"
function describeError(error) {
  const data = error.response?.data;
  if (!data) return error.message;
  try {
    const body = JSON.parse(Buffer.from(data).toString("utf8"));
    const detail = body?.detail;
    return (typeof detail === "string" ? detail : detail?.message || detail?.status || JSON.stringify(detail || body)).slice(0, 300);
  } catch {
    return error.message;
  }
}

/** يعيد { audio: Buffer, mimetype } أو null عند الفشل. voiceId = الصوت اللي اختاره المستخدم، وإلا الافتراضي. */
export async function createVoiceNote(text, { http = axios, styleTags = "", voiceId = "" } = {}) {
  const spoken = String(text || "").trim().slice(0, getVoiceMaxChars());
  if (!spoken || !isElevenLabsConfigured()) return null;
  const content = applyStyleTags(spoken, styleTags);

  try {
    const response = await http.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId || env("ELEVENLABS_VOICE_ID"))}`,
      {
        text: content,
        model_id: getModelId(),
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true }
      },
      {
        params: { output_format: env("ELEVENLABS_OUTPUT_FORMAT", DEFAULT_OUTPUT_FORMAT) },
        responseType: "arraybuffer",
        timeout: 30000,
        headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "Content-Type": "application/json", Accept: "audio/ogg" }
      }
    );
    const audio = Buffer.from(response.data);
    if (!audio.length) return null;
    return { audio, mimetype: "audio/ogg; codecs=opus" };
  } catch (error) {
    const status = error.response?.status;
    console.warn(`ElevenLabs TTS failed${status ? ` (${status})` : ""}:`, describeError(error));
    return null;
  }
}

/**
 * رصيد الشهر من ElevenLabs: { used, limit, remaining, resetAt } أو { error: "permission" | "failed" }.
 * يحتاج المفتاح صلاحية User: Read إذا كان مقيّدًا.
 */
export async function getElevenLabsUsage({ http = axios } = {}) {
  if (!isElevenLabsConfigured()) return { error: "not_configured" };
  try {
    const { data } = await http.get("https://api.elevenlabs.io/v1/user/subscription", {
      timeout: 15000,
      headers: { "xi-api-key": env("ELEVENLABS_API_KEY") }
    });
    const used = Number(data?.character_count) || 0;
    const limit = Number(data?.character_limit) || 0;
    const reset = Number(data?.next_character_count_reset_unix) || 0;
    return { used, limit, remaining: Math.max(0, limit - used), resetAt: reset ? new Date(reset * 1000) : null, tier: data?.tier || "" };
  } catch (error) {
    const status = error.response?.status;
    console.warn(`ElevenLabs usage failed${status ? ` (${status})` : ""}:`, describeError(error));
    return { error: status === 401 || status === 403 ? "permission" : "failed" };
  }
}

// ============================================
// أصوات يختار منها المستخدم: صوتين بنات وصوتين شباب بالعربي
// ============================================

const VOICES_PER_GENDER = 2;
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
let catalogCache = null;

function apiHeaders() {
  return { "xi-api-key": env("ELEVENLABS_API_KEY") };
}

/** ELEVENLABS_VOICE_CHOICES="ليلى|female|voiceId;سامي|male|voiceId" بتثبت الأصوات بدون ما نسأل ElevenLabs. */
export function parseVoiceChoices(value = env("ELEVENLABS_VOICE_CHOICES")) {
  return String(value || "")
    .split(/[;\n]+/)
    .map((row) => row.split("|").map((part) => part.trim()))
    .filter(([name, gender, id]) => name && id && /^(female|male)$/i.test(gender))
    .map(([name, gender, id]) => ({ id, name, gender: gender.toLowerCase(), source: "env" }));
}

function isArabic(voice) {
  const labels = voice?.labels || {};
  const languages = [labels.language, voice?.language, ...(voice?.verified_languages || []).map((l) => l?.language)];
  return languages.some((language) => /^(ar|arabic)$/i.test(String(language || "").trim()));
}

function genderOf(voice) {
  const gender = String(voice?.labels?.gender || voice?.gender || "").toLowerCase();
  return gender === "female" || gender === "male" ? gender : null;
}

function cleanName(name) {
  return String(name || "").split(/\s*[-–|(]/)[0].trim().slice(0, 30) || "صوت";
}

/**
 * 4 أصوات عربية: أول اشي من ELEVENLABS_VOICE_CHOICES، بعدين الأصوات العربية بحساب ElevenLabs،
 * وبعدين الأكثر استخدامًا من مكتبة الأصوات المشتركة (محادثة أو سرد، مناسبة لمساعد شخصي).
 */
export async function getVoiceCatalog({ http = axios, refresh = false, now = Date.now() } = {}) {
  const pinned = parseVoiceChoices();
  if (pinned.length) return pinned;
  if (!isElevenLabsConfigured()) return [];
  if (!refresh && catalogCache && now - catalogCache.at < CATALOG_TTL_MS) return catalogCache.voices;

  const picked = { female: [], male: [] };
  const add = (voice) => {
    const gender = genderOf(voice);
    if (!gender || picked[gender].length >= VOICES_PER_GENDER) return;
    if (picked[gender].some((v) => v.id === voice.voice_id)) return;
    picked[gender].push({
      id: voice.voice_id,
      name: cleanName(voice.name),
      gender,
      previewUrl: voice.preview_url || "",
      ownerId: voice.public_owner_id || "",
      source: voice.public_owner_id ? "library" : "account"
    });
  };

  try {
    const { data } = await http.get("https://api.elevenlabs.io/v1/voices", { timeout: 15000, headers: apiHeaders() });
    (data?.voices || []).filter(isArabic).forEach(add);
  } catch (error) {
    console.warn("ElevenLabs voices list failed:", describeError(error));
  }

  for (const gender of ["female", "male"]) {
    if (picked[gender].length >= VOICES_PER_GENDER) continue;
    try {
      const { data } = await http.get("https://api.elevenlabs.io/v1/shared-voices", {
        timeout: 15000,
        headers: apiHeaders(),
        params: { language: "ar", gender, page_size: 30, sort: "usage_character_count_1y" }
      });
      const voices = (data?.voices || []).filter((voice) => genderOf(voice) === gender);
      // للمساعد: أصوات محادثة أو سرد أول اشي، مش أصوات شخصيات أو إعلانات
      const fits = (voice) => /conversational|narrat|informative|social/i.test(String(voice.use_case || voice.category || ""));
      [...voices.filter(fits), ...voices.filter((voice) => !fits(voice))].forEach(add);
    } catch (error) {
      console.warn(`ElevenLabs shared voices (${gender}) failed:`, describeError(error));
    }
  }

  const voices = [...picked.female, ...picked.male];
  if (voices.length) catalogCache = { at: now, voices };
  return voices;
}

/** صوت من المكتبة المشتركة لازم ينضاف للحساب قبل ما نستعمله. يعيد true إذا صار جاهز. */
export async function ensureVoiceInAccount(voice, { http = axios } = {}) {
  if (!voice?.ownerId || voice.source !== "library") return true;
  try {
    await http.post(
      `https://api.elevenlabs.io/v1/voices/add/${encodeURIComponent(voice.ownerId)}/${encodeURIComponent(voice.id)}`,
      { new_name: `سام ${voice.name}` },
      { timeout: 15000, headers: { ...apiHeaders(), "Content-Type": "application/json" } }
    );
    return true;
  } catch (error) {
    const message = describeError(error);
    // موجود من قبل = تمام
    if (/already|exists/i.test(message)) return true;
    console.warn("ElevenLabs add voice failed:", message);
    return false;
  }
}

export function resetVoiceCatalogCache() {
  catalogCache = null;
}
