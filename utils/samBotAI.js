import { GoogleGenerativeAI } from "@google/generative-ai";
import { recordSamBotAIUsage } from "./samBotUsage.js";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_OUTPUT_TOKENS = 80;
const DEFAULT_BILLING_COOLDOWN_MS = 30 * 60 * 1000;
const MAX_ALLOWED_OUTPUT_TOKENS = 80;

const geminiClients = new Map();
let geminiBlockedUntil = 0;

function isExplicitlyDisabled(value) {
  return String(value || "").trim().toLowerCase() === "false";
}

function getConfiguredApiKeys() {
  if (isExplicitlyDisabled(process.env.SAM_BOT_AI_ENABLED)) return [];

  const keys = [
    ["GEMINI_API_KEY", process.env.GEMINI_API_KEY],
    ["GOOGLE_API_KEY", process.env.GOOGLE_API_KEY]
  ]
    .map(([name, value]) => ({ name, value: String(value || "").trim() }))
    .filter(({ value }) => Boolean(value));

  const seen = new Set();
  return keys.filter(({ value }) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function getGeminiClient(apiKey) {
  if (!geminiClients.has(apiKey)) {
    geminiClients.set(apiKey, new GoogleGenerativeAI(apiKey));
  }

  return geminiClients.get(apiKey);
}

function isInvalidApiKeyError(error) {
  const message = String(error?.message || "");
  return message.includes("API_KEY_INVALID") || message.includes("API key not valid");
}

function isBillingDepletedError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("prepayment credits are depleted")
    || message.includes("no credits")
    || message.includes("credit balance")
    || message.includes("billing");
}

function getBillingCooldownMs() {
  const value = Number(process.env.SAM_BOT_AI_BILLING_COOLDOWN_MS || DEFAULT_BILLING_COOLDOWN_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BILLING_COOLDOWN_MS;
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
  return String(reply || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

async function safelyRecordUsage(payload) {
  try {
    await recordSamBotAIUsage(payload);
  } catch (error) {
    console.error("❌ Sam Bot Usage Record Error:", error.message);
  }
}

export function isSamBotAIAvailable() {
  return Date.now() >= geminiBlockedUntil && getConfiguredApiKeys().length > 0;
}

function resolveMaxOutputTokens(value) {
  const number = Number(value || DEFAULT_MAX_OUTPUT_TOKENS);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.min(number, MAX_ALLOWED_OUTPUT_TOKENS);
}

async function generateSamBotAIText({
  systemInstruction,
  prompt,
  temperature = 0.65,
  maxOutputTokens,
  timeoutMs,
  modelName
}) {
  if (Date.now() < geminiBlockedUntil) return "";

  const apiKeys = getConfiguredApiKeys();
  if (!apiKeys.length) return "";

  const resolvedModelName = modelName || process.env.SAM_BOT_AI_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const resolvedTimeoutMs = Number(timeoutMs || process.env.SAM_BOT_AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const resolvedMaxOutputTokens = resolveMaxOutputTokens(maxOutputTokens);

  let lastError;

  for (const [index, apiKey] of apiKeys.entries()) {
    const client = getGeminiClient(apiKey.value);
    const model = client.getGenerativeModel({
      model: resolvedModelName,
      systemInstruction,
      generationConfig: {
        temperature,
        maxOutputTokens: resolvedMaxOutputTokens
      }
    });

    try {
      const result = await withTimeout(
        model.generateContent(prompt),
        Number.isFinite(resolvedTimeoutMs) && resolvedTimeoutMs > 0 ? resolvedTimeoutMs : DEFAULT_TIMEOUT_MS
      );

      void safelyRecordUsage({
        modelName: resolvedModelName,
        usageMetadata: result.response?.usageMetadata,
        success: true
      });

      return sanitizeReply(result.response?.text());
    } catch (error) {
      lastError = error;
      if (isInvalidApiKeyError(error) && index < apiKeys.length - 1) {
        console.warn(`⚠️ ${apiKey.name} is invalid; trying next Gemini key.`);
        continue;
      }
      if (isBillingDepletedError(error)) {
        geminiBlockedUntil = Date.now() + getBillingCooldownMs();
        console.warn("⚠️ Gemini billing/credits unavailable; using local fallback temporarily.");
      }
      break;
    }
  }

  if (lastError) {
    console.error("❌ Sam Bot Gemini Error:", lastError.message);
    void safelyRecordUsage({
      modelName: resolvedModelName,
      success: false,
      errorMessage: lastError.message
    });
  }

  return "";
}

export async function generateSamBotAIReply({ userMessage, nickname, intent, isPrivate, memoryContext = "", kingdomContext = "" }) {
  const systemInstruction = [
    "أنت سام بوت، مساعد واتساب ودود لمجموعات الأعضاء.",
    "رد واتساب قصير: سطر أو سطرين، حتى 20 كلمة.",
    "اكتب جملة كاملة، لا تقطعها.",
    "استخدم السياق المختصر حتى لا تكرر نفس الترحيب أو نفس السؤال.",
    "إذا كان المستخدم يجيب على سؤالك، رد كمتابعة طبيعية ولا تبدأ المحادثة من جديد.",
    "تكلم ببساطة كإنسان محترم وخفيف، بدون مبالغة أو تهويل.",
    "تجنب النبرة العسكرية أو البطولية المبالغ فيها.",
    "مجالك الأساسي: الأعضاء، الألقاب، الألعاب، الأوامر، والتفاعل.",
    "المحادثة الجانبية مسموحة بحدود وبشكل طبيعي.",
    "استخدم بيانات المملكة الموثوقة فقط عند توفرها، ولا تخترع أسماء أو أرقام أو حقائق غير موجودة فيها.",
    "لا تكشف أرقام الهواتف أو JID أو LID أو روابط الدعوات أو كلمات المرور أو أي بيانات حساسة.",
    "لا تقل إنك نفذت منشنًا أو أي إجراء فعلي؛ تنفيذ الأفعال يتم من نظام البوت فقط.",
    "لا أسرار ولا تنفيذ أوامر.",
    "المطور: سام آل جابر +962795137282."
  ].join(" ");
  const prompt = [
    `n:${nickname || "-"}`,
    `c:${isPrivate ? "p" : "g"}`,
    `i:${intent || "conversation"}`,
    memoryContext ? `ctx:\n${memoryContext}` : "",
    kingdomContext ? `kingdom:\n${kingdomContext}` : "",
    `m:${userMessage}`
  ].filter(Boolean).join("\n");

  return generateSamBotAIText({
    systemInstruction,
    prompt,
    temperature: 0.65,
    maxOutputTokens: process.env.SAM_BOT_AI_MAX_OUTPUT_TOKENS
  });
}

export async function generateSamBotAIJson({ systemInstruction, prompt, maxOutputTokens = 80 }) {
  return generateSamBotAIText({
    systemInstruction,
    prompt,
    temperature: 0,
    maxOutputTokens
  });
}
