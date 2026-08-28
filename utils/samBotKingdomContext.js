import User from "../database/userModel.js";
import { getCleanMentionTextForUser } from "../commands/adminSystem.js";
import { getKingdomFromGroupJid } from "../config.js";

const DIRECTORY_LIST_LIMIT = 12;
const DIRECTORY_MATCH_LIMIT = 5;
const CONTEXT_LEADER_LIMIT = 3;

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function withoutBotAddressing(value) {
  return normalizeText(value)
    .replace(/(?:^|\s)(?:يا\s+)?سام\s*بوت(?=\s|$)/g, " ")
    .replace(/(?:^|\s)sam\s*bot(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeJid(value) {
  return String(value || "").split(":")[0].toLowerCase();
}

function getJidUser(value) {
  return normalizeJid(value).split("@")[0];
}

function getUserIdentifiers(user) {
  return new Set([
    user.jid,
    user.lid && `${user.lid}@lid`,
    user.rawLid && `${user.rawLid}@lid`,
    user.phoneNumber && `${user.phoneNumber}@s.whatsapp.net`,
    user.lid,
    user.rawLid,
    user.phoneNumber
  ].filter(Boolean).map(normalizeJid));
}

function isUserInGroup(user, participantIds) {
  const identifiers = getUserIdentifiers(user);
  return participantIds.some((participantId) => {
    const normalized = normalizeJid(participantId);
    const userPart = getJidUser(participantId);
    return identifiers.has(normalized)
      || [...identifiers].some((identifier) => getJidUser(identifier) === userPart);
  });
}

async function getGroupParticipantIds(sock, groupJid) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    return metadata.participants
      .map((participant) => participant.id || participant.jid || participant)
      .filter(Boolean);
  } catch (error) {
    console.warn(`⚠️ تعذر قراءة أعضاء المجموعة لسام بوت: ${error.message}`);
    return [];
  }
}

function isDirectoryQuestion(text) {
  const normalized = withoutBotAddressing(text);
  if (/^(?:مين)\s+/.test(normalized)) {
    const target = normalized.replace(/^مين\s+/, "").replace(/^(?:هو|هي)\s+/, "").trim();
    if (target && !["انت", "انتي", "سام", "سام بوت", "معك", "معاكي", "هنا"].includes(target)) {
      return true;
    }
  }

  return /(صاحب(?:ه|ة)?.*لقب|لقب.*مين|مين.*لقب|من هو|من هي|مين هو|مين هي|شو اسمه|ما اسمه|اسم.*لقب|اسماء.*(?:المجموعه|المملكه)|اعضاء.*(?:المجموعه|المملكه)|المسجلين|مين.*(?:بالمجموعه|في المجموعه|بالمملكه|في المملكه))/.test(normalized);
}

function wantsDirectoryList(text) {
  const normalized = withoutBotAddressing(text);
  return /(اسماء.*(?:المجموعه|المملكه)|اعضاء.*(?:المجموعه|المملكه)|المسجلين|مين.*(?:بالمجموعه|في المجموعه|بالمملكه|في المملكه))/.test(normalized);
}

function extractDirectorySearch(text) {
  const normalized = withoutBotAddressing(text);
  const matchers = [
    /(?:صاحب(?:ه|ة)?)\s+(?:لقب|اللقب)\s+(.+)$/,
    /(?:لقب|اللقب)\s+(.+)\s+(?:لمين|لمن|تبع مين|صاحب مين)$/,
    /(?:من هو|من هي|مين هو|مين هي)\s+(.+)$/,
    /(?:شو اسمه|ما اسمه|اسمه|اسمها)\s+(.+)$/,
    /(?:مين)\s+(.+)$/
  ];

  for (const matcher of matchers) {
    const match = normalized.match(matcher);
    if (match?.[1]) {
      const value = match[1]
        .replace(/(?:^|\s)(?:في|ب|المجموعه|المملكه|هاي|هذه|هذي)(?=\s|$)/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (value.length >= 2 && value.length <= 50) return value;
    }
  }

  return "";
}

function formatDisplayName(user) {
  return user.whatsappName || user.nickname || "عضو مسجل";
}

function findMatchingUsers(users, search) {
  const normalizedSearch = normalizeText(search);
  if (!normalizedSearch) return [];

  const exact = users.filter((user) => (
    normalizeText(user.nickname) === normalizedSearch
    || normalizeText(user.whatsappName) === normalizedSearch
  ));
  if (exact.length) return exact;

  return users.filter((user) => (
    normalizeText(user.nickname).includes(normalizedSearch)
    || normalizeText(user.whatsappName).includes(normalizedSearch)
  )).slice(0, DIRECTORY_MATCH_LIMIT);
}

/**
 * Answers direct member-directory questions from MongoDB. It deliberately only
 * considers registered members currently present in the asking group.
 */
export async function resolveSamBotDirectoryQuestion(sock, groupJid, text) {
  if (!String(groupJid || "").endsWith("@g.us") || !isDirectoryQuestion(text)) return null;

  const kingdom = getKingdomFromGroupJid(groupJid);
  if (!kingdom?.id) return null;

  const participantIds = await getGroupParticipantIds(sock, groupJid);
  if (!participantIds.length) return null;

  const registeredUsers = await User.find(
    { kingdom_id: kingdom.id },
    { jid: 1, lid: 1, rawLid: 1, phoneNumber: 1, nickname: 1, whatsappName: 1 }
  ).lean();
  const groupUsers = registeredUsers.filter((user) => isUserInGroup(user, participantIds));

  if (wantsDirectoryList(text)) {
    if (!groupUsers.length) {
      return { text: "ما لقيت أعضاء مسجلين في هذه المجموعة بعد.", mentions: [] };
    }

    const visible = groupUsers
      .sort((a, b) => String(a.nickname).localeCompare(String(b.nickname), "ar"))
      .slice(0, DIRECTORY_LIST_LIMIT);
    const remainder = groupUsers.length - visible.length;
    const names = visible.map((user) => `• ${user.nickname}${user.whatsappName ? ` (${user.whatsappName})` : ""}`);
    if (remainder > 0) names.push(`• وغيرهم ${remainder} عضو.`);

    return {
      text: `المسجلون في هذه المجموعة:\n${names.join("\n")}`,
      mentions: []
    };
  }

  const search = extractDirectorySearch(text);
  if (!search) return null;

  const matches = findMatchingUsers(groupUsers, search);
  if (!matches.length) {
    return { text: `ما لقيت عضوًا مسجلًا باسم أو لقب “${search}” في هذه المجموعة.`, mentions: [] };
  }

  if (matches.length > 1) {
    return {
      text: `لقيت أكثر من عضو قريب من “${search}”:\n${matches.map((user) => `• ${user.nickname}`).join("\n")}`,
      mentions: []
    };
  }

  const user = matches[0];
  // Match the promotion flow exactly: use the member's stored JID as the
  // WhatsApp mention target, never the transient participant LID.
  const mentionJid = user.jid;
  const mention = getCleanMentionTextForUser(user);
  const whatsappName = formatDisplayName(user);

  return {
    text: `صاحب لقب *${user.nickname}* هو ${mention}${whatsappName ? `، واسمه في واتساب: *${whatsappName}*.` : "."}`,
    mentions: mentionJid ? [mentionJid] : [],
    mentionTargetJid: mentionJid || null
  };
}

export function shouldIncludeKingdomContext(text) {
  const normalized = normalizeText(text);
  return /(مملكه|مملكة|اعضاء|أعضاء|ادمن|مشرف|رتب|ترتيب|تفاعل|نشاط|نشيط|نقاط|مستوى|لفل|xp|اكس بي|لقب|اسم|مين|من هو|من هي|استقبال|اداره|ادارة|وورك|اعلانات|إعلانات)/.test(normalized);
}

function formatLeaders(users, field) {
  if (!users.length) return "لا توجد بيانات كافية";
  return users.map((user) => `${user.nickname} (${Number(user[field]) || 0})`).join("، ");
}

/**
 * Returns a compact, public-safe snapshot for Gemini. Private identifiers,
 * phone numbers, invite links, passwords, and audit data never leave MongoDB.
 */
export async function buildSamBotKingdomContext(groupJid, text) {
  if (!shouldIncludeKingdomContext(text)) return "";

  const kingdom = getKingdomFromGroupJid(groupJid);
  if (!kingdom?.id) return "";

  const memberFilter = { kingdom_id: kingdom.id };
  const [membersCount, adminCount, levelLeaders, activityLeaders, gameLeaders] = await Promise.all([
    User.countDocuments(memberFilter),
    User.countDocuments({ ...memberFilter, role: { $in: ["super_admin", "admin", "moderator"] } }),
    User.find(memberFilter, { nickname: 1, level: 1 }).sort({ level: -1, xp: -1 }).limit(CONTEXT_LEADER_LIMIT).lean(),
    User.find(memberFilter, { nickname: 1, totalMessages: 1 }).sort({ totalMessages: -1 }).limit(CONTEXT_LEADER_LIMIT).lean(),
    User.find(memberFilter, { nickname: 1, gameXp: 1 }).sort({ gameXp: -1 }).limit(CONTEXT_LEADER_LIMIT).lean()
  ]);

  const groupTypes = [
    kingdom.mainGroup && "رئيسية",
    kingdom.receptionGroup && "استقبال",
    kingdom.adminGroup && "إدارة",
    kingdom.workGroup && "وورك"
  ].filter(Boolean).join("، ");

  return [
    "بيانات المملكة الموثوقة:",
    `الاسم: ${kingdom.name || kingdom.id}`,
    `الأعضاء المسجلون: ${membersCount}`,
    `الإداريون المسجلون: ${adminCount}`,
    `أنواع المجموعات المضبوطة: ${groupTypes || "الرئيسية"}`,
    `أعلى المستويات: ${formatLeaders(levelLeaders, "level")}`,
    `الأكثر تفاعلاً بالرسائل: ${formatLeaders(activityLeaders, "totalMessages")}`,
    `الأكثر XP في الألعاب: ${formatLeaders(gameLeaders, "gameXp")}`
  ].join("\n");
}
