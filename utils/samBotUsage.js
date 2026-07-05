import SamBotUsage from "../database/samBotUsageModel.js";
import { isDeveloper } from "./kingdomService.js";

const TIME_ZONE = process.env.SAM_BOT_USAGE_TIMEZONE || "Asia/Amman";
const USAGE_COMMANDS = new Set([
  "/استهلاك_الذكاء",
  "/استخدام_الذكاء",
  "/رصيد_الذكاء",
  "/ai_usage",
  "/ai_quota",
  "/gemini_usage"
]);

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

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatPercent(value) {
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

function truncateError(errorMessage) {
  return String(errorMessage || "").replace(/\s+/g, " ").trim().slice(0, 400);
}

export async function recordSamBotAIUsage({ modelName, usageMetadata, success, errorMessage }) {
  const promptTokens = toPositiveNumber(usageMetadata?.promptTokenCount);
  const completionTokens = toPositiveNumber(usageMetadata?.candidatesTokenCount);
  const totalTokens = toPositiveNumber(usageMetadata?.totalTokenCount) || promptTokens + completionTokens;

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
        totalTokens
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
