import { generateSamBotAIJson } from "../utils/samBotAI.js";

const MOODS = new Set(["romantic", "flirty", "shy", "caring", "jealous", "playful"]);
const MAX_REPLY_LENGTH = 320;
const DEFAULT_GIF_PROBABILITY = 0.2;
const DEFAULT_VOICE_PROBABILITY = 0.1;

function clampIntensity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(3, Math.round(number)));
}

function getProbability(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function parseJson(text) {
  const source = String(text || "").trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const match = source.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function defaultGifQuery(mood) {
  const queries = {
    romantic: "romantic hug reaction",
    flirty: "cute flirty reaction",
    shy: "blushing shy reaction",
    caring: "cute caring reaction",
    jealous: "playful jealous reaction",
    playful: "cute playful reaction"
  };
  return queries[mood] || "cute love reaction";
}

function normalizeDecision(value, memory) {
  if (!value || typeof value !== "object") return null;

  const mode = value.mode === "girlfriend" ? "girlfriend" : value.mode === "normal" ? "normal" : null;
  const reply = String(value.reply || "").replace(/\s+/g, " ").trim();
  if (!mode || !reply || reply.length > MAX_REPLY_LENGTH) return null;

  const mood = MOODS.has(value.mood) ? value.mood : (memory?.girlfriendMode?.mood || "romantic");
  const intensity = mode === "girlfriend" ? Math.max(1, clampIntensity(value.intensity)) : 0;
  const wantsGif = mode === "girlfriend" && value.media?.type === "gif";
  const query = String(value.media?.query || defaultGifQuery(mood))
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || defaultGifQuery(mood);

  return {
    mode,
    mood,
    intensity,
    reply,
    media: {
      type: wantsGif ? "gif" : "none",
      query
    },
    voice: mode === "girlfriend" && value.voice === true
  };
}

export async function getRomanceModeDecision({ userMessage, nickname, isPrivate, memory, memoryContext, kingdomContext }) {
  const systemInstruction = [
    "Return exactly one valid JSON object and nothing else.",
    "You are Sam Bot replying in Arabic on WhatsApp.",
    "Use the entire supplied conversation context to decide whether the user is actually flirting or being affectionate, not isolated keywords.",
    "Use mode girlfriend only for clear, mutual, light romantic or playful flirting. Otherwise use normal.",
    "If romance is active and the latest message is a short natural continuation, keep it active while the context remains warm.",
    "Use normal when the conversation clearly returns to a practical or ordinary topic.",
    "For girlfriend mode, keep it warm, playful, feminine-coded, and natural; never explicit or sexual.",
    "Never claim to be human, possessive, exclusive, or emotionally dependent on the user.",
    "Reply in one or two short WhatsApp lines, at most 20 Arabic words.",
    "The required schema is: {\"mode\":\"normal|girlfriend\",\"mood\":\"romantic|flirty|shy|caring|jealous|playful\",\"intensity\":0-3,\"reply\":\"...\",\"media\":{\"type\":\"none|gif\",\"query\":\"English GIF search\"},\"voice\":true|false}.",
    "Only suggest media or voice when it genuinely improves a romantic reply; most replies should use none and false."
  ].join(" ");

  const prompt = [
    `name:${nickname || "-"}`,
    `chat:${isPrivate ? "private" : "group-directed"}`,
    memoryContext ? `memory:\n${memoryContext}` : "",
    kingdomContext ? `kingdom:\n${kingdomContext}` : "",
    `message:${userMessage}`
  ].filter(Boolean).join("\n");

  const raw = await generateSamBotAIJson({
    systemInstruction,
    prompt,
    maxOutputTokens: 80,
    temperature: 0.55
  });

  return normalizeDecision(parseJson(raw), memory);
}

export function buildGirlfriendModeState(decision) {
  if (!decision || decision.mode !== "girlfriend") {
    return { active: false, mood: null, intensity: 0, lastActivatedAt: null };
  }

  return {
    active: true,
    mood: decision.mood,
    intensity: decision.intensity,
    lastActivatedAt: new Date()
  };
}

export function shouldSendRomanticGif(decision) {
  if (decision?.mode !== "girlfriend" || decision.media?.type !== "gif") return false;
  const probability = getProbability(process.env.SAM_BOT_ROMANCE_GIF_PROBABILITY, DEFAULT_GIF_PROBABILITY);
  return Math.random() < probability;
}

export function shouldSendRomanticVoice(decision) {
  if (decision?.mode !== "girlfriend" || !decision.voice) return false;
  const probability = getProbability(process.env.SAM_BOT_ROMANCE_VOICE_PROBABILITY, DEFAULT_VOICE_PROBABILITY);
  return Math.random() < probability;
}
