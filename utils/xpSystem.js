import crypto from "crypto";
import { displayRank, updateUserRank } from "../commands/rankSystem.js";

const MIN_CHAT_TEXT_LENGTH = 2;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const CHAT_XP = 1;
const GAME_XP_PER_POINT = 5;
const MAX_GAME_XP_PER_WIN = 15;

export function rankStarsForLevel(level) {
  const safeLevel = Math.max(0, Number(level) || 0);
  return Math.floor((14 * safeLevel * safeLevel) + (10 * safeLevel));
}

export function xpForLevel(level) {
  const safeLevel = Math.max(0, Number(level) || 0);
  return Math.floor((25 * safeLevel * safeLevel) + (75 * safeLevel));
}

export function calculateLevelFromXp(xp) {
  const safeXp = Math.max(0, Number(xp) || 0);
  let level = 0;

  while (xpForLevel(level + 1) <= safeXp) {
    level += 1;
  }

  return level;
}

export function getLevelProgress(user) {
  const xp = Math.max(0, Number(user?.xp) || 0);
  const level = calculateLevelFromXp(xp);
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const earnedInLevel = xp - currentLevelXp;
  const neededForLevel = Math.max(1, nextLevelXp - currentLevelXp);
  const remaining = Math.max(0, nextLevelXp - xp);
  const percent = Math.min(100, Math.floor((earnedInLevel / neededForLevel) * 100));

  return {
    xp,
    level,
    currentLevelXp,
    nextLevelXp,
    earnedInLevel,
    neededForLevel,
    remaining,
    percent
  };
}

