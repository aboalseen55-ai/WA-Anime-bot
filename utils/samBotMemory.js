import SamBotMemory from "../database/samBotMemoryModel.js";

const MAX_RECENT_TURNS = Number(process.env.SAM_BOT_MEMORY_TURNS || 6);
const MAX_TEXT_LENGTH = 180;
const SUMMARY_MAX_LENGTH = 260;

function trimText(text, limit = MAX_TEXT_LENGTH) {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit - 1).trim()}…`;
}

function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeMemory(memory, nickname) {
  const parts = [];
  if (nickname) parts.push(`اسمه/لقبه: ${nickname}`);
  if (memory?.interactionCount > 0) parts.push(`تحدث مع البوت ${memory.interactionCount} مرة`);
  if (memory?.lastIntent) parts.push(`آخر نية: ${memory.lastIntent}`);

  const summary = parts.join("، ");
  return trimText(summary, SUMMARY_MAX_LENGTH);
}

export async function getSamBotMemory({ groupJid, userJid, kingdomId, nickname }) {
  if (!groupJid || !userJid) return null;

  const set = {};

  if (kingdomId) set.kingdomId = kingdomId;
  if (nickname) set.nickname = nickname;

  return SamBotMemory.findOneAndUpdate(
    { groupJid, userJid },
    {
      $set: set,
      $setOnInsert: {
        groupJid,
        userJid
      }
    },
    {
      returnDocument: "after",
      upsert: true,
      setDefaultsOnInsert: true
    }
  );
}

export function buildSamBotMemoryContext(memory, nickname) {
  if (!memory) return "";

  const recent = (memory.recentTurns || [])
    .slice(-MAX_RECENT_TURNS)
    .map((turn) => `${turn.role === "bot" ? "bot" : "user"}: ${trimText(turn.text, 120)}`)
    .join("\n");

  return [
    `memory: ${memory.summary || summarizeMemory(memory, nickname)}`,
    recent ? `recent:\n${recent}` : ""
  ].filter(Boolean).join("\n");
}

export function getRepeatedSocialReply(memory, intent, nickname) {
  if (!memory || !["greeting", "wellbeing", "ack"].includes(intent)) return "";

  const recentBotText = normalizeForCompare(memory.lastBotReply);
  const recentUserText = normalizeForCompare(memory.lastUserMessage);

  if (intent === "greeting" && /(هلا|اهلا|مرحبا|السلام|وعليكم)/.test(recentBotText)) {
    return memory.interactionCount > 2 ? "نورتِ." : `هلا فيك يا ${nickname}.`;
  }

  if (intent === "wellbeing" && /(كيف|اخبارك|وانت|وانتي)/.test(recentBotText)) {
    return "دوم الحمد لله.";
  }

  if (intent === "ack" && /(تمام|ماشي|واضح)/.test(recentUserText)) {
    return "تمام.";
  }

  return "";
}

export async function rememberSamBotTurn({ memory, groupJid, userJid, kingdomId, nickname, intent, userMessage, botReply }) {
  if (!groupJid || !userJid) return null;

  const target = memory || await getSamBotMemory({ groupJid, userJid, kingdomId, nickname });
  if (!target) return null;

  target.kingdomId = kingdomId || target.kingdomId || null;
  target.nickname = nickname || target.nickname || null;
  target.interactionCount = (Number(target.interactionCount) || 0) + 1;
  target.lastIntent = intent || target.lastIntent || null;
  target.lastUserMessage = trimText(userMessage);
  target.lastBotReply = trimText(botReply);
  target.lastInteractionAt = new Date();
  target.summary = summarizeMemory(target, nickname || target.nickname);

  target.recentTurns = [
    ...(target.recentTurns || []),
    { role: "user", text: trimText(userMessage), intent },
    { role: "bot", text: trimText(botReply), intent }
  ].slice(-MAX_RECENT_TURNS);

  await target.save();
  return target;
}
