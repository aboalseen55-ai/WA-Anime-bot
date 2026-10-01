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

/** يعيد { audio: Buffer, mimetype } أو null عند الفشل. */
export async function createVoiceNote(text, { http = axios } = {}) {
  const content = String(text || "").trim().slice(0, getVoiceMaxChars());
  if (!content || !isElevenLabsConfigured()) return null;

  try {
    const response = await http.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env("ELEVENLABS_VOICE_ID"))}`,
      {
        text: content,
        model_id: env("ELEVENLABS_MODEL_ID", DEFAULT_MODEL),
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
