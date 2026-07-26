import crypto from "crypto";

const MIN_CHAT_TEXT_LENGTH = 2;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const CHAT_XP = 1;
const GAME_XP_PER_POINT = 5;
const MAX_GAME_XP_PER_WIN = 15;

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

  return {
    awardedXp: safeAmount,
    leveledUp: newLevel > oldLevel,
    oldLevel,
    newLevel
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
  return applyXp(user, xp, "game");
}

export function buildLevelUpMessage(user, progress) {
  return `🎉 ارتقى ${user.nickname} إلى المستوى ${progress.newLevel}!\n✨ XP: ${user.xp}`;
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
