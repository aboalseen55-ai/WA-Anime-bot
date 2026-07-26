import { generateSamBotAIJson, isSamBotAIAvailable } from "./samBotAI.js";

const GREETING_ONLY_PATTERN = /^(السلام عليكم|وعليكم السلام|مرحبا|مرحباً|اهلا|أهلا|هلا|هاي|hi|hello|تمام|اوكي|ok|أوكي|يس|yes)$/i;
const SOURCE_KEYWORDS = ["طرف", "دعاني", "جابني", "عرفني", "رشحني", "بواسطة", "عن طريق"];
const NICKNAME_KEYWORDS = ["لقبي", "اللقب", "اسمي", "اسم", "nickname", "nick"];

function cleanExtractedValue(value, maxLength) {
  return String(value || "")
    .replace(/^[\s:：،,.\-_"'«»]+|[\s:：،,.\-_"'«»]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function hasAnyKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function extractByPatterns(text) {
  const sourceMatch = text.match(/(?:من\s+طرف|طرف|دعاني|جابني|عرفني|رشحني|بواسطة|عن\s+طريق)\s*[:：-]?\s*([^،,\n]+?)(?=\s+(?:و?لقبي|و?اسمي|و?اسم)|$)/i);
  const nicknameMatch = text.match(/(?:لقبي|اللقب|اسمي|اسم(?:ي)?|nickname|nick)\s*[:：-]?\s*([^،,\n]+?)(?=\s+(?:ومن\s+طرف|من\s+طرف|طرف|دعاني|جابني|عرفني|بواسطة|عن\s+طريق)|$)/i);

  return {
    source: cleanExtractedValue(sourceMatch?.[1], 50),
    nickname: cleanExtractedValue(nicknameMatch?.[1], 30)
  };
}

function shouldAskAI(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized || GREETING_ONLY_PATTERN.test(normalized)) return false;
  return normalized.split(/\s+/).length >= 4 || hasAnyKeyword(normalized, [...SOURCE_KEYWORDS, ...NICKNAME_KEYWORDS]);
}

export function isReceptionGreetingOnly(text) {
  return GREETING_ONLY_PATTERN.test(String(text || "").trim());
}

function parseJsonObject(reply) {
  const raw = String(reply || "").trim();
  if (!raw) return {};

  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function extractReceptionOnboardingInfo(text) {
  const local = extractByPatterns(text);
  if ((local.source && local.nickname) || !shouldAskAI(text) || !isSamBotAIAvailable()) {
    return local;
  }

  const reply = await generateSamBotAIJson({
    systemInstruction: [
      "استخرج بيانات تسجيل عضو جديد في قروب استقبال واتساب.",
      "أعد JSON فقط بهذا الشكل: {\"source\":\"\",\"nickname\":\"\"}.",
      "source هو جواب: من طرف مين دخل؟",
      "nickname هو اللقب الذي اختاره العضو.",
      "إذا معلومة غير واضحة اتركها فارغة.",
      "لا تخمن ولا تشرح."
    ].join(" "),
    prompt: `message: ${String(text || "").slice(0, 240)}`,
    maxOutputTokens: 40
  });

  const parsed = parseJsonObject(reply);
  return {
    source: local.source || cleanExtractedValue(parsed.source, 50),
    nickname: local.nickname || cleanExtractedValue(parsed.nickname, 30)
  };
}

export async function resolveMainGroupInviteLink(sock, kingdomData) {
  if (kingdomData?.mainGroupInviteLink) return kingdomData.mainGroupInviteLink;
  if (!kingdomData?.mainGroup) return "";

  try {
    const code = await sock.groupInviteCode(kingdomData.mainGroup);
    return code ? `https://chat.whatsapp.com/${code}` : "";
  } catch (error) {
    console.warn(`⚠️ تعذر جلب رابط دعوة القروب الأساسي: ${error.message}`);
    return "";
  }
}
