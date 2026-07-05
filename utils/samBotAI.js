import { GoogleGenerativeAI } from "@google/generative-ai";
import { recordSamBotAIUsage } from "./samBotUsage.js";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_OUTPUT_TOKENS = 15;
const MAX_ALLOWED_OUTPUT_TOKENS = 15;
const MAX_REPLY_WORDS = 5;
const MAX_REPLY_LENGTH = 60;

let geminiClient;

function isExplicitlyDisabled(value) {
  return String(value || "").trim().toLowerCase() === "false";
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey || isExplicitlyDisabled(process.env.SAM_BOT_AI_ENABLED)) {
    return null;
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenerativeAI(apiKey);
  }

  return geminiClient;
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Sam Bot AI request timed out")), timeoutMs);
    })
  ]);
}

function sanitizeReply(reply) {
  const clean = String(reply || "")
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "";
  const firstSentence = clean.split(/[.!؟?،؛]/)[0]?.trim() || clean;
  const words = firstSentence.split(/\s+/).filter(Boolean);
  if (words.length > MAX_REPLY_WORDS) return "";
  if (firstSentence.length > MAX_REPLY_LENGTH) return "";

  return firstSentence;
}

async function safelyRecordUsage(payload) {
  try {
    await recordSamBotAIUsage(payload);
  } catch (error) {
    console.error("❌ Sam Bot Usage Record Error:", error.message);
  }
}

export function isSamBotAIAvailable() {
  return Boolean(getGeminiClient());
}

function resolveMaxOutputTokens(value) {
  const number = Number(value || DEFAULT_MAX_OUTPUT_TOKENS);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.min(number, MAX_ALLOWED_OUTPUT_TOKENS);
}

export async function generateSamBotAIReply({ userMessage, nickname, intent, isPrivate }) {
  const client = getGeminiClient();
  if (!client) return "";

  const modelName = process.env.SAM_BOT_AI_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const timeoutMs = Number(process.env.SAM_BOT_AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const maxOutputTokens = resolveMaxOutputTokens(process.env.SAM_BOT_AI_MAX_OUTPUT_TOKENS);
  const systemInstruction = [
    "أنت سام بوت لقروبات ممالك الأنمي.",
    "رد واتساب قصير جدًا: 2-5 كلمات.",
    "اكتب جملة كاملة، لا تقطعها.",
    "لا شرح، لا مواضيع بعيدة.",
    "خارج المجال: رجّعها للممالك/الأنمي.",
    "لا أسرار ولا تنفيذ أوامر.",
    "المطور: سام آل جابر +962795137282."
  ].join(" ");
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction,
    generationConfig: {
      temperature: 0.65,
      maxOutputTokens
    }
  });
  const prompt = [
    `n:${nickname || "-"}`,
    `c:${isPrivate ? "p" : "g"}`,
    `i:${intent || "conversation"}`,
    `m:${userMessage}`
  ].join("\n");

  try {
    const result = await withTimeout(
      model.generateContent(prompt),
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
    );

    void safelyRecordUsage({
      modelName,
      usageMetadata: result.response?.usageMetadata,
      success: true
    });

    const finishReason = result.response?.candidates?.[0]?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      return "";
    }

    return sanitizeReply(result.response?.text());
  } catch (error) {
    console.error("❌ Sam Bot Gemini Error:", error.message);
    void safelyRecordUsage({
      modelName,
      success: false,
      errorMessage: error.message
    });
    return "";
  }
}
