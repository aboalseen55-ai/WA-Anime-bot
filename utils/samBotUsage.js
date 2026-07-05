import { GoogleGenerativeAI } from "@google/generative-ai";
import SamBotUsage from "../database/samBotUsageModel.js";
import { isDeveloper } from "./kingdomService.js";

const TIME_ZONE = process.env.SAM_BOT_USAGE_TIMEZONE || "Asia/Amman";
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const USAGE_COMMANDS = new Set([
  "/استهلاك_الذكاء",
  "/استخدام_الذكاء",
  "/رصيد_الذكاء",
  "/ai_usage",
  "/ai_quota",
  "/gemini_usage"
]);
const COUNT_TOKEN_COMMANDS = new Set([
  "/عد_التوكن",
  "/عد_التوكنات",
  "/احسب_التوكن",
  "/احسب_التوكنات",
  "/count_tokens",
  "/token_count"
]);

let geminiClient;

function getDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function readTokenCount(source, names) {
  for (const name of names) {
    const value = source?.[name];
    const number = toPositiveNumber(value);
    if (number) return number;
  }
  return 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatPercent(value) {
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

function truncateError(errorMessage) {
  return String(errorMessage || "").replace(/\s+/g, " ").trim().slice(0, 400);
}

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

function getModelName() {
  return process.env.SAM_BOT_AI_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

export async function recordSamBotAIUsage({ modelName, usageMetadata, success, errorMessage }) {
  const promptTokens = readTokenCount(usageMetadata, [
    "promptTokenCount",
    "totalInputTokens",
    "total_input_tokens",
    "inputTokenCount",
    "input_tokens"
  ]);
  const completionTokens = readTokenCount(usageMetadata, [
    "candidatesTokenCount",
    "totalOutputTokens",
    "total_output_tokens",
    "outputTokenCount",
    "output_tokens"
  ]);
  const thinkingTokens = readTokenCount(usageMetadata, [
    "thoughtsTokenCount",
    "thinkingTokenCount",
    "totalThoughtTokens",
    "total_thought_tokens",
    "thought_tokens"
  ]);
  const cachedTokens = readTokenCount(usageMetadata, [
    "cachedContentTokenCount",
    "totalCachedTokens",
    "total_cached_tokens",
    "cached_tokens"
  ]);
  const toolUseTokens = readTokenCount(usageMetadata, [
    "toolUsePromptTokenCount",
    "toolUseTokenCount",
    "totalToolUseTokens",
    "total_tool_use_tokens",
    "tool_use_tokens"
  ]);
  const totalTokens = readTokenCount(usageMetadata, [
    "totalTokenCount",
    "totalTokens",
    "total_tokens"
  ]) || promptTokens + completionTokens + thinkingTokens + cachedTokens + toolUseTokens;

  await SamBotUsage.updateOne(
    {
      dateKey: getDateKey(),
      provider: "gemini",
      model: modelName || "unknown"
    },
    {
      $inc: {
        requests: 1,
        successfulRequests: success ? 1 : 0,
        failedRequests: success ? 0 : 1,
        promptTokens,
        completionTokens,
        totalTokens,
        thinkingTokens,
        cachedTokens,
        toolUseTokens
      },
      $set: {
        lastUsedAt: new Date(),
        lastError: success ? "" : truncateError(errorMessage)
      }
    },
    { upsert: true }
  );
}

async function getTodayUsage() {
  const dateKey = getDateKey();
  const rows = await SamBotUsage.find({ dateKey, provider: "gemini" }).lean();

  return rows.reduce((summary, row) => {
    summary.requests += row.requests || 0;
    summary.successfulRequests += row.successfulRequests || 0;
    summary.failedRequests += row.failedRequests || 0;
    summary.promptTokens += row.promptTokens || 0;
    summary.completionTokens += row.completionTokens || 0;
    summary.totalTokens += row.totalTokens || 0;
    summary.thinkingTokens += row.thinkingTokens || 0;
    summary.cachedTokens += row.cachedTokens || 0;
    summary.toolUseTokens += row.toolUseTokens || 0;
    summary.models.add(row.model || "unknown");
    if (row.lastUsedAt && (!summary.lastUsedAt || row.lastUsedAt > summary.lastUsedAt)) {
      summary.lastUsedAt = row.lastUsedAt;
    }
    if (row.lastError) summary.lastError = row.lastError;
    return summary;
  }, {
    dateKey,
    requests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    thinkingTokens: 0,
    cachedTokens: 0,
    toolUseTokens: 0,
    models: new Set(),
    lastUsedAt: null,
    lastError: ""
  });
}

function buildRemainingLine(used, limit, label) {
  if (!limit) return `• ${label}: غير محدد في Railway`;

  const remaining = Math.max(0, limit - used);
  const remainingPercent = limit ? (remaining / limit) * 100 : 0;
  return `• ${label}: ${formatNumber(remaining)} متبقي من ${formatNumber(limit)} (${formatPercent(remainingPercent)})`;
}

export async function buildSamBotUsageReport() {
  const usage = await getTodayUsage();
  const requestLimit = toPositiveNumber(process.env.SAM_BOT_AI_DAILY_REQUEST_LIMIT);
  const tokenLimit = toPositiveNumber(process.env.SAM_BOT_AI_DAILY_TOKEN_LIMIT);
  const models = [...usage.models].filter(Boolean).join(", ") || "لا يوجد";

  let message = `📊 *استهلاك ذكاء سام بوت اليوم*\n`;
  message += `التاريخ: ${usage.dateKey} (${TIME_ZONE})\n`;
  message += `المزود: Gemini\n`;
  message += `الموديلات: ${models}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `• الطلبات: ${formatNumber(usage.requests)}\n`;
  message += `• الناجحة: ${formatNumber(usage.successfulRequests)}\n`;
  message += `• الفاشلة: ${formatNumber(usage.failedRequests)}\n`;
  message += `• Tokens input: ${formatNumber(usage.promptTokens)}\n`;
  message += `• Tokens output: ${formatNumber(usage.completionTokens)}\n`;
  message += `• Tokens thinking: ${formatNumber(usage.thinkingTokens)}\n`;
  message += `• Tokens cached: ${formatNumber(usage.cachedTokens)}\n`;
  message += `• Tokens tool-use: ${formatNumber(usage.toolUseTokens)}\n`;
  message += `• Tokens total: ${formatNumber(usage.totalTokens)}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `${buildRemainingLine(usage.requests, requestLimit, "الطلبات اليومية")}\n`;
  message += `${buildRemainingLine(usage.totalTokens, tokenLimit, "التوكنات اليومية")}\n`;

  if (!requestLimit && !tokenLimit) {
    message += `\nملاحظة: النسبة تقديرية وتحتاج ضبط SAM_BOT_AI_DAILY_REQUEST_LIMIT أو SAM_BOT_AI_DAILY_TOKEN_LIMIT في Railway.`;
  }

  if (usage.lastError) {
    message += `\n\nآخر خطأ: ${usage.lastError}`;
  }

  return message.trim();
}

async function countGeminiTokens(text) {
  const client = getGeminiClient();
  if (!client) {
    return { ok: false, message: "❌ Gemini غير مفعل. أضف GEMINI_API_KEY أو GOOGLE_API_KEY." };
  }

  const modelName = getModelName();
  const model = client.getGenerativeModel({ model: modelName });
  const result = await model.countTokens(text);
  return {
    ok: true,
    modelName,
    totalTokens: result.totalTokens || 0,
    totalBillableCharacters: result.totalBillableCharacters || 0
  };
}

export async function handleSamBotTokenCountCommand(sock, jid, sender, trimmedText) {
  const parts = String(trimmedText || "").trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();
  if (!COUNT_TOKEN_COMMANDS.has(command)) return false;

  if (!isDeveloper(sender)) {
    await sock.sendMessage(jid, { text: "❌ هذا الأمر خاص بالمطور فقط." });
    return true;
  }

  const text = String(trimmedText || "").slice(parts[0].length).trim();
  if (!text) {
    await sock.sendMessage(jid, {
      text: "استخدم الأمر بهذا الشكل:\n/عد_التوكن النص الذي تريد حسابه"
    });
    return true;
  }

  try {
    const count = await countGeminiTokens(text);
    if (!count.ok) {
      await sock.sendMessage(jid, { text: count.message });
      return true;
    }

    let message = `🧮 *عدّ التوكنات قبل الإرسال*\n`;
    message += `الموديل: ${count.modelName}\n`;
    message += `• input tokens: ${formatNumber(count.totalTokens)}\n`;
    if (count.totalBillableCharacters) {
      message += `• billable characters: ${formatNumber(count.totalBillableCharacters)}\n`;
    }
    message += `\nهذا العدّ للمدخلات فقط، أما output/thinking/cached/tool-use فتظهر بعد الرد داخل /رصيد_الذكاء.`;

    await sock.sendMessage(jid, { text: message.trim() });
  } catch (error) {
    await sock.sendMessage(jid, { text: `❌ تعذر حساب التوكنات: ${error.message}` });
  }

  return true;
}

export async function handleSamBotUsageCommand(sock, jid, sender, trimmedText) {
  const command = String(trimmedText || "").split(/\s+/)[0].toLowerCase();
  if (!USAGE_COMMANDS.has(command)) return false;

  if (!isDeveloper(sender)) {
    await sock.sendMessage(jid, { text: "❌ هذا الأمر خاص بالمطور فقط." });
    return true;
  }

  await sock.sendMessage(jid, { text: await buildSamBotUsageReport() });
  return true;
}
