import axios from "axios";

const DEFAULT_MODEL = "eleven_multilingual_v2";

export function isElevenLabsConfigured() {
  return Boolean(String(process.env.ELEVENLABS_API_KEY || "").trim() && String(process.env.ELEVENLABS_VOICE_ID || "").trim());
}

export async function createRomanticVoiceNote(text) {
  const apiKey = String(process.env.ELEVENLABS_API_KEY || "").trim();
  const voiceId = String(process.env.ELEVENLABS_VOICE_ID || "").trim();
  if (!apiKey || !voiceId || !text) return null;

  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        text: String(text).slice(0, 500),
        model_id: process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true
        }
      },
      {
        responseType: "arraybuffer",
        timeout: 20000,
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg"
        }
      }
    );

    return response.data?.byteLength ? Buffer.from(response.data) : null;
  } catch (error) {
    console.warn(`⚠️ ElevenLabs request failed: ${error.message}`);
    return null;
  }
}