function normalizeActivityText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hashText(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function isValidChatXpText(text) {
  const normalized = normalizeActivityText(text);
  if (!normalized || normalized.startsWith("/")) return false;
  if (normalized.length < MIN_CHAT_TEXT_LENGTH) return false;
  if (/^[^\p{L}\p{N}]+$/u.test(normalized)) return false;
  return true;
}

function applyXp(user, amount, source) {
  const safeAmount = Math.max(0, Number(amount) || 0);
  if (!safeAmount) {
    user.level = calculateLevelFromXp(user.xp || 0);
    return { awardedXp: 0, leveledUp: false, oldLevel: user.level, newLevel: user.level };
  }

  const oldXp = Number(user.xp) || 0;
  const oldLevel = calculateLevelFromXp(oldXp);
  const newXp = oldXp + safeAmount;
  const newLevel = calculateLevelFromXp(newXp);

  user.xp = newXp;
  user.level = newLevel;
  if (source === "chat") user.chatXp = (Number(user.chatXp) || 0) + safeAmount;
  if (source === "game") user.gameXp = (Number(user.gameXp) || 0) + safeAmount;

  const rankStarsUpdate = syncRankStarsFromLevel(user, oldLevel, newLevel);

  return {
    awardedXp: safeAmount,
    leveledUp: newLevel > oldLevel,
    oldLevel,
    newLevel,
    rankStarsUpdate
  };
}

export function syncRankStarsFromLevel(user, oldLevel = null, newLevel = null) {
  const kingdom = user?.kingdom_id;
  if (!user || !kingdom) {
    return { changed: false, oldStars: 0, newStars: 0, addedStars: 0, rankUpdate: null };
  }

  const resolvedNewLevel = Number.isFinite(Number(newLevel))
    ? Math.max(0, Number(newLevel) || 0)
    : calculateLevelFromXp(user.xp || 0);

  if (!user.rankStarsByKingdom) user.rankStarsByKingdom = {};
  if (!user.rankStarsLevelByKingdom) user.rankStarsLevelByKingdom = {};

  const currentStars = Math.max(0, Number(user.rankStarsByKingdom[kingdom]) || 0);
  const storedSyncedLevel = Number(user.rankStarsLevelByKingdom[kingdom]);
  const hasStoredSyncedLevel = Number.isFinite(storedSyncedLevel);
  const resolvedOldLevel = hasStoredSyncedLevel
    ? Math.max(0, storedSyncedLevel)
    : Math.max(0, Number(oldLevel) || 0);

  let nextStars = currentStars;
  let addedStars = 0;

  if (!hasStoredSyncedLevel) {
    nextStars = Math.max(currentStars, rankStarsForLevel(resolvedNewLevel));
    addedStars = Math.max(0, nextStars - currentStars);
  } else if (resolvedNewLevel > resolvedOldLevel) {
    addedStars = rankStarsForLevel(resolvedNewLevel) - rankStarsForLevel(resolvedOldLevel);
    nextStars = currentStars + Math.max(0, addedStars);
  }

  user.rankStarsLevelByKingdom[kingdom] = Math.max(resolvedNewLevel, resolvedOldLevel);
  if (typeof user.markModified === "function") {
    user.markModified("rankStarsLevelByKingdom");
  }

  if (nextStars !== currentStars) {
    user.rankStarsByKingdom[kingdom] = nextStars;
    user.dailyRankStarsEarned = (Number(user.dailyRankStarsEarned) || 0) + Math.max(0, nextStars - currentStars);
    if (typeof user.markModified === "function") {
      user.markModified("rankStarsByKingdom");
    }
  }

  const rankUpdate = updateUserRank(user, kingdom);

  return {
    changed: nextStars !== currentStars,
    oldStars: currentStars,
    newStars: nextStars,
    addedStars: Math.max(0, nextStars - currentStars),
    rankUpdate,
    displayRank: rankUpdate?.newRank ? displayRank(kingdom, rankUpdate.newRank) : ""
  };
}

export function trackChatActivity(user, text, now = new Date()) {
  user.totalMessages = (Number(user.totalMessages) || 0) + 1;
  user.lastActivityAt = now;

  if (!isValidChatXpText(text)) {
    const level = calculateLevelFromXp(user.xp || 0);
    user.level = level;
    return { awardedXp: 0, leveledUp: false, oldLevel: level, newLevel: level };
  }

  const normalized = normalizeActivityText(text);
  const currentHash = hashText(normalized);
  const lastXpAt = user.lastXpAt ? new Date(user.lastXpAt).getTime() : 0;
  const isDuplicate = user.lastXpTextHash === currentHash && (now.getTime() - lastXpAt) < DUPLICATE_WINDOW_MS;

  if (isDuplicate) {
    const level = calculateLevelFromXp(user.xp || 0);
    user.level = level;
    return { awardedXp: 0, leveledUp: false, oldLevel: level, newLevel: level };
  }

  user.lastXpAt = now;
  user.lastXpTextHash = currentHash;
  return applyXp(user, CHAT_XP, "chat");
}

export function awardGameXp(user, pointsAwarded = 1) {
  const safePoints = Math.max(1, Number(pointsAwarded) || 1);
  const xp = Math.min(MAX_GAME_XP_PER_WIN, safePoints * GAME_XP_PER_POINT);
  const result = applyXp(user, xp, "game");
  user.dailyGameAnswers = (Number(user.dailyGameAnswers) || 0) + 1;
  user.dailyGameXp = (Number(user.dailyGameXp) || 0) + result.awardedXp;
  return result;
}

export function buildLevelUpMessage(user, progress) {
  let message = `🎉 ارتقى ${user.nickname} إلى المستوى ${progress.newLevel}!\n✨ XP: ${user.xp}`;

  if (progress.rankStarsUpdate?.changed) {
    message += `\n🎖️ +${progress.rankStarsUpdate.addedStars} نجوم رتبة`;
    message += `\n🎖️ المجموع: ${progress.rankStarsUpdate.newStars}`;
  }

  if (progress.rankStarsUpdate?.rankUpdate?.changed && progress.rankStarsUpdate.displayRank) {
    message += `\n👑 رتبة جديدة: ${progress.rankStarsUpdate.displayRank}`;
  }

  return message;
}

export function formatLevelProgress(user) {
  const progress = getLevelProgress(user);
  return {
    ...progress,
    progressBar: buildProgressBar(progress.percent)
  };
}

function buildProgressBar(percent) {
  const filled = Math.max(0, Math.min(10, Math.floor(percent / 10)));
  return `${"■".repeat(filled)}${"□".repeat(10 - filled)}`;
}
