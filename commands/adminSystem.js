import { dashboardReply } from '../services/dashboardTemplates.js';
import User from "../database/userModel.js";
import { renderBotTemplate } from '../services/dashboardTemplates.js';
import Bank from "../database/bankModel.js";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { getHighestRank, getRankInfo, displayRank, getAllRanksDisplay, kingdomRanks } from "./rankSystem.js";
import { ADMINS, getKingdomFromGroupJid, getKingdomIdFromGroupJid, KINGDOMS, WELCOME_LINK } from "../config.js";

const REGION_DISPLAY_NAMES = typeof Intl === 'object' && typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

function getDisplayRankInfo(kingdom, rankKey, fallbackName = 'بدون رتبة') {
    if (!rankKey) return { name: fallbackName, emoji: '' };

    const roleNames = {
        member: { name: 'عضو', emoji: '👤' },
        moderator: { name: 'مشرف', emoji: '🔰' },
        admin: { name: 'أدمن', emoji: '👑' },
        super_admin: { name: 'أدمن رئيسي', emoji: '👑' }
    };

    if (roleNames[rankKey]) return roleNames[rankKey];

    const rankInfo = getRankInfo(kingdom || 'clover', rankKey) || getRankInfo('clover', rankKey);
    if (rankInfo) return rankInfo;

    return { name: 'رتبة غير معروفة', emoji: '' };
}

function formatDisplayRank(kingdom, rankKey, fallbackName = 'بدون رتبة') {
    const rankInfo = getDisplayRankInfo(kingdom, rankKey, fallbackName);
    return `${rankInfo.emoji ? `${rankInfo.emoji} ` : ''}${rankInfo.name}`;
}

function defaultIdentifierMetadata() {
  return {
    identifierType: 'unknown',
    jid: null,
    phoneNumber: null,
    lid: null,
    rawLid: null,
    countryCode: null,
    countryName: null,
    mention: null
  };
}

function parsePhoneMeta(value) {
  if (!value) return { valid: false };
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return { valid: false };

  try {
    const parsed = parsePhoneNumberFromString(`+${digits}`);
    if (!parsed || !parsed.isValid()) {
      return { valid: false };
    }

    const phoneNumber = String(parsed.nationalNumber || '').replace(/\D/g, '');
    const countryCode = parsed.countryCallingCode ? `+${parsed.countryCallingCode}` : null;
    const countryName = parsed.country ? REGION_DISPLAY_NAMES?.of(parsed.country) ?? parsed.country : null;

    return {
      valid: true,
      phoneNumber,
      countryCode,
      countryName
    };
  } catch (error) {
    return { valid: false };
  }
}

export function classifyIdentifier(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return defaultIdentifierMetadata();

  const strippedLeadingAt = rawValue.startsWith('@') ? rawValue.slice(1).trim() : rawValue;
  const normalized = strippedLeadingAt.toLowerCase();

  const lidJidMatch = normalized.match(/^(\d+)@lid$/);
  if (lidJidMatch) {
    const lid = lidJidMatch[1];
    return {
      identifierType: 'lid_jid',
      jid: `${lid}@lid`,
      phoneNumber: null,
      lid,
      rawLid: lid,
      countryCode: null,
      countryName: null,
      mention: `@${lid}`
    };
  }

  const whatsappMatch = normalized.match(/^(\d+)@s\.whatsapp\.net$/);
  if (whatsappMatch) {
    const digits = whatsappMatch[1];
    const phoneMeta = parsePhoneMeta(digits);
    if (phoneMeta.valid) {
      return {
        identifierType: 'phone_jid',
        jid: normalized,
        phoneNumber: phoneMeta.phoneNumber,
        lid: null,
        rawLid: null,
        countryCode: phoneMeta.countryCode,
        countryName: phoneMeta.countryName,
        mention: `@${phoneMeta.phoneNumber}`
      };
    }

    return {
      ...defaultIdentifierMetadata(),
      jid: normalized
    };
  }

  const rawLidMatch = normalized.match(/^(\d+)@lid$/i);
  if (rawLidMatch) {
    const lid = rawLidMatch[1];
    return {
      identifierType: 'raw_lid',
      jid: null,
      phoneNumber: null,
      lid,
      rawLid: lid,
      countryCode: null,
      countryName: null,
      mention: `@${lid}`
    };
  }

  if (/^\d+$/.test(normalized)) {
    const phoneMeta = parsePhoneMeta(normalized);
    if (phoneMeta.valid) {
      return {
        identifierType: 'phone_jid',
        jid: `${phoneMeta.phoneNumber}@s.whatsapp.net`,
        phoneNumber: phoneMeta.phoneNumber,
        lid: null,
        rawLid: null,
        countryCode: phoneMeta.countryCode,
        countryName: phoneMeta.countryName,
        mention: `@${phoneMeta.phoneNumber}`
      };
    }

    return {
      identifierType: 'unknown',
      jid: null,
      phoneNumber: normalized,
      lid: null,
      rawLid: null,
      countryCode: null,
      countryName: null,
      mention: `@${normalized}`
    };
  }

  return defaultIdentifierMetadata();
}

// ========================================
// 🏰 Helper Functions for Multi-Kingdom System
// ========================================

/**
 * Escape user-provided string for use in a RegExp
 */
export function escapeRegex(str) {
  return (str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * البحث عن مستخدم بناءً على اللقب مع أولوية لـ:
 *   1) التطابق التام
 *   2) بداية اللقب
 *   3) وجود الجزئي (contains)
 */
export async function findUserByNickname(nickname, kingdomId) {
  const term = (nickname || '').trim();
  if (!term) return null;

  const escaped = escapeRegex(term);
  const baseQuery = kingdomId ? { kingdom_id: kingdomId } : {};

  // 1) تطابق تام
  let user = await User.findOne({
    ...baseQuery,
    nickname: { $regex: `^${escaped}$`, $options: 'i' }
  });
  if (user) return user;

  // 2) يبدأ بالمدخل
  user = await User.findOne({
    ...baseQuery,
    nickname: { $regex: `^${escaped}`, $options: 'i' }
  });
  if (user) return user;

  // 3) يحتوي على المدخل (فقط ككلمة مستقلة أو بداية جملة)
  //     لتجنب مطابقة أجزاء من أسماء أطول (مثل "ميريليونا" عند البحث عن "يونا").
  user = await User.findOne({
    ...baseQuery,
    nickname: { $regex: `(?:^|\\s)${escaped}(?:\\s|$)`, $options: 'i' }
  });
  return user;
}

/**
 * الحصول على بيانات المملكة وتعيينها للمتغيرات المحلية للأمان
 */
export function getKingdomAdmins(kingdomId) {
  if (!kingdomId) return ADMINS; // إذا لم يُحدد، نعيد العام
  const kingdom = KINGDOMS[kingdomId];
  return kingdom?.admins || ADMINS;
}

/**
 * التحقق من صلاحية الأدمن ضمن مملكة معينة
 */
export async function isSuperAdminInKingdom(sender, kingdomId) {
  // الأدمن العام يمكنه العمل في أي مملكة
  if (ADMINS.includes(sender)) {
    return true;
  }
  
  const user = await User.findOne({ jid: sender });
  if (!user) {
    return false;
  }
  
  return user.role === 'super_admin' && user.kingdom_id === kingdomId;
}

// التحقق من كون المستخدم أدمن رئيسي
export async function isSuperAdmin(sender) {
    // الفحص الأول: التحقق من قائمة ADMINS (JID أو لقب)
    if (ADMINS.includes(sender)) {
        return true;
    }
    
    // الفحص الثاني: البحث عن المستخدم في قاعدة البيانات
    const user = await User.findOne({ jid: sender });
    if (!user) {
        return false;
    }
    
    // التحقق من الاسم المستعار أو الدور
    const isInAdminsList = ADMINS.includes(user.nickname);
    
    return user.role === 'super_admin' || isInAdminsList;
}

// التحقق من كون المستخدم أدمن (عادي أو رئيسي)
export async function isAdmin(sender, kingdom = null) {
    // إذا كان super_admin في المملكة المحددة، فهو أدمن بالتأكيد
    if (kingdom) {
        if (await isSuperAdminInKingdom(sender, kingdom)) {
            return true;
        }
    } else {
        // إذا لم تُمرر المملكة، نسمح للأدمن الرئيسي (العالمي)
        if (await isSuperAdmin(sender)) {
            return true;
        }
    }

    // تحديد المملكة إذا لم تُمرر
    if (!kingdom) {
        // لا يمكن تحديد المملكة بدون جروب، لذا نعيد false
        return false;
    }

    // الحصول على أدمنز المملكة
    const kingdomAdmins = getKingdomAdmins(kingdom);
    if (kingdomAdmins.includes(sender)) {
        return true;
    }

    // البحث عن المستخدم في المملكة المحددة
    const user = await User.findOne({ jid: sender, kingdom_id: kingdom });
    if (!user) {
        return false;
    }

    // إذا كانت role هي admin، فهو أدمن
    return user.role === 'admin';
}

// التحقق من كون المستخدم مشرف
export async function isModerator(sender, kingdom = null) {
    // إذا كان admin أو super_admin في المملكة المحددة، فهو مشرف
    if (await isAdmin(sender, kingdom) || (kingdom ? await isSuperAdminInKingdom(sender, kingdom) : await isSuperAdmin(sender))) {
        return true;
    }

    // تحديد المملكة إذا لم تُمرر
    if (!kingdom) {
        return false;
    }

    // البحث عن المستخدم في المملكة المحددة
    const user = await User.findOne({ jid: sender, kingdom_id: kingdom });
    if (!user) {
        return false;
    }

    // إذا كانت role هي moderator، فهو مشرف
    return user.role === 'moderator';
}

// التحقق من كون البوت أدمن في الجروب
export async function isBotGroupAdmin(sock, jid) {
    try {
        const groupMetadata = await sock.groupMetadata(jid);
        const botJid = sock.user.id;
        const botParticipant = groupMetadata.participants.find(p => p.id === botJid);
        return botParticipant && botParticipant.admin !== null;
    } catch (error) {
        console.error('خطأ في التحقق من أدمن البوت في الجروب:', error);
        return false;
    }
}

// الحصول على معلومات المستخدم بالـ JID
export async function getUserInfo(jid, kingdom = null) {
    // البحث الأول: بدون تقيد بـ kingdom_id
    let user = await User.findOne({ jid });
    
    // البحث الثاني: إذا كان kingdom محدداً وثم يحاول مع kingdom_id
    if (!user && kingdom) {
        user = await User.findOne({ jid, kingdom_id: kingdom });
    }
    
    if (!user) return null;

    // التحقق من الدور (من قاعدة البيانات أو قائمة ADMINS / قائمة مملكة)
    let roleKey = user.role;

    if (kingdom) {
        const kingdomAdmins = getKingdomAdmins(kingdom);
        if (kingdomAdmins.includes(jid) || kingdomAdmins.includes(user.nickname)) {
            roleKey = 'super_admin';
        }
        if (user.role === 'super_admin' && user.kingdom_id === kingdom) {
            roleKey = 'super_admin';
        }
    } else {
        if ((user.role === 'member' || user.role === 'admin') && (ADMINS.includes(jid) || ADMINS.includes(user.nickname))) {
            roleKey = 'super_admin';
        }
    }

    const roleDisplay = {
        'super_admin': '👑 أدمن رئيسي',
        'admin': '🔱 أدمن أساسي',
        'moderator': '🔰 مشرف',
        'member': '👤 عضو'
    };

    return {
        nickname: user.nickname,
        points: user.points,
        rankStars: user.rankStarsByKingdom?.[kingdom] || 0,
        kingdomRank: user.kingdomRankByKingdom?.[kingdom] || null,
        coins: user.coins,
        role: roleDisplay[roleKey] || '👤 عضو',
        roleKey: roleKey,
        isBanned: user.isBanned
    };
}

// البحث عن مستخدم بالنيك نيم أو الرقم (مع تصفية المملكة)
export async function findUserByNicknameOrPhone(searchTerm, kingdom = 'clover') {
    if (!searchTerm) return null;

    const raw = String(searchTerm || '').trim();
    if (!raw) return null;

    const identifier = classifyIdentifier(raw);

    if (identifier.identifierType === 'phone_jid') {
        const user = await User.findOne({ phoneNumber: identifier.phoneNumber, kingdom_id: kingdom });
        if (user) return user;
        return await User.findOne({ jid: identifier.jid, kingdom_id: kingdom });
    }

    if (identifier.identifierType === 'lid_jid' || identifier.identifierType === 'raw_lid') {
        const user = await User.findOne({ lid: identifier.lid, kingdom_id: kingdom });
        if (user) return user;
    }

    // محاولة البحث بالنيك نيم أولاً
    let user = await User.findOne({
        nickname: { $regex: `^${escapeRegex(raw)}$`, $options: 'i' },
        kingdom_id: kingdom
    });
    if (user) return user;

    user = await User.findOne({
        nickname: { $regex: `^${escapeRegex(raw)}`, $options: 'i' },
        kingdom_id: kingdom
    });
    if (user) return user;

    user = await User.findOne({
        nickname: { $regex: `(?:^|\\s)${escapeRegex(raw)}(?:\\s|$)`, $options: 'i' },
        kingdom_id: kingdom
    });
    if (user) return user;

    // حاول البحث في الحقول mention و lid
    if (raw.startsWith('@')) {
        const mentionLookup = raw;
        user = await User.findOne({ mention: mentionLookup, kingdom_id: kingdom });
        if (user) return user;
    }

    if (identifier.identifierType === 'unknown' && /^\d+$/.test(raw)) {
        user = await User.findOne({ lid: raw, kingdom_id: kingdom });
        if (user) return user;
    }

    user = await User.findOne({
        phoneNumber: { $regex: escapeRegex(raw), $options: 'i' },
        kingdom_id: kingdom
    });
    if (user) return user;

    return null;
}

// الحصول على بيانات الهوية من JID أو منشن
export function getPhoneFromJID(jid) {
    const result = classifyIdentifier(jid);
    return result.identifierType === 'phone_jid' ? result.phoneNumber : null;
}

export function getLidFromJID(jid) {
    const result = classifyIdentifier(jid);
    return result.identifierType === 'lid_jid' ? result.lid : null;
}

export function getMentionFromJID(jid) {
    const result = classifyIdentifier(jid);
    return formatCleanMentionText(jid, result);
}

function getMentionNumber(jid, identifier = {}) {
    const raw = String(jid || '').trim().replace(/^@/, '');
    const jidNumberMatch = raw.match(/^(\d+)(?:@s\.whatsapp\.net)?$/i);
    if (jidNumberMatch) return jidNumberMatch[1];

    if (identifier.countryCode && identifier.phoneNumber) {
        return `${String(identifier.countryCode).replace(/\D/g, '')}${identifier.phoneNumber}`;
    }

    return identifier.phoneNumber || null;
}

function formatCleanMentionText(jid, identifier = classifyIdentifier(jid)) {
    const savedMention = identifier.mention || '';
    if (identifier.identifierType === 'phone_jid') {
        const mentionNumber = getMentionNumber(jid, identifier);
        if (mentionNumber) return `@${mentionNumber}`;
    }
    if ((identifier.identifierType === 'lid_jid' || identifier.identifierType === 'raw_lid') && identifier.lid) {
        return `@${identifier.lid}`;
    }
    if (savedMention) {
        return sanitizeMentionText(savedMention);
    }

    const raw = String(jid || '').split('@')[0].replace(/^@/, '');
    return raw ? `@${raw}` : '@unknown';
}

function sanitizeMentionText(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const withoutLidSuffix = text
        .replace(/\s*@lid\b/gi, '')
        .replace(/@lid\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    const withoutTrailingNumericId = withoutLidSuffix
        .replace(/(?:\s|^)@\d{5,}\b(?=\s*$)/g, '')
        .replace(/@\d{5,}\b(?=\s*$)/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return withoutTrailingNumericId || withoutLidSuffix;
}

function getPromotionMentionText(user) {
    const identifier = classifyIdentifier(user.jid || user.rawLid || user.lid || user.phoneNumber || user.mention);
    const storedMention = String(user.mention || '').trim();

    if (storedMention) {
        const cleanStoredMention = sanitizeMentionText(storedMention);
        if (cleanStoredMention) return cleanStoredMention;
    }

    if (identifier.identifierType === 'phone_jid' && user.jid) {
        return formatCleanMentionText(user.jid, identifier);
    }
    if (user.countryCode && user.phoneNumber) return `@${String(user.countryCode).replace(/\D/g, '')}${user.phoneNumber}`;
    if (user.phoneNumber) return `@${user.phoneNumber}`;
    if (user.lid) return `@${user.lid}`;
    if (user.rawLid) return `@${user.rawLid}`;

    return formatCleanMentionText(user.jid, identifier);
}

export function getCleanMentionTextForUser(userOrJid) {
    if (typeof userOrJid === 'string') {
        return formatCleanMentionText(userOrJid);
    }

    return getPromotionMentionText(userOrJid || {});
}

function buildIdentityClauses(identifier, rawValue) {
    const clauses = [];
    const raw = String(rawValue || '').trim();
    if (identifier.jid || raw) clauses.push({ jid: identifier.jid || raw });
    if (identifier.phoneNumber) clauses.push({ phoneNumber: identifier.phoneNumber });
    if (identifier.lid) clauses.push({ lid: identifier.lid });
    if (identifier.rawLid) clauses.push({ rawLid: identifier.rawLid });
    return clauses;
}

function getMentionJid(userOrJid, identifier = null) {
    if (userOrJid && typeof userOrJid === 'object') {
        return userOrJid.jid || null;
    }

    const raw = String(userOrJid || '').trim();
    if (!raw) return null;
    if (raw.includes('@')) return raw;
    if (identifier?.jid) return identifier.jid;
    return null;
}

export async function resolveMentionContext(userOrJid, kingdom = null) {
    if (userOrJid && typeof userOrJid === 'object') {
        const mentionJid = getMentionJid(userOrJid);
        return {
            text: getCleanMentionTextForUser(userOrJid),
            mentions: mentionJid ? [mentionJid] : []
        };
    }

    const identifier = classifyIdentifier(userOrJid);
    const identityClauses = buildIdentityClauses(identifier, userOrJid);
    let user = null;

    if (identityClauses.length) {
        if (kingdom) {
            user = await User.findOne({ kingdom_id: kingdom, $or: identityClauses });
        }
        if (!user) {
            user = await User.findOne({ $or: identityClauses }).sort({ createdAt: -1 });
        }
    }

    const mentionJid = getMentionJid(user || userOrJid, identifier);
    return {
        text: getCleanMentionTextForUser(user || userOrJid),
        mentions: mentionJid ? [mentionJid] : []
    };
}

function getKingdomDisplayName(kingdom) {
    return KINGDOMS[kingdom]?.name || kingdom || 'المملكة';
}

function getKingdomShortName(kingdom) {
    const name = getKingdomDisplayName(kingdom);
    return name.replace(/[^\p{L}\p{N}\s_-]/gu, '').trim() || name;
}

export function buildWelcomeFormMessage({ nickname, user, userJid, moderatorName, kingdom }) {
    const kingdomName = getKingdomDisplayName(kingdom);
    const kingdomShortName = getKingdomShortName(kingdom);
    const announcementLink = KINGDOMS[kingdom]?.announcementLink || WELCOME_LINK;
    const mention = getCleanMentionTextForUser(user || userJid);

    return renderBotTemplate('welcome', { nickname, mention, kingdomName, kingdomShortName, moderatorName: moderatorName || 'غير محدد', announcementLink }, `*~╃ ${kingdomName} ╄~*
*『 ❀ اســتـمـارة الـتـرحـيـب ❀ 』*

*❀✦═══ •『🍀』• ═══✦❀*

*✧ بكل ودّ واحترام، نفتح لك أبواب قلوبنا قبل أبواب مجموعتنا*
*✧ يسعدنا انضمامك إلى عائلة ${kingdomName} الراقية*
*✧ وجودك بيننا هو إضافة ثمينة نعتز بها، فمرحبًا بك عدد نجوم السماء*✨

➤ *الــلــقــــب ✦  :  『${nickname}』*
➤ *الـمـنـشـن@ ✦ : 『${mention}』*
*➤ الـمـسـؤول ✦ :  『${moderatorName || 'غير محدد'}』*

📌 *يُرجى زيارة رابط الإعلانات الرسمي للاطلاع على كل جديد:*
『 📰』
${announcementLink}
*
*❀✦═══ •『🍀』• ═══✦❀*

*~╃ ${kingdomShortName} ╄~*`);
}

export function buildWorkWelcomeFormMessage({ nickname, status, enteringSource, moderatorName, kingdom }) {
    const kingdomName = getKingdomDisplayName(kingdom);

    return renderBotTemplate('workWelcome', { nickname, status, enteringSource, moderatorName: moderatorName || 'غير محدد', kingdomName }, `*☜ إنجاز إداري 📌 ⟦ استقبال عضو ⟧ ➪*

*☜ اللقب 🎭 ⟦ ${nickname} ⟧ ➪*

*☜ الحالة ⚡ ⟦ ${status} ⟧ ➪*

*☜ من طرف 🔗 ⟦ ${enteringSource} ⟧ ➪*

*☜ المسؤول 🤝 ⟦ ${moderatorName || 'غير محدد'} ⟧ ➪*

*𓆩 ${kingdomName} 𓆪*`);
}

export async function recordSuccessfulWelcome(moderatorJid, kingdom) {
    if (!moderatorJid || !kingdom) return false;

    const moderator = await User.findOne({ jid: moderatorJid, kingdom_id: kingdom });
    if (!moderator) return false;

    moderator.dailyWelcomes = (Number(moderator.dailyWelcomes) || 0) + 1;
    await moderator.save();
    return true;
}

async function getPromotionSignature(adminJid, kingdom) {
    const identifier = classifyIdentifier(adminJid);
    const identityClauses = [
        { jid: identifier.jid || adminJid }
    ];
    if (identifier.phoneNumber) identityClauses.push({ phoneNumber: identifier.phoneNumber });
    if (identifier.lid) identityClauses.push({ lid: identifier.lid });
    if (identifier.rawLid) identityClauses.push({ rawLid: identifier.rawLid });

    const adminUser = await User.findOne({
        kingdom_id: kingdom,
        $or: identityClauses
    }).lean();
    if (adminUser?.nickname) return adminUser.nickname;

    const kingdomName = KINGDOMS[kingdom]?.name || 'المملكة';
    return `إدارة ${kingdomName}`;
}

// الحصول على اللقب من المنشن أو تعيين افتراضي
export async function getNicknameFromMention(sock, jid, mentionedJid, kingdom = 'clover') {
    try {
        if (!mentionedJid) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_dced804e08505eaf')(['❌ لم يتم العثور على منشن صحيح!']) });
            return null;
        }

        const identifier = classifyIdentifier(mentionedJid);
        if (identifier.identifierType !== 'phone_jid') {
            await sock.sendMessage(jid, { text: dashboardReply('reply_99a2d2ecb4a324b0')(['❌ هذا المنشن لا يُمثل JID واتساب صالحاً!']) });
            return null;
        }

        const user = await User.findOne({ jid: identifier.jid, kingdom_id: kingdom });
        if (user && user.nickname) {
            return {
                nickname: user.nickname,
                isNewUser: false,
                user: user
            };
        }

        const defaultNickname = `User_${identifier.phoneNumber.slice(-4)}`;
        if (user) {
            user.nickname = defaultNickname;
            user.phoneNumber = identifier.phoneNumber;
            user.jid = identifier.jid;
            user.identifierType = identifier.identifierType;
            user.countryCode = identifier.countryCode;
            user.countryName = identifier.countryName;
            user.lid = null;
            user.rawLid = null;
            user.mention = formatCleanMentionText(mentionedJid, identifier);
            await user.save();

            return {
                nickname: defaultNickname,
                isNewUser: false,
                user: user,
                isDefaultNickname: true
            };
        }

        return {
            nickname: defaultNickname,
            isNewUser: true,
            jid: identifier.jid,
            phoneNumber: identifier.phoneNumber,
            identifierType: identifier.identifierType,
            countryCode: identifier.countryCode,
            countryName: identifier.countryName,
            mention: formatCleanMentionText(mentionedJid, identifier),
            isDefaultNickname: true
        };
    } catch (error) {
        console.error('خطأ في الحصول على اللقب من المنشن:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_86d6877893978385')(['❌ حدث خطأ في معالجة المنشن!']) });
        return null;
    }
}

// استخراج JID من منشن و تسجيل رقم المستخدم
export async function extractAndSaveUserFromMention(sock, jid, mentionedJid, nickname, kingdom = null) {
    try {
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        if (!mentionedJid) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_dced804e08505eaf')(['❌ لم يتم العثور على منشن صحيح!']) });
            return false;
        }

        const user = await User.findOne({ nickname: { $regex: nickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_a055f5b97fcda5ed')`❌ لم يتم العثور على مستخدم باسم "${nickname}"!` });
            return false;
        }

        const identifier = classifyIdentifier(mentionedJid);
        user.jid = identifier.jid || mentionedJid;
        user.phoneNumber = identifier.identifierType === 'phone_jid' ? identifier.phoneNumber : null;
        user.lid = identifier.identifierType === 'lid_jid' || identifier.identifierType === 'raw_lid' ? identifier.lid : null;
        user.rawLid = identifier.identifierType === 'raw_lid' ? identifier.rawLid : null;
        user.identifierType = identifier.identifierType;
        user.countryCode = identifier.countryCode;
        user.countryName = identifier.countryName;
        user.mention = formatCleanMentionText(mentionedJid, identifier);
        await user.save();

        return user;
    } catch (error) {
        console.error('خطأ في استخراج JID:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_86d6877893978385')(['❌ حدث خطأ في معالجة المنشن!']) });
        return false;
    }
}

// ترقية عضو إلى مشرف (فقط الأدمن الرئيسي)
export async function promoteModerator(sock, jid, targetNickname, adminJid, mentionedJid = null, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // التحقق من أن المستخدم أدمن رئيسي أو أدمن عادي في المملكة المحددة
        const isSuper = await isSuperAdminInKingdom(adminJid, kingdom);
        const admin = await User.findOne({ jid: adminJid, kingdom_id: kingdom });
        if (!admin || (!isSuper && admin.role !== 'admin')) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_b59ada79ba742f34')(['❌ فقط الأدمنز يستطيعون ترقية المشرفين!'])
            });
            return false;
        }

        // الحصول على المستخدم المراد ترقيته بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_d2f7a7683f73761f')(['❌ لم يتم العثور على هذا المستخدم!'])
            });
            return false;
        }

        // إذا كان مشرفاً بالفعل نعتبر هذه ترقية ثانية لتصبح أدمن عادي
        if (user.role === 'moderator') {
            user.role = 'admin';
            await user.save();

            await sock.sendMessage(jid, {
                text: dashboardReply('reply_ad712d6741b2e9a5')`🔰 تم ترقية ${user.nickname} من مشرف إلى أدمن بنجاح!`
            });
            // إرسال رسالة الترقية
            await sendPromotionMessage(sock, jid, user, 'moderator', 'admin', adminJid);
            return true;
        }

        // إذا تم توفير mentionedJid، احفظ المنشن في قاعدة البيانات
        if (mentionedJid) {
            const identifier = classifyIdentifier(mentionedJid);
            user.mention = formatCleanMentionText(mentionedJid, identifier);
            user.jid = identifier.jid || mentionedJid;
            user.phoneNumber = identifier.identifierType === 'phone_jid' ? identifier.phoneNumber : null;
            user.lid = identifier.identifierType === 'lid_jid' || identifier.identifierType === 'raw_lid' ? identifier.lid : null;
            user.rawLid = identifier.identifierType === 'raw_lid' ? identifier.rawLid : null;
            user.identifierType = identifier.identifierType;
            user.countryCode = identifier.countryCode;
            user.countryName = identifier.countryName;
        }

        // ترقيته
        user.role = 'moderator';
        await user.save();

        await sock.sendMessage(jid, {
            text: dashboardReply('reply_2ad7577b117671af')`🔰 تم ترقية ${user.nickname} إلى مشرف بنجاح!`
        });

        // إرسال رسالة الترقية (استخدام المنشن المحفوظ)
        await sendPromotionMessage(sock, jid, user, null, 'moderator', adminJid);

        return true;
    } catch (error) {
        console.error('خطأ في ترقية المشرف:', error);
        return false;
    }
}

// إزالة مشرف (الأدمنز فقط)
export async function demoteModerator(sock, jid, targetNickname, adminJid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // التحقق من أن المستخدم أدمن رئيسي أو أدمن عادي في المملكة المحددة
        const isSuper = await isSuperAdminInKingdom(adminJid, kingdom);
        const admin = await User.findOne({ jid: adminJid, kingdom_id: kingdom });
        if (!admin || (!isSuper && admin.role !== 'admin')) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_4dee8121d9d5c8dd')(['❌ فقط الأدمنز يستطيعون تخفيض الرتب!'])
            });
            return false;
        }

        // الحصول على المستخدم المراد تخفيفه بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_d2f7a7683f73761f')(['❌ لم يتم العثور على هذا المستخدم!'])
            });
            return false;
        }

        // منع تخفيض الأدمن الرئيسي
        if (user.role === 'super_admin') {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_1b0e1af1e0bb9692')(['❌ لا يمكن تخفيض الأدمن الرئيسي!'])
            });
            return false;
        }

        // تخفيض الرتبة حسب الدور الحالي
        if (user.role === 'moderator') {
            user.role = 'member';
            await user.save();
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_ecc9cb1ca83364ac')`👤 تم تخفيض ${user.nickname} من رتبة المشرفين إلى عضو عادي!`
            });
        } else if (user.role === 'admin') {
            user.role = 'moderator';
            await user.save();
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_3a0a4f9f44323592')`👤 تم تخفيض ${user.nickname} من رتبة الأدمن إلى مشرف!`
            });
        } else {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_f057eae046808be9')(['⚠️ هذا العضو لا يحتاج إلى تخفيض!'])
            });
            return false;
        }

        return true;
    } catch (error) {
        console.error('خطأ في تخفيض الرتبة:', error);
        return false;
    }
}

// دالة للحصول على الرتبة المناسبة بناءً على عدد النجوم (النظام الجديد)
function getRankByStars(stars) {
    if (!stars || stars < 400) {
        return null; // لا رتبة إذا كان أقل من 400 نجمة
    }

    const KINGDOM_RANKS = [
        { tier: "نواب الأدميرال", minStars: 24000 },
        { tier: "العميد", minStars: 15000 },
        { tier: "التشيبوكاي", minStars: 6500 },
        { tier: "ملازم", minStars: 1500 },
        { tier: "بيرق", minStars: 800 },
        { tier: "راية", minStars: 500 },
        { tier: "مشرف متدرّب", minStars: 400 }
    ];

    // البحث عن الرتبة الأعلى التي يستوفيها المستخدم
    for (const rank of KINGDOM_RANKS) {
        if (stars >= rank.minStars) {
            return rank.tier;
        }
    }

    return null; // لا رتبة إذا لم يستوفِ أي شرط
}

// إضافة نقاط للعضو (فقط الأدمن الرئيسي)
export async function addPoints(sock, jid, targetNickname, amount, adminJid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // التحقق من أن المستخدم أدمن رئيسي أو أدمن عادي في المملكة المحددة
        const isSuper = await isSuperAdminInKingdom(adminJid, kingdom);
        const admin = await User.findOne({ jid: adminJid, kingdom_id: kingdom });
        if (!admin || (!isSuper && admin.role !== 'admin')) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_cb555a47cc94f762')(['❌ فقط الأدمنز يستطيعون إضافة النقاط!'])
            });
            return false;
        }

        // الحصول على المستخدم المراد إضافة النقاط له بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_d2f7a7683f73761f')(['❌ لم يتم العثور على هذا المستخدم!'])
            });
            return false;
        }

        user.points = (user.points || 0) + amount;
        await user.save();

        await sock.sendMessage(jid, {
            text: dashboardReply('reply_b680ef757d09731d')`💰 تم إضافة ${amount} نقطة لـ ${user.nickname}!\nمجموع نقاطه: ${user.points}`
        });

        return true;
    } catch (error) {
        console.error('خطأ في إضافة النقاط:', error);
        return false;
    }
}

// إزالة نقاط من العضو (الأدمن الرئيسي والمشرفين)
export async function removePoints(sock, jid, targetNickname, amount, modJid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // التحقق من أن المستخدم أدمن رئيسي أو أدمن عادي أو مشرف في المملكة المحددة
        const isSuper = await isSuperAdminInKingdom(modJid, kingdom);
        const mod = await User.findOne({ jid: modJid, kingdom_id: kingdom });
        if (!mod || (!isSuper && mod.role !== 'admin' && mod.role !== 'moderator')) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_bb16e9734c123288')(['❌ فقط الأدمنز والمشرفين يستطيعون إزالة النقاط!'])
            });
            return false;
        }

        // الحصول على المستخدم المراد إزالة النقاط منه بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_d2f7a7683f73761f')(['❌ لم يتم العثور على هذا المستخدم!'])
            });
            return false;
        }

        user.points = Math.max(0, (user.points || 0) - amount);
        await user.save();

        await sock.sendMessage(jid, {
            text: dashboardReply('reply_f9a9f62917600f71')`💰 تم إزالة ${amount} نقطة من ${user.nickname}!\nمجموع نقاطه: ${user.points}`
        });

        return true;
    } catch (error) {
        console.error('خطأ في إزالة النقاط:', error);
        return false;
    }
}

// إضافة عملات للعضو (فقط الأدمن الرئيسي)
export async function addCoins(sock, jid, targetNickname, amount, adminJid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // التحقق من أن المستخدم أدمن رئيسي في المملكة المحددة
        const isSuper = await isSuperAdminInKingdom(adminJid, kingdom);
        if (!isSuper) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_9d77f64a2d315a6b')(['❌ فقط الأدمن الرئيسي في هذه المملكة يستطيع إضافة العملات!'])
            });
            return false;
        }

        // الحصول على المستخدم المراد إضافة العملات له بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_246a54de8b0c80fb')`❌ لم يتم العثور على العضو "${targetNickname}" في هذه المملكة!`
            });
            return false;
        }

        user.coins = (user.coins || 0) + amount;
        await user.save();

        await sock.sendMessage(jid, {
            text: dashboardReply('reply_a9f38a3f9cd3fe65')`💰 تم إضافة ${amount} عملة لـ ${user.nickname}!\nمجموع عملاته: ${user.coins}`
        });

        return true;
    } catch (error) {
        console.error('خطأ في إضافة العملات:', error);
        return false;
    }
}

// إزالة عملات من العضو (الأدمن الرئيسي والأدمن العادي فقط)
export async function removeCoins(sock, jid, targetNickname, amount, modJid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // التحقق من أن المستخدم أدمن رئيسي أو أدمن عادي في المملكة المحددة
        const isSuper = await isSuperAdminInKingdom(modJid, kingdom);
        const mod = await User.findOne({ jid: modJid, kingdom_id: kingdom });
        if (!mod || (!isSuper && mod.role !== 'admin')) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_35afe84465768748')(['❌ فقط الأدمنز يستطيعون إزالة العملات!'])
            });
            return false;
        }

        // الحصول على المستخدم المراد إزالة العملات منه بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_246a54de8b0c80fb')`❌ لم يتم العثور على العضو "${targetNickname}" في هذه المملكة!`
            });
            return false;
        }

        user.coins = Math.max(0, (user.coins || 0) - amount);
        await user.save();

        await sock.sendMessage(jid, {
            text: dashboardReply('reply_17e421bf1d087cd9')`💰 تم إزالة ${amount} عملة من ${user.nickname}!\nمجموع عملاته: ${user.coins}`
        });

        return true;
    } catch (error) {
        console.error('خطأ في إزالة العملات:', error);
        return false;
    }
}

// طرد عضو من المجموعة (الأدمن الرئيسي والمشرفين)
export async function kickMember(sock, jid, targetNickname, modJid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // التحقق من أن المستخدم أدمن رئيسي أو مشرف في المملكة المحددة
        const isSuper = await isSuperAdminInKingdom(modJid, kingdom);
        const mod = await User.findOne({ jid: modJid, kingdom_id: kingdom });
        if (!mod || (!isSuper && mod.role !== 'admin' && mod.role !== 'moderator')) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_8eba998d034af5b6')(['❌ فقط الأدمنز والمشرفين يستطيعون طرد الأعضاء!'])
            });
            return false;
        }

        // الحصول على بيانات العضو المراد طرده بالـ nickname
        const user = await findUserByNickname(targetNickname, kingdom);
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_d2f7a7683f73761f')(['❌ لم يتم العثور على هذا المستخدم!'])
            });
            return false;
        }

        // منع الأدمن العادي من طرد الأدمن الرئيسي
        if (user.role === 'super_admin' && !isSuper) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_0e4fb2877f972a88')(['❌ لا يمكن طرد الأدمن الرئيسي!'])
            });
            return false;
        }

        // منع الأدمن العادي من طرد أدمن آخر
        if (user.role === 'admin' && !isSuper) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_ab49116a7c338dd0')(['❌ لا يمكن طرد الأدمن إلا من قبل أدمن رئيسي!'])
            });
            return false;
        }

        // منع المشرف من طرد الأدمنز أو المشرفين الآخرين
        if ((user.role === 'admin' || user.role === 'super_admin' || user.role === 'moderator') && mod.role === 'moderator') {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_5f90fdb7d59fcbe3')(['❌ المشرفون لا يمكنهم طرد الأدمنز أو المشرفين الآخرين!'])
            });
            return false;
        }

        // طرد فعلي من المجموعة
        try {
            await sock.groupParticipantsUpdate(jid, [{ action: 'remove', participants: [user.jid] }]);
        } catch (error) {
            console.error('خطأ في الطرد الفعلي:', error);
            await sock.sendMessage(jid, { text: dashboardReply('reply_59716b0f39404248')(['❌ فشل في طرد العضو من المجموعة!']) });
            return false;
        }

        // إزالة المجموعة من قائمة مجموعات العضو
        user.groups = user.groups.filter(g => g !== jid);
        await user.save();

        await sock.sendMessage(jid, {
            text: dashboardReply('reply_3f8dbc7671d60166')`🚫 تم طرد ${user.nickname} من المجموعة فعلياً!\n\nهل تريد حذف بياناته من قاعدة البيانات؟\nأجب بنعم أو لا.`
        });

        // إضافة إلى pendingKick لانتظار الإجابة
        const { pendingKick } = await import('../handlers/messageHandler.js');
        pendingKick[jid] = {
            userId: user._id,
            nickname: user.nickname,
            adminJid: modJid,
            timestamp: Date.now()
        };

        return true;
    } catch (error) {
        console.error('خطأ في طرد العضو:', error);
        return false;
    }
}

// حظر عضو (الأدمنز والمشرفين)
export async function banMember(sock, jid, targetNickname, reason, adminJid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // التحقق من أن المستخدم أدمن رئيسي أو أدمن عادي أو مشرف في المملكة المحددة
        const isSuper = await isSuperAdminInKingdom(adminJid, kingdom);
        const admin = await User.findOne({ jid: adminJid, kingdom_id: kingdom });
        if (!admin || (!isSuper && admin.role !== 'admin' && admin.role !== 'moderator')) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_c75fc539837b76d3')(['❌ فقط الأدمنز والمشرفين يستطيعون حظر الأعضاء!'])
            });
            return false;
        }

        // الحصول على المستخدم المراد حظره بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_d2f7a7683f73761f')(['❌ لم يتم العثور على هذا المستخدم!'])
            });
            return false;
        }

        // منع المشرف من حظر الأدمن الرئيسي
        if (user.role === 'super_admin' && admin.role === 'moderator') {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_e9f75dc5eb60fb6f')(['❌ المشرفون لا يمكنهم حظر الأدمن الرئيسي!'])
            });
            return false;
        }

        // منع الأدمن العادي من حظر الأدمن الرئيسي
        if (user.role === 'super_admin' && !isSuper) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_09f98184d771557a')(['❌ لا يمكن حظر الأدمن الرئيسي!'])
            });
            return false;
        }

        // حظره
        user.isBanned = true;
        user.bannedAt = new Date();
        user.banReason = reason;
        await user.save();

        await sock.sendMessage(jid, {
            text: dashboardReply('reply_9a792ddfa98ab564')`🚫 تم حظر ${user.nickname}!\nالسبب: ${reason}`
        });

        return true;
    } catch (error) {
        console.error('خطأ في حظر العضو:', error);
        return false;
    }
}

// إزالة الحظر عن عضو (الأدمنز والمشرفين)
export async function unbanMember(sock, jid, targetNickname, adminJid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // التحقق من أن المستخدم أدمن رئيسي أو أدمن عادي أو مشرف في المملكة المحددة
        const isSuper = await isSuperAdminInKingdom(adminJid, kingdom);
        const admin = await User.findOne({ jid: adminJid, kingdom_id: kingdom });
        if (!admin || (!isSuper && admin.role !== 'admin' && admin.role !== 'moderator')) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_2ee29f23a9f4abef')(['❌ فقط الأدمنز والمشرفين يستطيعون إزالة الحظر!'])
            });
            return false;
        }

        // الحصول على المستخدم بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_d2f7a7683f73761f')(['❌ لم يتم العثور على هذا المستخدم!'])
            });
            return false;
        }

        // إزالة الحظر
        user.isBanned = false;
        user.bannedAt = null;
        user.banReason = null;
        await user.save();

        await sock.sendMessage(jid, {
            text: dashboardReply('reply_105fb5f4c57149df')`✅ تم إزالة الحظر عن ${user.nickname}!`
        });

        return true;
    } catch (error) {
        console.error('خطأ في إزالة الحظر:', error);
        return false;
    }
}

// عرض معلومات العضو
export async function showUserStats(sock, jid, targetNickname, kingdom = null) {
    try {
        // إذا لم تُمرر kingdom، حاول استخراجها من jid
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        if (!kingdom) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_284b771fb9eae7f9')(['❌ هذا القروب غير مرتبط بأي مملكة في قاعدة البيانات.']) });
            return false;
        }
        
        // استخدم دالة البحث المحسّنة لتجنب مطابقة أجزاء من الألقاب الطويلة
        const user = await findUserByNickname(targetNickname, kingdom);
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_d2f7a7683f73761f')(['❌ لم يتم العثور على هذا المستخدم!'])
            });
            return;
        }

        // التحقق من الدور مع فحص قائمة ADMINS
        let roleEmoji = '👤';
        let roleText = 'عضو';
        
        // فحص إذا كان في قائمة ADMINS أو role = super_admin
        const isInAdminsList = ADMINS.includes(user.jid) || ADMINS.includes(user.nickname);
        if (user.role === 'super_admin' || isInAdminsList) {
          roleEmoji = '👑';
          roleText = 'أدمن رئيسي';
        } else if (user.role === 'admin') {
          roleEmoji = '👑';
          roleText = 'أدمن';
        } else if (user.role === 'moderator') {
          roleEmoji = '🔰';
          roleText = 'مشرف';
        }
        
        // الحصول على رتبة المملكة
        const rankStars = user.rankStarsByKingdom?.[kingdom] || 0;
        const highestRank = getHighestRank(kingdom, rankStars);
        const kingdomRankDisplay = highestRank ? displayRank(kingdom, highestRank) : '❌ لا توجد رتبة';

        let message = dashboardReply('reply_4ddf3f9c25aff1e8')`${roleEmoji} معلومات ${user.nickname}\n`;
        message += dashboardReply('reply_2bd27e562fcf3ddd')`━━━━━━━━━━━━━━━━━\n`;
        message += dashboardReply('reply_8b34abe72730fbc6')`📛 اللقب: ${user.nickname}\n`;
        message += dashboardReply('reply_ee52f156c6aa6761')`🎖️ الرتبة الإدارية: ${roleText}\n`;
        message += dashboardReply('reply_19bb1196abf63e26')`👑 رتبة المملكة: ${kingdomRankDisplay}\n`;
        message += dashboardReply('reply_77d46532e45b2a62')`✨ المستوى: ${user.level || 0} (${user.xp || 0} XP)\n`;
        message += dashboardReply('reply_75a4c820b85d571c')`💰 النقاط: ${user.points || 0}\n`;
        message += dashboardReply('reply_b7ee82744aadf109')`🎖️ نجوم الرتب: ${rankStars}\n`;
        message += dashboardReply('reply_9d791aac8d5ae34c')`💰 العملات: ${user.coins}\n`;
        message += dashboardReply('reply_9a6bf1a7ab02a371')`🏦 البنك: ${user.bankCoins || 0}\n`;
        message += dashboardReply('reply_717e7b6ceb525321')`📊 الرسائل اليومية: ${user.dailyMessages || 0}\n`;
        message += dashboardReply('reply_5a9990dca8c56ee7')`📊 إجمالي الرسائل: ${user.totalMessages || 0}\n`;
        message += dashboardReply('reply_e63d5f4baa1abe5a')`📅 تاريخ الانضمام: ${user.createdAt.toLocaleDateString('ar-EG')}\n`;

        if (user.isBanned) {
            message += dashboardReply('reply_4dc35b2723ba072b')`🚫 محظور - السبب: ${user.banReason}\n`;
        }

        await sock.sendMessage(jid, { text: message });
    } catch (error) {
        return false;
    }
}

// ===== دوال البنك =====

// الحصول على معلومات البنك
export async function getBankInfo(kingdom = null) {
    if (!kingdom) {
        throw new Error('لا يمكن فتح بنك بدون مملكة مرتبطة.');
    }
    let bank = await Bank.findOne({ kingdom: kingdom });
    if (!bank) {
        bank = new Bank({ kingdom: kingdom });
        await bank.save();
    }
    return bank;
}

// إيداع في البنك
export async function depositToBank(sock, jid, sender, amount) {
    try {
        const kingdom = getKingdomIdFromGroupJid(jid);
        const user = await User.findOne({ jid: sender, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_71d017b75bdda24a')(['❌ لم يتم العثور على حسابك!']) });
            return false;
        }

        if (amount <= 0) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_509b6fd0fbe42afb')(['❌ المبلغ يجب أن يكون أكبر من صفر!']) });
            return false;
        }

        if (user.coins < amount) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_4ba15dc9c64dc1e6')(['❌ ليس لديك عملات كافية!']) });
            return false;
        }

        // خصم من المستخدم
        user.coins -= amount;
        user.bankCoins = (user.bankCoins || 0) + amount;
        await user.save();

        // إضافة للبنك
        const bank = await getBankInfo(kingdom);
        bank.totalCoins += amount;
        bank.transactions.push({
            type: 'deposit',
            userJid: sender,
            amount: amount
        });
        await bank.save();

        await sock.sendMessage(jid, {
            text: dashboardReply('reply_688786a79ddc5ee2')`🏦 تم إيداع ${amount} عملة في البنك بنجاح!\n💰 رصيدك الآن: ${user.coins}\n🏦 رصيدك في البنك: ${user.bankCoins}`
        });

        return true;
    } catch (error) {
        console.error('خطأ في الإيداع:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_1d447917b6e8163e')(['❌ حدث خطأ في الإيداع!']) });
        return false;
    }
}

// سحب من البنك
export async function withdrawFromBank(sock, jid, sender, amount) {
    try {
        const kingdom = getKingdomIdFromGroupJid(jid);
        const user = await User.findOne({ jid: sender, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_71d017b75bdda24a')(['❌ لم يتم العثور على حسابك!']) });
            return false;
        }

        if (amount <= 0) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_509b6fd0fbe42afb')(['❌ المبلغ يجب أن يكون أكبر من صفر!']) });
            return false;
        }

        if ((user.bankCoins || 0) < amount) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_277e3578bb43c97d')(['❌ ليس لديك عملات كافية في البنك!']) });
            return false;
        }

        // خصم من البنك للمستخدم
        user.bankCoins -= amount;
        user.coins += amount;
        await user.save();

        // خصم من البنك العام
        const bank = await getBankInfo(kingdom);
        bank.totalCoins -= amount;
        bank.transactions.push({
            type: 'withdraw',
            userJid: sender,
            amount: amount
        });
        await bank.save();

        await sock.sendMessage(jid, {
            text: dashboardReply('reply_d0e90482270f9940')`🏦 تم سحب ${amount} عملة من البنك بنجاح!\n💰 رصيدك الآن: ${user.coins}\n🏦 رصيدك في البنك: ${user.bankCoins}`
        });

        return true;
    } catch (error) {
        console.error('خطأ في السحب:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_e08a40d5f294c98d')(['❌ حدث خطأ في السحب!']) });
        return false;
    }
}

// عرض رصيد البنك للمستخدم
export async function showBankBalance(sock, jid, sender) {
    try {
        const kingdom = getKingdomIdFromGroupJid(jid);
        const user = await User.findOne({ jid: sender, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_71d017b75bdda24a')(['❌ لم يتم العثور على حسابك!']) });
            return;
        }

        const bank = await getBankInfo(kingdom);

        let message = dashboardReply('reply_e4513cef2881cb15')`🏦 معلومات حسابك البنكي\n`;
        message += dashboardReply('reply_c892550c9e1c68f3')`━━━━━━━━━━━━━━━━━━━━\n`;
        message += dashboardReply('reply_7df0bffc59319b70')`💰 عملاتك: ${user.coins}\n`;
        message += dashboardReply('reply_29aa8afaf9900497')`🏦 رصيدك في البنك: ${user.bankCoins || 0}\n`;
        message += dashboardReply('reply_030cae902afccdf7')`🏛️ إجمالي البنك: ${bank.totalCoins}\n`;

        await sock.sendMessage(jid, { text: message });
    } catch (error) {
        console.error('خطأ في عرض الرصيد:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_2683ccfe4605612d')(['❌ حدث خطأ في عرض الرصيد!']) });
    }
}

// تحويل عملات بين الأعضاء
export async function transferCoinsBetweenUsers(sock, jid, sender, recipientNickname, amount) {
    try {
        const kingdom = getKingdomIdFromGroupJid(jid);
        const senderUser = await User.findOne({ jid: sender, kingdom_id: kingdom });
        if (!senderUser) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_71d017b75bdda24a')(['❌ لم يتم العثور على حسابك!']) });
            return false;
        }

        if (amount <= 0) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_509b6fd0fbe42afb')(['❌ المبلغ يجب أن يكون أكبر من صفر!']) });
            return false;
        }

        if (senderUser.coins < amount) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_4ba15dc9c64dc1e6')(['❌ ليس لديك عملات كافية!']) });
            return false;
        }

        // البحث عن المستلم
        const recipientUser = await findUserByNickname(recipientNickname, kingdom);
        if (!recipientUser) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_238ddcea4e7be15d')(['❌ لم يتم العثور على المستلم!']) });
            return false;
        }

        if (recipientUser.jid === sender) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_dbb22dd51799a29e')(['❌ لا يمكنك التحويل لنفسك!']) });
            return false;
        }

        // تنفيذ التحويل
        senderUser.coins -= amount;
        recipientUser.coins += amount;

        await senderUser.save();
        await recipientUser.save();

        // إضافة معاملة للبنك
        const bank = await getBankInfo(kingdom);
        bank.transactions.push({
            type: 'transfer',
            userJid: sender,
            recipientJid: recipientUser.jid,
            amount: amount
        });
        await bank.save();

        // إشعار المرسل
        await sock.sendMessage(jid, {
            text: dashboardReply('reply_f3e5d1d390e47cc3')`✅ تم التحويل بنجاح!\n💰 تم إرسال ${amount} عملة إلى ${recipientUser.nickname}\n💰 رصيدك الآن: ${senderUser.coins}`
        });

        // إشعار المستلم
        const recipientMention = getCleanMentionTextForUser(recipientUser);
        await sock.sendMessage(jid, {
            text: dashboardReply('reply_075e8fdf5df2ec49')`💰 ${recipientMention} استلم ${amount} عملة من ${senderUser.nickname}!\n💰 رصيده الآن: ${recipientUser.coins}`,
            mentions: [recipientUser.jid]
        });

        return true;
    } catch (error) {
        console.error('خطأ في التحويل:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_6006257b5f60c187')(['❌ حدث خطأ في التحويل!']) });
        return false;
    }
}

// عرض إحصائيات البنك (للأدمن)
export async function showBankStats(sock, jid, kingdom = null) {
    try {
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }
        const bank = await getBankInfo(kingdom);
        const users = await User.find({ bankCoins: { $gt: 0 }, kingdom_id: kingdom });

        let message = dashboardReply('reply_03cadf658d7a92d8')`🏛️ إحصائيات البنك\n`;
        message += dashboardReply('reply_97581f0ccf91c9a7')`━━━━━━━━━━━━━━━━\n`;
        message += dashboardReply('reply_b34edd7e7a0f99b4')`💰 إجمالي العملات: ${bank.totalCoins}\n`;
        message += dashboardReply('reply_a35e1c172e0fd232')`👥 عدد المودعين: ${users.length}\n`;
        message += dashboardReply('reply_82900c2c2c3845fd')`📊 عدد المعاملات: ${bank.transactions.length}\n\n`;

        if (users.length > 0) {
            message += dashboardReply('reply_834d86d8178ff12f')`🏦 أكبر المودعين:\n`;
            users.sort((a, b) => (b.bankCoins || 0) - (a.bankCoins || 0)).slice(0, 5).forEach((u, i) => {
                message += dashboardReply('reply_0227d4f3c4ab8ecb')`${i + 1}. ${u.nickname} - ${u.bankCoins} عملة\n`;
            });
        }

        await sock.sendMessage(jid, { text: message });
    } catch (error) {
        console.error('خطأ في عرض إحصائيات البنك:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_c043e7286de61e8e')(['❌ حدث خطأ في عرض الإحصائيات!']) });
    }
}

// عرض لوحة المشرفين والأدمن
export async function showAdminsAndMods(sock, jid, kingdom = null) {
    try {
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }
        let superAdmins = await User.find({ role: 'super_admin', kingdom_id: kingdom });
        let admins = await User.find({ role: 'admin', kingdom_id: kingdom });
        let mods = await User.find({ role: 'moderator', kingdom_id: kingdom });

        // ترتيب المشرفين حسب نجوم الرتبة تنازليًا
        mods.sort((a, b) => (b.rankStars || 0) - (a.rankStars || 0));

        let message = dashboardReply('reply_795087bcff7c0bd4')`👑 الأدمنز والمشرفين\n`;
        message += dashboardReply('reply_f9eefc423fa08fb7')`━━━━━━━━━━━━━━━━━\n\n`;

        if (superAdmins.length > 0) {
            message += dashboardReply('reply_d348a58d47faf93e')`👑 الأدمن الرئيسي:\n`;
            superAdmins.forEach((admin, i) => {
                const rankStars = admin.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = admin.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌ لا توجد رتبة';
                message += dashboardReply('reply_def19068126a047b')`${i + 1}. ${admin.nickname} 💰${admin.points || 0} 🎖️${rankStars} 👑${kr} 🏦${admin.bankCoins || 0}\n`;
            });
            message += `\n`;
        }

        if (admins.length > 0) {
            message += dashboardReply('reply_d0a96cb189ceb636')`👑 الأدمن العادي:\n`;
            admins.forEach((admin, i) => {
                const rankStars = admin.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = admin.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌ لا توجد رتبة';
                message += dashboardReply('reply_41f1782b7b739d96')`${i + 1}. ${admin.nickname} 💰${admin.points || 0} 🎖️${admin.rankStars || 0} 👑${kr} 🏦${admin.bankCoins || 0}\n`;
            });
            message += `\n`;
        }

        if (mods.length > 0) {
            message += dashboardReply('reply_be8fa7829b9d8046')`🔰 المشرفين:\n`;
            mods.forEach((mod, i) => {
                const rankStars = mod.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = mod.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌ لا توجد رتبة';
                message += dashboardReply('reply_f3cb560dd9569e1a')`${i + 1}. ${mod.nickname} 💰${mod.points || 0} 🎖️${rankStars} 👑${kr} 🏦${mod.bankCoins || 0}\n`;
            });
        } else {
            message += dashboardReply('reply_846a8031ea876557')`🔰 لا يوجد مشرفين\n`;
        }

        await sock.sendMessage(jid, { text: message });
    } catch (error) {
        console.error('خطأ في عرض الأدمنز والمشرفين:', error);
    }
}

// عرض قائمة كاملة مع JIDs
export async function showCompleteList(sock, jid, kingdom = null) {
    try {
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }
        const superAdmins = await User.find({ role: 'super_admin', kingdom_id: kingdom });
        const admins = await User.find({ role: 'admin', kingdom_id: kingdom });
        let mods = await User.find({ role: 'moderator', kingdom_id: kingdom });
        let members = await User.find({ role: 'member', banned: false, kingdom_id: kingdom });
        const banned = await User.find({ banned: true, kingdom_id: kingdom });

        // ترتيب المشرفين حسب نجوم الرتبة
        mods.sort((a, b) => (b.rankStars || 0) - (a.rankStars || 0));
        // ترتيب الأعضاء حسب النقاط
        members.sort((a, b) => (b.points || 0) - (a.points || 0));

        let message = dashboardReply('reply_387b97ee29bdebda')`📋 القائمة الكاملة للمستخدمين\n`;
        message += dashboardReply('reply_3d6d0299e14f380c')`━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        // الأدمن الرئيسي
        if (superAdmins.length > 0) {
            message += dashboardReply('reply_bc2d991751882cf0')`👑 الأدمن الرئيسي (${superAdmins.length}):\n`;
            superAdmins.forEach((admin, i) => {
                const rankStars = admin.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = admin.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌ لا توجد رتبة';
                message += dashboardReply('reply_469d74e3c0ca09b6')`${i + 1}. ${admin.nickname}\n`;
                message += dashboardReply('reply_bb5f97e4557d6ab3')`   JID: ${admin.jid}\n`;
                message += dashboardReply('reply_a7d98aef9c8b496c')`   💰 نقاط: ${admin.points || 0} | 🎖️ نجوم رتبة: ${rankStars} | 👑 رتبة المملكة: ${kr} | 💰 عملات: ${admin.coins} | 🏦 بنك: ${admin.bankCoins || 0}\n\n`;
            });
        }

        // الأدمن العادي
        if (admins.length > 0) {
            message += dashboardReply('reply_0e11251e2c8408d2')`👑 الأدمن العادي (${admins.length}):\n`;
            admins.forEach((admin, i) => {
                const rankStars = admin.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = admin.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌ لا توجد رتبة';
                message += dashboardReply('reply_469d74e3c0ca09b6')`${i + 1}. ${admin.nickname}\n`;
                message += dashboardReply('reply_bb5f97e4557d6ab3')`   JID: ${admin.jid}\n`;
                message += dashboardReply('reply_a7d98aef9c8b496c')`   💰 نقاط: ${admin.points || 0} | 🎖️ نجوم رتبة: ${rankStars} | 👑 رتبة المملكة: ${kr} | 💰 عملات: ${admin.coins} | 🏦 بنك: ${admin.bankCoins || 0}\n\n`;
            });
        }

        // المشرفين
        if (mods.length > 0) {
            message += dashboardReply('reply_08325038d536fc9f')`🔰 المشرفين (${mods.length}):\n`;
            mods.forEach((mod, i) => {
                message += dashboardReply('reply_fa629532d3e6a417')`${i + 1}. ${mod.nickname}\n`;
                message += dashboardReply('reply_7f083a701ea8aecc')`   JID: ${mod.jid}\n`;
                const rankStars = mod.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = mod.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌ لا توجد رتبة';
                message += dashboardReply('reply_574e0c852504540c')`   💰 نقاط: ${mod.points || 0} | 🎖️ نجوم رتبة: ${rankStars} | 👑 رتبة المملكة: ${kr} | 💰 عملات: ${mod.coins} | 🏦 بنك: ${mod.bankCoins || 0}\n\n`;
            });
        }

        // الأعضاء العاديين
        if (members.length > 0) {
            message += dashboardReply('reply_00a238578abf2e3c')`👥 الأعضاء العاديين (${members.length}):\n`;
            members.slice(0, 10).forEach((member, i) => {
                const rankStars = member.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = member.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌';
                message += dashboardReply('reply_173c50d36894fbb4')`${i + 1}. ${member.nickname} - 💰${member.points || 0} | 👑${kr}\n`;
            });
            if (members.length > 10) {
                message += dashboardReply('reply_dcb8a6c5ba7cd409')`... و ${members.length - 10} آخرين\n`;
            }
            message += `\n`;
        }

        // المحظورين
        if (banned.length > 0) {
            message += dashboardReply('reply_b3580d118ea18a16')`🚫 المحظورين (${banned.length}):\n`;
            banned.forEach((user, i) => {
                message += dashboardReply('reply_0241495a47c4252a')`${i + 1}. ${user.nickname}\n`;
                message += dashboardReply('reply_c9f86345a8af12b5')`   JID: ${user.jid}\n`;
                message += dashboardReply('reply_dd34688923384fa0')`   السبب: ${user.banReason || 'لم يتم تحديده'}\n\n`;
            });
        }

        await sock.sendMessage(jid, { text: message });
    } catch (error) {
        console.error('خطأ في عرض القائمة الكاملة:', error);
    }
}

// عرض قائمة الأعضاء العاديين
export async function showMembersList(sock, jid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر صراحة
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        const members = await User.find({ role: 'member', banned: false, kingdom_id: kingdom });

        let message = dashboardReply('reply_43820718ada49b72')`👥 قائمة الأعضاء\n`;
        message += dashboardReply('reply_497842d805854f94')`━━━━━━━━━━━━━━\n`;
        message += dashboardReply('reply_8fe41c5f9c1305bb')`إجمالي الأعضاء: ${members.length}\n\n`;

        members.forEach((member, i) => {
            message += dashboardReply('reply_6e90befb00199db8')`${i + 1}. ${member.nickname}\n`;
            message += dashboardReply('reply_4dd4bbd696293ac2')`   JID: ${member.jid}\n`;
            message += dashboardReply('reply_47789d4be806858e')`   💰 نقاط: ${member.points || 0} | 🎖️ نجوم رتبة: ${member.rankStars || 0} | 💰 عملات: ${member.coins} | 🏦 بنك: ${member.bankCoins || 0}\n\n`;
        });

        await sock.sendMessage(jid, { text: message });
    } catch (error) {
        console.error('خطأ في عرض قائمة الأعضاء:', error);
    }
}

// تغيير لقب المستخدم
export async function changeNickname(sock, jid, currentNickname, newNickname, requesterJid) {
    try {
        // التحقق من أن اللقب الجديد غير فارغ
        if (!newNickname || newNickname.trim() === '') {
            await sock.sendMessage(jid, { text: dashboardReply('reply_8704a9b643f3d08d')(['❌ اللقب الجديد لا يمكن أن يكون فارغاً!']) });
            return false;
        }

        // تنظيف اللقب الجديد
        newNickname = newNickname.trim();

        // التحقق من أن اللقب الجديد غير مستخدم
        const existingUser = await User.findOne({ nickname: { $regex: new RegExp(`^${newNickname}$`, 'i') } });
        if (existingUser && existingUser.nickname !== currentNickname) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_cb4572411008fd44')(['❌ هذا اللقب مستخدم بالفعل!']) });
            return false;
        }

        // الحصول على المستخدم الحالي (الذي يتم تغيير لقبه)
        const user = await User.findOne({ nickname: { $regex: currentNickname, $options: 'i' } });
        if (!user) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_7b14529f261b6d8c')(['❌ لم يتم العثور على المستخدم!']) });
            return false;
        }

        // التحقق من الصلاحيات
        const requester = await User.findOne({ jid: requesterJid });
        
        // هل المطلب هو الأدمن أو مشرف أو الأدمن الرئيسي؟
        const isMod = requester && (requester.role === 'moderator' || requester.role === 'admin' || requester.role === 'super_admin');
        
        // هل يحاول تغيير لقبه الخاص؟
        const isOwnNickname = user.jid === requesterJid;

        if (!isMod && !isOwnNickname) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_4fb7538bb7175246')(['❌ يمكنك تغيير لقبك الخاص فقط!']) });
            return false;
        }

        // حفظ اللقب القديم
        const oldNickname = user.nickname;

        // تحديث اللقب
        user.nickname = newNickname;
        await user.save();

        // إرسال رسالة تأكيد
        let successMessage;
        if (isOwnNickname) {
            successMessage = dashboardReply('reply_ca80a801d5237813')`✅ تم تحديث لقبك من *${oldNickname}* إلى *${newNickname}*!`;
        } else {
            successMessage = dashboardReply('reply_9db555667e5c83cb')`✅ تم تغيير لقب *${oldNickname}* إلى *${newNickname}*\nبواسطة: ${requester.nickname}`;
        }

        await sock.sendMessage(jid, { text: successMessage });
        return true;
    } catch (error) {
        console.error('خطأ في تغيير اللقب:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_5bb17e6f0b7adaf0')(['❌ حدث خطأ في تغيير اللقب!']) });
        return false;
    }
}

// استرجاع اللقب أو إنشاء واحد جديد للعضو
export async function retrieveOrCreateNickname(sock, jid, mentionedJid) {
    try {
        // التحقق من JID
        if (!mentionedJid) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_dced804e08505eaf')(['❌ لم يتم العثور على منشن صحيح!']) });
            return null;
        }

        const kingdom = getKingdomIdFromGroupJid(jid);
        if (!kingdom) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_284b771fb9eae7f9')(['❌ هذا القروب غير مرتبط بأي مملكة في قاعدة البيانات.']) });
            return null;
        }

        // البحث عن المستخدم بناءً على JID المنشن عليه
        let user = await User.findOne({ jid: mentionedJid, kingdom_id: kingdom });

        // إذا كان المستخدم موجود وله لقب
        if (user && user.nickname) {
            // التحقق من منشنه
            if (user.mention) {
                await sock.sendMessage(jid, { 
                    text: dashboardReply('reply_02ee96eff3fe9413')`✅ لقب العضو محفوظ: *${user.nickname}*\n🔗 منشنه المسجل: ${user.mention}`,
                    mentions: [mentionedJid]
                });
            } else {
                // لديه لقب لكن بدون منشن، تحديث المنشن
                try {
                    user.mention = formatCleanMentionText(mentionedJid);
                    user.lid = null;
                    await user.save();

                    await sock.sendMessage(jid, { 
                        text: dashboardReply('reply_91afae100be3dc08')`✅ لقب العضو محفوظ: *${user.nickname}*\n🔗 تم تحديث منشنه: ${user.mention}`,
                        mentions: [mentionedJid]
                    });
                } catch (saveError) {
                    console.error('خطأ في تحديث المنشن:', saveError);
                    await sock.sendMessage(jid, { text: dashboardReply('reply_3040f71ab58781c9')(['⚠️ تم العثور على لقب العضو لكن حدث خطأ في تحديث المنشن']) });
                }
            }
            return user.nickname;
        }

        // إنشاء مستخدم جديد أو استكمال البيانات
        if (!user) {
            // التحقق من عدم وجود مستخدم بنفس JID من قبل
            user = new User({
                jid: mentionedJid,
                kingdom_id: kingdom
            });
        } else if (!user.nickname) {
            // مستخدم موجود لكن بدون لقب
            console.log('مستخدم موجود بدون لقب:', user.jid);
        }

        // إنشاء لقب جديد فريد
        let newNickname;
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 20) {
            const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            newNickname = `Player_${randomCode}`;
            
            const existingUser = await User.findOne({ nickname: newNickname });
            if (!existingUser) {
                isUnique = true;
            }
            attempts++;
        }

        if (!isUnique) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c58d9eb035e5a2ab')(['❌ فشل في إنشاء لقب فريد، يرجى المحاولة لاحقاً']) });
            return null;
        }

        const identifier = classifyIdentifier(mentionedJid);
        user.nickname = newNickname;
        user.jid = identifier.jid || mentionedJid;
        user.phoneNumber = identifier.identifierType === 'phone_jid' ? identifier.phoneNumber : null;
        user.lid = identifier.identifierType === 'lid_jid' || identifier.identifierType === 'raw_lid' ? identifier.lid : null;
        user.rawLid = identifier.identifierType === 'raw_lid' ? identifier.rawLid : null;
        user.identifierType = identifier.identifierType;
        user.countryCode = identifier.countryCode;
        user.countryName = identifier.countryName;
        user.mention = formatCleanMentionText(mentionedJid, identifier);
        
        try {
            await user.save();

            await sock.sendMessage(jid, { 
                text: dashboardReply('reply_9def18ad885b3470')`✅ تم تسجيل العضو بنجاح!\n\n🎖️ لقبه: *${newNickname}*\n🔗 منشنه: ${user.mention}\n\n💡 يمكنه الآن الاستمتاع بالألعاب والأنشطة!`,
                mentions: [mentionedJid]
            });

            console.log(`✅ تم إنشاء مستخدم جديد: ${newNickname} مع المنشن ${user.mention}`);
            return newNickname;
        } catch (saveError) {
            console.error('خطأ في حفظ المستخدم:', saveError);
            await sock.sendMessage(jid, { text: dashboardReply('reply_08743ca685cac30f')(['❌ حدث خطأ في حفظ بيانات العضو!']) });
            return null;
        }
    } catch (error) {
        console.error('خطأ في استرجاع/إنشاء اللقب:', error.message);
        await sock.sendMessage(jid, { text: dashboardReply('reply_86d6877893978385')(['❌ حدث خطأ في معالجة المنشن!']) });
        return null;
    }
}

// عرض جميع المستخدمين
export async function showAllUsers(sock, jid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر صراحة
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // فلترة المستخدمين بناءً على المملكة
        const allUsers = await User.find({ kingdom_id: kingdom });

        if (allUsers.length === 0) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_bd67249a52447cc8')(['❌ لا يوجد مستخدمين مسجلين!']) });
            return;
        }

        // تقسيم المستخدمين حسب الرتبة
        const superAdmins = allUsers.filter(u => u.role === 'super_admin');
        const admins = allUsers.filter(u => u.role === 'admin');
        let mods = allUsers.filter(u => u.role === 'moderator');
        let members = allUsers.filter(u => u.role === 'member' && !u.isBanned);
        const banned = allUsers.filter(u => u.isBanned);

        // ترتيب المشرفين حسب نجوم الرتبة
        mods.sort((a, b) => (b.rankStars || 0) - (a.rankStars || 0));
        // ترتيب الأعضاء حسب النقاط
        members.sort((a, b) => (b.points || 0) - (a.points || 0));

        let message = dashboardReply('reply_cca0a1d744cd2117')`📊 تقرير جميع المستخدمين\n`;
        message += dashboardReply('reply_3d6d0299e14f380c')`━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        // ملخص الإحصائيات
        message += dashboardReply('reply_b6ced8b5660d4392')`📈 الإحصائيات:\n`;
        message += dashboardReply('reply_c6212c48b91ad211')`👥 إجمالي المستخدمين: ${allUsers.length}\n`;
        message += dashboardReply('reply_0743c1be006271ef')`👑 الأدمن الرئيسي: ${superAdmins.length}\n`;
        message += dashboardReply('reply_c5aeb1dc48711ef1')`👑 الأدمن العادي: ${admins.length}\n`;
        message += dashboardReply('reply_d5fb65fd91586b92')`🔰 المشرفين: ${mods.length}\n`;
        message += dashboardReply('reply_c7244e0363343b87')`👤 الأعضاء: ${members.length}\n`;
        message += dashboardReply('reply_624547cc17b582e3')`🚫 المحظورين: ${banned.length}\n\n`;

        // الأدمن الرئيسي
        if (superAdmins.length > 0) {
            message += dashboardReply('reply_bc2d991751882cf0')`👑 الأدمن الرئيسي (${superAdmins.length}):\n`;
            message += dashboardReply('reply_97581f0ccf91c9a7')`━━━━━━━━━━━━━━━━\n`;
            superAdmins.forEach((admin, i) => {
                message += dashboardReply('reply_469d74e3c0ca09b6')`${i + 1}. ${admin.nickname}\n`;
                message += dashboardReply('reply_24c34ea34c123855')`   💰 نقاط: ${admin.points || 0} | 💰 عملات: ${admin.coins}\n`;
            });
            message += `\n`;
        }

        // الأدمن العادي
        if (admins.length > 0) {
            message += dashboardReply('reply_0e11251e2c8408d2')`👑 الأدمن العادي (${admins.length}):\n`;
            message += dashboardReply('reply_97581f0ccf91c9a7')`━━━━━━━━━━━━━━━━\n`;
            admins.forEach((admin, i) => {
                message += dashboardReply('reply_469d74e3c0ca09b6')`${i + 1}. ${admin.nickname}\n`;
                message += dashboardReply('reply_24c34ea34c123855')`   💰 نقاط: ${admin.points || 0} | 💰 عملات: ${admin.coins}\n`;
            });
            message += `\n`;
        }

        // المشرفين
        if (mods.length > 0) {
            message += dashboardReply('reply_08325038d536fc9f')`🔰 المشرفين (${mods.length}):\n`;
            message += dashboardReply('reply_97581f0ccf91c9a7')`━━━━━━━━━━━━━━━━\n`;
            mods.forEach((mod, i) => {
                message += dashboardReply('reply_fa629532d3e6a417')`${i + 1}. ${mod.nickname}\n`;
                message += dashboardReply('reply_54e36fc664e0b678')`   💰 نقاط: ${mod.points || 0} | 💰 عملات: ${mod.coins}\n`;
            });
            message += `\n`;
        }

        // الأعضاء العاديين
        if (members.length > 0) {
            message += dashboardReply('reply_be4a49501dce32d9')`👤 الأعضاء (${members.length}):\n`;
            message += dashboardReply('reply_97581f0ccf91c9a7')`━━━━━━━━━━━━━━━━\n`;
            members.forEach((member, i) => {
                message += dashboardReply('reply_6e90befb00199db8')`${i + 1}. ${member.nickname}\n`;
                message += dashboardReply('reply_0485074d35e3ae2d')`   💰 نقاط: ${member.points || 0} | 💰 عملات: ${member.coins}\n`;
            });
            message += `\n`;
        }

        // المحظورين
        if (banned.length > 0) {
            message += dashboardReply('reply_b3580d118ea18a16')`🚫 المحظورين (${banned.length}):\n`;
            message += dashboardReply('reply_97581f0ccf91c9a7')`━━━━━━━━━━━━━━━━\n`;
            banned.forEach((user, i) => {
                message += dashboardReply('reply_0241495a47c4252a')`${i + 1}. ${user.nickname}\n`;
                message += dashboardReply('reply_9fba2425a1b4ac52')`   السبب: ${user.banReason || 'لم يتم تحديد السبب'}\n`;
            });
        }

        // إذا كانت الرسالة طويلة جداً، قسمها
        if (message.length > 4096) {
            // الرسالة الأولى (إحصائيات + أدمنز + مشرفين)
            let firstMessage = dashboardReply('reply_cca0a1d744cd2117')`📊 تقرير جميع المستخدمين\n`;
            firstMessage += dashboardReply('reply_3d6d0299e14f380c')`━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            firstMessage += dashboardReply('reply_b6ced8b5660d4392')`📈 الإحصائيات:\n`;
            firstMessage += dashboardReply('reply_c6212c48b91ad211')`👥 إجمالي المستخدمين: ${allUsers.length}\n`;
            firstMessage += dashboardReply('reply_6bf99411a2ed75e5')`👑 الأدمنز: ${admins.length}\n`;
            firstMessage += dashboardReply('reply_d5fb65fd91586b92')`🔰 المشرفين: ${mods.length}\n`;
            firstMessage += dashboardReply('reply_c7244e0363343b87')`👤 الأعضاء: ${members.length}\n`;
            firstMessage += dashboardReply('reply_624547cc17b582e3')`🚫 المحظورين: ${banned.length}\n\n`;

            if (admins.length > 0) {
                firstMessage += dashboardReply('reply_ea7bc6f11fe6b2b6')`👑 الأدمن الرئيسي (${admins.length}):\n`;
                firstMessage += dashboardReply('reply_97581f0ccf91c9a7')`━━━━━━━━━━━━━━━━\n`;
                admins.forEach((admin, i) => {
                    firstMessage += dashboardReply('reply_469d74e3c0ca09b6')`${i + 1}. ${admin.nickname}\n`;
                    firstMessage += dashboardReply('reply_24c34ea34c123855')`   💰 نقاط: ${admin.points || 0} | 💰 عملات: ${admin.coins}\n`;
                });
            }

            if (mods.length > 0) {
                firstMessage += dashboardReply('reply_5a020b3331db7801')`\n🔰 المشرفين (${mods.length}):\n`;
                firstMessage += dashboardReply('reply_97581f0ccf91c9a7')`━━━━━━━━━━━━━━━━\n`;
                mods.forEach((mod, i) => {
                    firstMessage += dashboardReply('reply_fa629532d3e6a417')`${i + 1}. ${mod.nickname}\n`;
                    firstMessage += dashboardReply('reply_54e36fc664e0b678')`   💰 نقاط: ${mod.points || 0} | 💰 عملات: ${mod.coins}\n`;
                });
            }

            await sock.sendMessage(jid, { text: firstMessage });

            // الرسالة الثانية (الأعضاء وغيرهم)
            let secondMessage = dashboardReply('reply_be4a49501dce32d9')`👤 الأعضاء (${members.length}):\n`;
            secondMessage += dashboardReply('reply_97581f0ccf91c9a7')`━━━━━━━━━━━━━━━━\n`;
            members.forEach((member, i) => {
                secondMessage += dashboardReply('reply_6e90befb00199db8')`${i + 1}. ${member.nickname}\n`;
                secondMessage += dashboardReply('reply_0485074d35e3ae2d')`   💰 نقاط: ${member.points || 0} | 💰 عملات: ${member.coins}\n`;
            });

            if (banned.length > 0) {
                secondMessage += dashboardReply('reply_81263496371d0dc0')`\n🚫 المحظورين (${banned.length}):\n`;
                secondMessage += dashboardReply('reply_97581f0ccf91c9a7')`━━━━━━━━━━━━━━━━\n`;
                banned.forEach((user, i) => {
                    secondMessage += dashboardReply('reply_0241495a47c4252a')`${i + 1}. ${user.nickname}\n`;
                    secondMessage += dashboardReply('reply_9fba2425a1b4ac52')`   السبب: ${user.banReason || 'لم يتم تحديد السبب'}\n`;
                });
            }

            await sock.sendMessage(jid, { text: secondMessage });
        } else {
            await sock.sendMessage(jid, { text: message });
        }
    } catch (error) {
        console.error('خطأ في عرض جميع المستخدمين:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_9ae5fb57b56f556e')(['❌ حدث خطأ في عرض البيانات!']) });
    }
}
// حذف بيانات المستخدم (فقط الأدمن الرئيسي)
export async function deleteUser(sock, jid, targetNickname, adminJid) {
    try {
        // التحقق من أن المستخدم أدمن رئيسي
        const isSuperAdminUser = await isSuperAdmin(adminJid);
        if (!isSuperAdminUser) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_d6ddb097108d2c3b')(['❌ فقط الأدمن الرئيسي يستطيع حذف بيانات المستخدمين!']) });
            return false;
        }

        // البحث عن المستخدم
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' } });
        if (!user) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_7b14529f261b6d8c')(['❌ لم يتم العثور على المستخدم!']) });
            return false;
        }

        // منع حذف الأدمن الرئيسي
        const targetIsSuperAdmin = await isSuperAdmin(user.jid);
        if (targetIsSuperAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_eb3f1f9845bc409d')(['❌ لا يمكن حذف بيانات الأدمن الرئيسي!']) });
            return false;
        }

        // حفظ اسم المستخدم قبل الحذف
        const deletedNickname = user.nickname;

        // حذف المستخدم
        await User.deleteOne({ nickname: user.nickname });

        await sock.sendMessage(jid, { text: dashboardReply('reply_26ab8bb159b7f673')`✅ تم حذف بيانات المستخدم "${deletedNickname}" بنجاح!` });
        return true;
    } catch (error) {
        console.error('خطأ في حذف بيانات المستخدم:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_f486617a3df5a790')(['❌ حدث خطأ في حذف البيانات!']) });
        return false;
    }
}

// عرض تأكيد الحذف مع عدد المستخدمين بدون لقب
export async function showDeleteWithoutNicknameConfirmation(sock, jid, adminJid) {
    try {
        // البحث عن عدد الأعضاء بدون لقب (شامل للأسماء الافتراضية التي تبدأ بـ User_)
        const usersWithoutNickname = await User.find({ 
            $or: [
                { nickname: null },
                { nickname: '' },
                { nickname: undefined },
                { nickname: { $regex: '^User_', $options: 'i' } }
            ]
        });

        if (usersWithoutNickname.length === 0) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_e5e91d2f8299509c')(['✅ لا توجد بيانات بدون لقب للحذف!']) });
            return;
        }

        const count = usersWithoutNickname.length;
        const confirmMessage = dashboardReply('reply_7af4c675dcbf43b1')`⚠️ *تحذير - عملية حذف نهائية!*

📊 *الإحصائيات:*
━━━━━━━━━━━━━━━━━━━━
👥 عدد المستخدمين المراد حذفهم: *${count}*
📋 سيتم حذف جميع بيانات هؤلاء المستخدمين نهائياً
🔄 هذه العملية *غير قابلة للعكس!*
━━━━━━━━━━━━━━━━━━━━

✅ لتأكيد الحذف اكتب:
/تأكيد_حذف_بدون_لقب`;

        await sock.sendMessage(jid, { text: confirmMessage });
    } catch (error) {
        console.error('خطأ في عرض تأكيد الحذف:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_88d65b10e5b95d2e')(['❌ حدث خطأ في الحصول على البيانات!']) });
    }
}

// حذف جميع الأعضاء بدون لقب (فقط الأدمن الرئيسي)
export async function deleteUsersWithoutNickname(sock, jid, adminJid) {
    try {
        // التحقق من أن المستخدم أدمن رئيسي
        const isSuperAdminUser = await isSuperAdmin(adminJid);
        if (!isSuperAdminUser) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_e08e1dad0d7fd1f6')(['❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!']) });
            return false;
        }

        // البحث عن جميع الأعضاء بدون لقب (شامل للأسماء الافتراضية التي تبدأ بـ User_)
        const usersWithoutNickname = await User.find({ 
            $or: [
                { nickname: null },
                { nickname: '' },
                { nickname: undefined },
                { nickname: { $regex: '^User_', $options: 'i' } }
            ]
        });

        if (usersWithoutNickname.length === 0) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_e5e91d2f8299509c')(['✅ لا توجد بيانات بدون لقب للحذف!']) });
            return true;
        }

        const deletedCount = usersWithoutNickname.length;

        // حذف جميع الأعضاء بدون لقب (شامل للأسماء الافتراضية التي تبدأ بـ User_)
        await User.deleteMany({ 
            $or: [
                { nickname: null },
                { nickname: '' },
                { nickname: undefined },
                { nickname: { $regex: '^User_', $options: 'i' } }
            ]
        });

        // إرسال رسالة تأكيد مفصلة
        const confirmMessage = dashboardReply('reply_cf4b4bc4ad7b7ef5')`✅ *تم حذف البيانات بنجاح!*

📊 *الإحصائيات:*
━━━━━━━━━━━━━━━━━━━━
👥 عدد المحذوفين: *${deletedCount}*
⏰ التاريخ: *${new Date().toLocaleString('ar-SA')}
🗑️ تم حذف جميع البيانات المرتبطة
━━━━━━━━━━━━━━━━━━━━

💡 ملاحظة: تم الحفاظ على جميع الأعضاء الذين لهم لقب مسجل.`;

        await sock.sendMessage(jid, { text: confirmMessage });
        console.log(`✅ تم حذف ${deletedCount} مستخدم بدون لقب من قبل ${adminJid}`);
        
        return true;
    } catch (error) {
        console.error('خطأ في حذف الأعضاء بدون لقب:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_f486617a3df5a790')(['❌ حدث خطأ في حذف البيانات!']) });
        return false;
    }
}

// إضافة نجوم رتبة للعضو (فقط الأدمن الرئيسي)
export async function addRankStars(sock, jid, targetNickname, amount, adminJid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // التحقق من أن المستخدم أدمن رئيسي
        const isSuperAdminUser = await isSuperAdmin(adminJid);
        if (!isSuperAdminUser) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_2e42c266627948b4')(['❌ فقط الأدمن الرئيسي يستطيع إضافة نجوم الرتبة!'])
            });
            return false;
        }

        // الحصول على المستخدم المراد إضافة النجوم له بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_d2f7a7683f73761f')(['❌ لم يتم العثور على هذا المستخدم!'])
            });
            return false;
        }

        const oldRankStars = user.rankStarsByKingdom?.[kingdom] || 0;
        const oldRank = getHighestRank(kingdom, oldRankStars);

        if (!user.rankStarsByKingdom) user.rankStarsByKingdom = {};
        user.rankStarsByKingdom[kingdom] = oldRankStars + amount;
        user.dailyRankStarsEarned = (Number(user.dailyRankStarsEarned) || 0) + amount;
        user.markModified('rankStarsByKingdom');
        
        // تحديث الرتبة تلقائياً بناءً على النجوم الجديدة
        const { updateUserRank } = await import('./rankSystem.js');
        const rankUpdate = updateUserRank(user, kingdom);
        
        await user.save();

        let message = dashboardReply('reply_3154c46e3264f8cd')`⭐ تم إضافة ${amount} نجمة رتبة لـ ${user.nickname}!\nمجموع نجومه: ${user.rankStarsByKingdom[kingdom]}`;
        
        if (rankUpdate.changed) {
            const oldRankText = formatDisplayRank(kingdom, rankUpdate.oldRank);
            const newRankText = formatDisplayRank(kingdom, rankUpdate.newRank);
            message += dashboardReply('reply_82a46c93fbda6757')`\n🎖️ ترقية: ${oldRankText} → ${newRankText}`;
        } else {
            message += dashboardReply('reply_74e09fb1293027f3')`\n👑 رتبة المملكة: ${formatDisplayRank(kingdom, rankUpdate.newRank, '❌ بدون رتبة')}`;
        }

        await sock.sendMessage(jid, { text: message });

        // إرسال رسالة الترقية إذا تغيرت الرتبة
        if (rankUpdate.newRank && rankUpdate.newRank !== rankUpdate.oldRank) {
            await sendPromotionMessage(sock, jid, user, rankUpdate.oldRank, rankUpdate.newRank, adminJid);
        }

        return true;
    } catch (error) {
        console.error('خطأ في إضافة نجوم الرتبة:', error);
        return false;
    }
}

// إزالة نجوم رتبة من العضو (الأدمن والمشرفين)
export async function removeRankStars(sock, jid, targetNickname, amount, modJid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // التحقق من أن المستخدم أدمن أو مشرف
        const isSuperAdminUser = await isSuperAdmin(modJid);
        const mod = await User.findOne({ jid: modJid, kingdom_id: kingdom });
        if (!mod || (!isSuperAdminUser && mod.role !== 'admin' && mod.role !== 'moderator')) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_556aba20adf14982')(['❌ فقط الأدمنز والمشرفين يستطيعون إزالة نجوم الرتبة!'])
            });
            return false;
        }

        // الحصول على المستخدم المراد إزالة النجوم منه بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_d2f7a7683f73761f')(['❌ لم يتم العثور على هذا المستخدم!'])
            });
            return false;
        }

        const oldRankStars = user.rankStarsByKingdom?.[kingdom] || 0;
        const oldRank = getHighestRank(kingdom, oldRankStars);

        if (!user.rankStarsByKingdom) user.rankStarsByKingdom = {};
        user.rankStarsByKingdom[kingdom] = Math.max(0, oldRankStars - amount);
        user.markModified('rankStarsByKingdom');
        
        // تحديث الرتبة تلقائياً بناءً على النجوم الجديدة
        const { updateUserRank } = await import('./rankSystem.js');
        const rankUpdate = updateUserRank(user, kingdom);
        
        await user.save();

        let message = dashboardReply('reply_f0b19751d5d14e9a')`⭐ تم إزالة ${amount} نجمة رتبة من ${user.nickname}!\nمجموع نجومه: ${user.rankStarsByKingdom[kingdom]}`;
        
        if (rankUpdate.changed) {
            const oldRankText = formatDisplayRank(kingdom, rankUpdate.oldRank);
            const newRankText = formatDisplayRank(kingdom, rankUpdate.newRank);
            message += dashboardReply('reply_86e1675726618e4d')`\n🎖️ تغيير رتبة: ${oldRankText} → ${newRankText}`;
        } else {
            message += dashboardReply('reply_74e09fb1293027f3')`\n👑 رتبة المملكة: ${formatDisplayRank(kingdom, rankUpdate.newRank, '❌ بدون رتبة')}`;
        }

        await sock.sendMessage(jid, { text: message });

        // إرسال رسالة الترقية إذا تغيرت الرتبة (لكن هنا تنزيل)
        // ربما لا نحتاج لرسالة تنزيل، لكن إذا أردنا، يمكن إضافة

        return true;
    } catch (error) {
        console.error('خطأ في إزالة نجوم الرتبة:', error);
        return false;
    }
}

// منح رتبة تتطلب قرار الإمبراطور (فقط للإمبراطور)
export async function grantEmperorDecisionRank(sock, jid, targetNickname, rankKey, emperorJid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // التحقق من أن المستخدم هو الإمبراطور
        const emperor = await User.findOne({ jid: emperorJid, kingdom_id: kingdom });
        const emperorRank = emperor?.kingdomRankByKingdom?.[kingdom];
        if (!emperor || emperorRank !== 'emperor') {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_7377f228911240a0')(['❌ فقط الإمبراطور يستطيع منح الرتب التي تتطلب قراره!'])
            });
            return false;
        }

        // التحقق من أن الرتبة تتطلب قرار الإمبراطور
        const rankData = (kingdomRanks[kingdom] || kingdomRanks.clover)?.[rankKey];
        if (!rankData || !rankData.requiresEmperorDecision) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_e4a807e4eba30bcc')(['❌ هذه الرتبة لا تتطلب قرار الإمبراطور أو غير موجودة!'])
            });
            return false;
        }

        // الحصول على المستخدم المراد منحه الرتبة
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_d2f7a7683f73761f')(['❌ لم يتم العثور على هذا المستخدم!'])
            });
            return false;
        }

        const oldRank = user.kingdomRankByKingdom?.[kingdom];
        
        // منح الرتبة وتعيين أنها ممنوحة (لا تتغير بالنجوم)
        if (!user.kingdomRankByKingdom) user.kingdomRankByKingdom = {};
        if (!user.rankStarsByKingdom) user.rankStarsByKingdom = {};
        const previousRankStars = Number(user.rankStarsByKingdom[kingdom]) || 0;
        user.kingdomRankByKingdom[kingdom] = rankKey;
        user.rankStarsByKingdom[kingdom] = Math.max(previousRankStars, Number(rankData.requiredStars) || 0);
        user.dailyRankStarsEarned = (Number(user.dailyRankStarsEarned) || 0) + Math.max(0, user.rankStarsByKingdom[kingdom] - previousRankStars);
        user.markModified('kingdomRankByKingdom');
        user.markModified('rankStarsByKingdom');
        user.isRankGranted = true;
        await user.save();

        // رسالة التأكيد
        await sock.sendMessage(jid, {
            text: dashboardReply('reply_ecef17e294f9ef5d')`✅ تم منح رتبة ${rankData.emoji} ${rankData.name} للاعب ${user.nickname} بقرار من الإمبراطور!\n🎖️ نجوم الرتبة: ${user.rankStarsByKingdom[kingdom]}`
        });

        // إرسال رسالة للاعب بالترقية
        try {
            const mention = getCleanMentionTextForUser(user);
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_e8bd4aa090335cb9')`🎖️ مبروك ${mention}! تم ترقيتك إلى رتبة ${rankData.emoji} ${rankData.name} بقرار من الإمبراطور!\n✨ شرف عظيم!`,
                mentions: [user.jid]
            });
        } catch (e) {
            console.log('خطأ في إرسال رسالة الترقية:', e);
        }

        return true;
    } catch (error) {
        console.error('خطأ في منح رتبة الإمبراطور:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_ad269521821ecb15')(['❌ حدث خطأ في منح الرتبة!']) });
        return false;
    }
}

// التحقق من الترقية التلقائية
export async function checkAutoRankPromotion(user, kingdom = 'clover') {
    if (!user.autoRankPromotion) {
        return { promoted: false };
    }

    // إذا الرتبة الحالية تتطلب قرار الإمبراطور، لا نغيرها تلقائياً
    const currentStored = user.kingdomRankByKingdom?.[kingdom];
    if (currentStored && (kingdomRanks[kingdom] || kingdomRanks.clover)?.[currentStored]?.requiresEmperorDecision) {
        return { promoted: false };
    }

    const rankStars = user.rankStarsByKingdom?.[kingdom] || 0;
    const newRank = getHighestRank(kingdom, rankStars);

    if (newRank && newRank !== currentStored) {
        // تم الحصول على رتبة جديدة عبر النجوم
        const rankInfo = getRankInfo(kingdom, newRank);
        if (!user.kingdomRankByKingdom) user.kingdomRankByKingdom = {};
        user.kingdomRankByKingdom[kingdom] = newRank;
        user.markModified('kingdomRankByKingdom');
        await user.save();

        return {
            promoted: true,
            rankInfo: rankInfo,
            oldRank: currentStored
        };
    }

    return { promoted: false };
}

// إرسال رسالة الترقية
async function sendPromotionMessage(sock, jid, user, oldRank, newRank, admin, mentionedJid = null) {
    try {
        const rankKingdom = user.kingdom_id || 'clover';
        const oldRankInfo = getDisplayRankInfo(rankKingdom, oldRank, 'عضو');
        const newRankInfo = getDisplayRankInfo(rankKingdom, newRank);

        // التحقق من أن newRankInfo موجود
        if (!newRankInfo || newRankInfo.name === 'رتبة غير معروفة') {
            console.warn(`تحذير: لم يتم العثور على بيانات الرتبة للرتبة: ${newRank}`);
            return;
        }

        const kingdomName = KINGDOMS[rankKingdom]?.name || rankKingdom;
        const signature = await getPromotionSignature(admin, rankKingdom);
        const mention = getPromotionMentionText(user);

        const promotionMessage = `*⎔⋅• ┗╼╃✦⊰⟦﷽⟧⊱✦╄╾┛ •⋅⎔*
*˼‏🍀˹╎تـعـلـن إدارة ${kingdomName} عـن ⇟*
*━╍∘╾╃✧⊰ ⌝🍀⌞ ⊱✧╄ ╼∘╍━*
         *⌝ ترقية╎🎖️
*╼─━╍╃✧⊰🍀」⊱✧╄╍━─╾*  
*˼‏🎓┆الــلــقــب 彡「${user.nickname}」*

*˼‏🍂┆الـمـنـ@ـشـن »「 ${mention}」*

*˼‏🎻┆مــن مـنـصـب 巛「${oldRankInfo.name}」*

*˼‏⚕️┆إلـى مـنـصـب 巛「${newRankInfo.name}」*

*شـاكـريـن لـه/ا عـلـى كـل جـهـد بـذلـه/بـذلـتـه* *ومـتـمـنـيـن لـه/ا دوام الـتـوفـيـق والسـداد والنـجـاح في جـمـيـع الأمـور🌕⚔️ ⸙*
*╼─━╍╃✧⊰「🍀」⊱✧╄╍━─╾*
*❀《تـــوقــيـع》↡*
*⸂✦┋﹝${signature}﹞┋✦⸃*

*━╍∘╾╃✧⊰ 🍀 ⊱✧╄ ╼∘╍━*`;

        const messageOptions = { text: renderBotTemplate('promotion', { nickname: user.nickname, mention, kingdomName, oldRank: oldRankInfo.name, newRank: newRankInfo.name, signature }, promotionMessage) };
        // استخدام user.jid دائماً مع المنشن المحفوظ
        if (user.jid) {
            messageOptions.mentions = [user.jid];
        }

        await sock.sendMessage(jid, messageOptions);
    } catch (error) {
        console.error('خطأ في إرسال رسالة الترقية:', error);
    }
}

// منح رتبة الإمبراطور بكلمة سر (فقط الأدمن الرئيسي) - بدء العملية
export async function initiateEmperorGrant(sock, jid, targetNickname, adminJid, kingdom = null) {
    try {
        // تحديد المملكة إذا لم تُمرر
        if (!kingdom) {
            kingdom = getKingdomIdFromGroupJid(jid);
        }

        // التحقق من أن المستخدم أدمن رئيسي
        const admin = await User.findOne({ jid: adminJid, kingdom_id: kingdom });
        if (!admin || admin.role !== 'admin') {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_063883924c5a9a8a')(['❌ فقط الأدمن الرئيسي يستطيع منح رتبة الإمبراطور!'])
            });
            return false;
        }

        // الحصول على المستخدم المراد منحه الرتبة بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_d2f7a7683f73761f')(['❌ لم يتم العثور على هذا المستخدم!'])
            });
            return false;
        }

        // التحقق من أنه ليس لديه رتبة إمبراطور بالفعل
        if (user.kingdomRankByKingdom?.[kingdom] === 'emperor') {
            await sock.sendMessage(jid, {
                text: dashboardReply('reply_cac78760dec61b61')(['⚠️ هذا العضو لديه رتبة الإمبراطور بالفعل!'])
            });
            return false;
        }

        // إضافة إلى قائمة الانتظار
        const { awaitingEmperorPassword } = await import('../handlers/messageHandler.js');
        awaitingEmperorPassword.set(adminJid, {
            nickname: targetNickname,
            groupJid: jid
        });

        // إرسال رسالة تأكيد في المجموعة
        await sock.sendMessage(jid, {
            text: dashboardReply('reply_34cc6e3f001eea83')`🔐 تم إرسال طلب منح رتبة الإمبراطور لـ ${targetNickname} إلى الخاص الخاص بك.`
        });

        // إرسال رسالة في الخاص تطلب كلمة السر
        await sock.sendMessage(adminJid, {
            text: dashboardReply('reply_e8ab1d1eb34049eb')`🔑 لمنح رتبة الإمبراطور لـ ${targetNickname}، أدخل كلمة المرور:`
        });

        return true;
    } catch (error) {
        console.error('خطأ في بدء منح رتبة الإمبراطور:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_2bbb9cbd7c1c48dc')(['❌ حدث خطأ في بدء العملية!']) });
        return false;
    }
}

// منح رتبة الإمبراطور بكلمة سر (للاستدعاء الداخلي)
export async function grantEmperorRankWithPassword(sock, jid, targetNickname, password, adminJid) {
    try {
        const kingdom = getKingdomIdFromGroupJid(jid);
        // التحقق من كلمة المرور (لكن هنا تم التحقق بالفعل)
        const { ADMIN_PASSWORD, ADMIN_PASSWORD_CONFIGURED } = await import('../config.js');
        if (!ADMIN_PASSWORD_CONFIGURED) {
            await sock.sendMessage(adminJid, { text: dashboardReply('reply_f5aa05241197fc49')(['❌ كلمة مرور الأدمن غير مضبوطة في ملف البيئة ADMIN_PASSWORD.']) });
            return false;
        }

        if (password !== ADMIN_PASSWORD) {
            await sock.sendMessage(adminJid, { text: dashboardReply('reply_55c7325e1328a018')(['❌ كلمة المرور غير صحيحة!']) });
            return false;
        }

        // الحصول على المستخدم
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(adminJid, { text: dashboardReply('reply_7b14529f261b6d8c')(['❌ لم يتم العثور على المستخدم!']) });
            return false;
        }

        // منح الرتبة وتعيين أنها ممنوحة (لا تتغير بالنجوم)
        if (!user.kingdomRankByKingdom) user.kingdomRankByKingdom = {};
        if (!user.rankStarsByKingdom) user.rankStarsByKingdom = {};
        const previousRankStars = Number(user.rankStarsByKingdom[kingdom]) || 0;
        user.kingdomRankByKingdom[kingdom] = 'emperor';
        user.isRankGranted = true;
        const emperorRank = getRankInfo(kingdom, 'emperor');
        user.rankStarsByKingdom[kingdom] = Math.max(previousRankStars, emperorRank?.requiredStars || 350000);
        user.dailyRankStarsEarned = (Number(user.dailyRankStarsEarned) || 0) + Math.max(0, user.rankStarsByKingdom[kingdom] - previousRankStars);
        user.markModified('kingdomRankByKingdom');
        user.markModified('rankStarsByKingdom');
        await user.save();

        // إرسال رسالة تأكيد في الخاص
        await sock.sendMessage(adminJid, {
            text: dashboardReply('reply_e49e601c6c5b86e7')`✅ تم منح رتبة الإمبراطور لـ ${targetNickname} بنجاح!\n🎖️ نجوم الرتبة: ${user.rankStarsByKingdom[kingdom]}\n✨ شرف عظيم!`
        });

        // إرسال رسالة تأكيد في المجموعة
        await sock.sendMessage(jid, {
            text: dashboardReply('reply_e3a359ff93b7be67')`👑 تم منح رتبة الإمبراطور لـ ${targetNickname} بنجاح!\n🎖️ نجوم الرتبة: ${user.rankStarsByKingdom[kingdom]}\n✨ شرف عظيم!`
        });

        // إرسال رسالة للاعب بالترقية
        try {
            await sock.sendMessage(user.jid, {
                text: dashboardReply('reply_9f450ecd8f9c5b43')`🎖️ مبروك! تم منحك رتبة الإمبراطور بقرار من الأدمن الرئيسي!\n✨ شرف عظيم!`
            });
        } catch (e) {
            console.log('لم يتمكن من إرسال رسالة للاعب مباشرة');
        }

        return true;
    } catch (error) {
        console.error('خطأ في منح رتبة الإمبراطور:', error);
        await sock.sendMessage(adminJid, { text: dashboardReply('reply_ad269521821ecb15')(['❌ حدث خطأ في منح الرتبة!']) });
        return false;
    }
}

// معالجة تعيين المنشن الجديد
export async function handleAssignMention(sock, jid, sender, mentionedJid, nickname, realMention = null) {
    try {
        // التحقق من الصلاحيات (أدمن أو مشرف فقط)
        const kingdom = getKingdomIdFromGroupJid(jid);
        const isAdminOrMod = await isAdmin(sender, kingdom) || await isModerator(sender, kingdom);
        if (!isAdminOrMod) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_03e67497903fafac')(['❌ هذا الأمر متاح للأدمن والمشرفين فقط!']) });
            return false;
        }

        if (!mentionedJid) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_dced804e08505eaf')(['❌ لم يتم العثور على منشن صحيح!']) });
            return false;
        }

        if (!nickname || typeof nickname !== 'string') {
            await sock.sendMessage(jid, { text: dashboardReply('reply_9227163734f1ebeb')(['❌ اسم المستخدم غير صحيح!']) });
            return false;
        }

        // التحقق من وجود المنشن الحقيقي من الرسالة
        if (!realMention) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_1ad0ef4081e12b55')(['يرجى إرسال المنشن الجديد بالصيغة @المنشن']) });
            return false;
        }

        // البحث عن المستخدم
        const user = await User.findOne({ nickname: { $regex: nickname, $options: 'i' } });
        if (!user) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_a055f5b97fcda5ed')`❌ لم يتم العثور على مستخدم باسم "${nickname}"!` });
            return false;
        }

        const identifier = classifyIdentifier(mentionedJid);
        user.jid = identifier.jid || mentionedJid;
        user.phoneNumber = identifier.identifierType === 'phone_jid' ? identifier.phoneNumber : null;
        user.lid = identifier.identifierType === 'lid_jid' || identifier.identifierType === 'raw_lid' ? identifier.lid : null;
        user.rawLid = identifier.identifierType === 'raw_lid' ? identifier.rawLid : null;
        user.identifierType = identifier.identifierType;
        user.countryCode = identifier.countryCode;
        user.countryName = identifier.countryName;
        user.mention = formatCleanMentionText(mentionedJid, identifier);
        if (user.mention && user.mention.startsWith('@') && user.identifierType === 'unknown' && /^\d+$/.test(user.mention.slice(1))) {
            user.mention = `@${user.mention.slice(1)}`;
        }
        await user.save();

        await sock.sendMessage(jid, {
            text: dashboardReply('reply_10883609a35965f7')`✅ تم تعيين المنشن ${user.mention} للعضو ${user.nickname} بنجاح!`
        });

        return true;
    } catch (error) {
        console.error('خطأ في تعيين المنشن:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_86d6877893978385')(['❌ حدث خطأ في معالجة المنشن!']) });
        return false;
    }
}

// معالجة تغيير المنشن واستبدال البيانات القديمة
export async function handleChangeMention(sock, jid, sender, mentionedJid, oldNickname, realMention = null) {
    try {
        // التحقق من الصلاحيات (أدمن أو مشرف فقط)
        const kingdom = getKingdomIdFromGroupJid(jid);
        const isAdminOrMod = await isAdmin(sender, kingdom) || await isModerator(sender, kingdom);
        if (!isAdminOrMod) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_03e67497903fafac')(['❌ هذا الأمر متاح للأدمن والمشرفين فقط!']) });
            return false;
        }

        if (!mentionedJid) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_dced804e08505eaf')(['❌ لم يتم العثور على منشن صحيح!']) });
            return false;
        }

        if (!oldNickname || typeof oldNickname !== 'string') {
            await sock.sendMessage(jid, { text: dashboardReply('reply_1ad13b4c421651e5')(['❌ اسم المستخدم القديم غير صحيح!']) });
            return false;
        }

        // التحقق من وجود المنشن الحقيقي من الرسالة
        if (!realMention) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_1ad0ef4081e12b55')(['يرجى إرسال المنشن الجديد بالصيغة @المنشن']) });
            return false;
        }

        // البحث عن المستخدم القديم
        const oldUser = await User.findOne({ nickname: { $regex: oldNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!oldUser) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_1f6e1f6b2f0283b0')`❌ لم يتم العثور على مستخدم باسم "${oldNickname}"!` });
            return false;
        }

        // التحقق من أن المنشن الجديد غير مستخدم بالفعل
        const existingUser = await User.findOne({ jid: mentionedJid, kingdom_id: kingdom });
        if (existingUser && existingUser.nickname !== oldNickname) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_8aca94195074e851')(['❌ هذا المنشن مرتبط بمستخدم آخر بالفعل!']) });
            return false;
        }

        // حفظ البيانات القديمة
        const oldMention = oldUser.mention;
        const oldJid = oldUser.jid;
        const oldPhone = oldUser.phoneNumber;

        const identifier = classifyIdentifier(mentionedJid);
        oldUser.jid = identifier.jid || mentionedJid;
        oldUser.phoneNumber = identifier.identifierType === 'phone_jid' ? identifier.phoneNumber : null;
        oldUser.lid = identifier.identifierType === 'lid_jid' || identifier.identifierType === 'raw_lid' ? identifier.lid : null;
        oldUser.rawLid = identifier.identifierType === 'raw_lid' ? identifier.rawLid : null;
        oldUser.identifierType = identifier.identifierType;
        oldUser.countryCode = identifier.countryCode;
        oldUser.countryName = identifier.countryName;
        oldUser.mention = formatCleanMentionText(mentionedJid, identifier);
        await oldUser.save();

        // إرسال رسالة تأكيد بالبيانات المستبدلة
        let confirmMessage = dashboardReply('reply_66136a5c5856629b')`✅ تم تغيير منشن العضو ${oldNickname} بنجاح!\n\n`;
        confirmMessage += dashboardReply('reply_2e9ad33512c62478')`📋 *البيانات القديمة:*\n`;
        confirmMessage += dashboardReply('reply_c3ee1557fa115d59')`   • المنشن: ${oldMention || 'لم يكن مسجلاً'}\n`;
        confirmMessage += dashboardReply('reply_9bab4e9bfe4e7c1e')`   • الرقم: ${oldPhone || 'لم يكن مسجلاً'}\n\n`;
        confirmMessage += dashboardReply('reply_554c4594112fc114')`📋 *البيانات الجديدة:*\n`;
        confirmMessage += dashboardReply('reply_bbfa6a0e9477945d')`   • المنشن: ${oldUser.mention}\n`;
        confirmMessage += dashboardReply('reply_8e9b5d559d9fdf06')`   • الرقم: ${oldUser.phoneNumber}`;

        await sock.sendMessage(jid, { text: confirmMessage });

        return true;
    } catch (error) {
        console.error('خطأ في تغيير المنشن:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_86d6877893978385')(['❌ حدث خطأ في معالجة المنشن!']) });
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
// 🎮 دوال تتبع جلسات الألعاب للأداريين
// ═══════════════════════════════════════════════════════════════

/**
 * بدء جلسة لعبة - تُدعى عند بدء الأدمن/المشرف للعبة
 * @param {string} adminJid - معرف الأدمن
 * @param {string} gameName - اسم اللعبة
 * @returns {boolean} نجاح العملية
 */
export async function startGameSession(adminJid, gameName, kingdomId = null) {
    try {
        const query = kingdomId ? { jid: adminJid, kingdom_id: kingdomId } : { jid: adminJid };
        const user = await User.findOne(query);
        if (!user) {
            console.log(`لم يتم العثور على مستخدم: ${adminJid}`);
            return false;
        }

        // التحقق من عدم وجود جلسة نشطة
        const activeSession = user.gamesSessions?.find(s => !s.endTime);
        if (activeSession) {
            console.log(`يوجد جلسة نشطة: ${activeSession.gameName}`);
            // إنهاء الجلسة القديمة إن وجدت
            activeSession.endTime = new Date();
            activeSession.duration = Math.floor((activeSession.endTime - activeSession.startTime) / 1000);
        }

        // إنشاء جلسة جديدة
        const newSession = {
            gameName: gameName,
            kingdomId: kingdomId || user.kingdom_id,
            startTime: new Date(),
            endTime: null,
            duration: 0,
            startedBy: user.nickname || user.name
        };

        if (!user.gamesSessions) {
            user.gamesSessions = [];
        }
        user.gamesSessions.push(newSession);
        await user.save();

        console.log(`✅ بدء جلسة لعبة: ${gameName} بواسطة ${user.nickname}`);
        return true;
    } catch (error) {
        console.error('خطأ في بدء جلسة اللعبة:', error);
        return false;
    }
}

/**
 * إيقاف جلسة اللعبة النشطة - تُدعى عند إيقاف أي لعبة
 * @param {string} adminJid - معرف الأدمن
 * @returns {Object} بيانات الجلسة المُغلقة
 */
export async function stopGameSession(adminJid, kingdomId = null) {
    try {
        const query = kingdomId ? { jid: adminJid, kingdom_id: kingdomId } : { jid: adminJid };
        const user = await User.findOne(query);
        if (!user || !user.gamesSessions) {
            return null;
        }

        // العثور على الجلسة النشطة (بدون وقت نهاية)
        const activeSession = user.gamesSessions.find(s => !s.endTime);
        if (!activeSession) {
            console.log(`لا توجد جلسة نشطة للإيقاف: ${adminJid}`);
            return null;
        }

        // حساب المدة والإيقاف
        activeSession.endTime = new Date();
        activeSession.duration = Math.floor((activeSession.endTime - activeSession.startTime) / 1000);

        // عدم حفظ الجلسات الأقل من 30 ثانية
        if (activeSession.duration < 30) {
            console.log(`⏭️ جلسة قصيرة جداً (${activeSession.duration}ث) - لم يتم حفظها`);
            // إزالة الجلسة من المصفوفة
            user.gamesSessions.pop();
            await user.save();
            return null;
        }

        await user.save();

        console.log(`✅ إيقاف جلسة: ${activeSession.gameName} - المدة: ${activeSession.duration}ث`);
        return activeSession;
    } catch (error) {
        console.error('خطأ في إيقاف جلسة اللعبة:', error);
        return null;
    }
}

/**
 * حساب إجمالي أوقات الألعاب لليوم الحالي
 * @param {string} adminJid - معرف الأدمن
 * @returns {Object} إحصائيات الألعاب لليوم
 */
const DEFAULT_REPORT_TIME_ZONE = process.env.DAILY_REPORT_TIME_ZONE || "Asia/Amman";

function getTimeZoneDateKey(date = new Date(), timeZone = DEFAULT_REPORT_TIME_ZONE) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);
    const mapped = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${mapped.year}-${mapped.month}-${mapped.day}`;
}

export function getDailyGameStats(adminJid, user, timeZone = DEFAULT_REPORT_TIME_ZONE) {
    const todayKey = getTimeZoneDateKey(new Date(), timeZone);

    const gameStats = {};
    let totalDuration = 0;
    let sessionCount = 0;

    if (user.gamesSessions) {
        user.gamesSessions.forEach(session => {
            const sessionDateKey = getTimeZoneDateKey(new Date(session.startTime), timeZone);

            // فقط الجلسات من اليوم الحالي والمنتهية
            if (sessionDateKey === todayKey && session.endTime) {
                if (!gameStats[session.gameName]) {
                    gameStats[session.gameName] = { count: 0, totalDuration: 0 };
                }
                gameStats[session.gameName].count++;
                gameStats[session.gameName].totalDuration += session.duration;
                totalDuration += session.duration;
                sessionCount++;
            }
        });
    }

    return { gameStats, totalDuration, sessionCount };
}

/**
 * الحصول على رسالة التقرير اليومي للأدمن
 * @param {Object} user - بيانات المستخدم
 * @returns {string} نص التقرير
 */
export function generateAdminDailyReport(user, timeZone = DEFAULT_REPORT_TIME_ZONE) {
    const { gameStats, totalDuration, sessionCount } = getDailyGameStats(user.jid, user, timeZone);
    const dailyMessages = Number(user.dailyMessages) || 0;
    const dailyWelcomes = Number(user.dailyWelcomes) || 0;
    const dailyGameAnswers = Number(user.dailyGameAnswers) || 0;
    const dailyGameXp = Number(user.dailyGameXp) || 0;
    const dailyRankStarsEarned = Number(user.dailyRankStarsEarned) || 0;
    const totalXp = Number(user.xp) || 0;

    if (
        sessionCount === 0 &&
        dailyMessages === 0 &&
        dailyWelcomes === 0 &&
        dailyGameAnswers === 0 &&
        dailyRankStarsEarned === 0
    ) {
        return null;
    }

    const mention = getCleanMentionTextForUser(user);

    let report = `📊 *التقرير الإداري اليومي*\n\n`;
    report += `👤 الأدمن: *${user.nickname || user.name}*\n`;
    report += `🔗 المنشن: ${mention}\n\n`;
    report += `📅 التاريخ: ${new Date().toLocaleDateString('ar-SA')}\n\n`;
    report += `📌 *ملخص اليوم:*\n`;
    report += `• الاستقبال الناجح: ${dailyWelcomes}\n`;
    report += `• التفاعل: ${dailyMessages} رسالة\n`;
    report += `• الفعاليات المُدارة: ${sessionCount}\n`;
    report += `• المشاركة بالفعاليات: ${dailyGameAnswers} إجابة\n`;
    report += `• XP الكلي: ${totalXp}\n`;
    report += `• XP الألعاب اليوم: ${dailyGameXp}\n`;
    report += `• نجوم اليوم: ${dailyRankStarsEarned}🎖️\n`;

    if (sessionCount > 0) {
        report += `\n🎮 *جلسات الألعاب:*\n`;

        let gameIndex = 1;
        for (const [gameName, stats] of Object.entries(gameStats)) {
            const hours = Math.floor(stats.totalDuration / 3600);
            const minutes = Math.floor((stats.totalDuration % 3600) / 60);
            const seconds = stats.totalDuration % 60;

            let timeStr = '';
            if (hours > 0) timeStr += `${hours}س `;
            if (minutes > 0) timeStr += `${minutes}د `;
            if (seconds > 0 || timeStr === '') timeStr += `${seconds}ث`;

            report += `${gameIndex}️⃣ *${gameName}*\n`;
            report += `   • عدد الجلسات: ${stats.count}\n`;
            report += `   • الوقت الإجمالي: ${timeStr}\n\n`;
            gameIndex++;
        }

        // المجموع الكلي
        const totalHours = Math.floor(totalDuration / 3600);
        const totalMinutes = Math.floor((totalDuration % 3600) / 60);
        const totalSeconds = totalDuration % 60;

        let totalTimeStr = '';
        if (totalHours > 0) totalTimeStr += `${totalHours}س `;
        if (totalMinutes > 0) totalTimeStr += `${totalMinutes}د `;
        if (totalSeconds > 0 || totalTimeStr === '') totalTimeStr += `${totalSeconds}ث`;

        report += `⏱️ *الإجمالي*\n`;
        report += `   • إجمالي الجلسات: ${sessionCount}\n`;
        report += `   • الوقت الكلي: ${totalTimeStr}\n\n`;
    }

    report += `━━━━━━━━━━━━━━━━━\n`;
    report += `✨ شكراً على نشاطك اليوم.`;

    return report;
}

/**
 * إرسال التقارير اليومية لجميع الأداريين
 * @param {Object} sock - كائن الـ socket
 * @param {string} groupJid - معرف المجموعة الداخلية (التقارير)
 */
export async function sendAdminsDailyReports(sock, groupJid, kingdomId = null, timeZone = DEFAULT_REPORT_TIME_ZONE) {
    try {
        if (!groupJid) {
            console.warn('⚠️ لا يوجد قروب إدارة؛ لن يتم إرسال تقارير الإداريين.');
            return 0;
        }

        // جلب جميع الأداريين والمشرفين
        const query = {
            role: { $in: ['admin', 'moderator', 'super_admin'] }
        };

        if (kingdomId) {
            query.kingdom_id = kingdomId;
        }

        const admins = await User.find(query);

        let reportsSent = 0;
        for (const admin of admins) {
            try {
                const report = generateAdminDailyReport(admin, timeZone);
                if (!report) continue;

                // إرسال التقرير فقط في المجموعة الإدارية
                if (groupJid) {
                    const mentions = admin.jid ? [admin.jid] : [];
                    await sock.sendMessage(groupJid, { text: report, mentions });
                    reportsSent++;
                }

                // تأخير لتجنب الحد من الرسائل
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`خطأ في إرسال تقرير للأدمن ${admin.nickname}:`, error);
            }
        }

        console.log(`✅ تم إرسال ${reportsSent} تقرير إداري يومي`);
        return reportsSent;
    } catch (error) {
        console.error('خطأ في إرسال التقارير اليومية:', error);
        return 0;
    }
}

/**
 * إعادة تعيين إحصائيات الألعاب اليومية
 * تُدعى يومياً في منتصف الليل (بعد إرسال التقارير)
 */
export async function resetDailyGameStats(kingdomId = null, timeZone = DEFAULT_REPORT_TIME_ZONE) {
    try {
        // 🔄 إعادة تعيين إحصائيات المستخدمين (رسائل + ألعاب)
        const userQuery = kingdomId ? { kingdom_id: kingdomId } : {};
        const allUsers = await User.find(userQuery);
        
        let gameStatsReset = 0;
        let messageStatsReset = 0;
        let gameActivityReset = 0;
        const todayKey = getTimeZoneDateKey(new Date(), timeZone);
        
        for (const user of allUsers) {
            let updated = false;
            
            // ✅ إعادة تعيين الرسائل اليومية لجميع المستخدمين
            if (user.dailyMessages > 0) {
                user.dailyMessages = 0;
                user.lastMessageResetDate = new Date();
                messageStatsReset++;
                updated = true;
            }

            // ✅ إعادة تعيين نشاط الألعاب اليومي العام
            if ((Number(user.dailyGameAnswers) || 0) > 0 || (Number(user.dailyGameXp) || 0) > 0) {
                user.dailyGameAnswers = 0;
                user.dailyGameXp = 0;
                gameActivityReset++;
                updated = true;
            }

            if ((Number(user.dailyWelcomes) || 0) > 0) {
                user.dailyWelcomes = 0;
                updated = true;
            }

            if ((Number(user.dailyRankStarsEarned) || 0) > 0) {
                user.dailyRankStarsEarned = 0;
                updated = true;
            }
            
            // ✅ إعادة تعيين الألعاب - للأداريين فقط
            if (user.role && ['admin', 'moderator', 'super_admin'].includes(user.role)) {
                if (user.gamesSessions && user.gamesSessions.length > 0) {
                    // حذف جلسات اليوم الحالي فقط (إبقاء السجل التاريخي)
                    user.gamesSessions = user.gamesSessions.filter(session => {
                        const sessionDateKey = getTimeZoneDateKey(new Date(session.startTime), timeZone);
                        // إبقاء الجلسات القديمة، حذف جلسات اليوم
                        return sessionDateKey < todayKey;
                    });
                    
                    user.lastGamesResetDate = new Date();
                    gameStatsReset++;
                    updated = true;
                }
            }
            
            // ✅ حفظ فوري عند أي تحديث
            if (updated) {
                await user.save();
            }
        }
        
        console.log(`✅ إعادة ضبط يومية مكتملة:`);
        console.log(`   📊 رسائل يومية: ${messageStatsReset} مستخدم`);
        console.log(`   🎮 نشاط ألعاب يومي: ${gameActivityReset} مستخدم`);
        console.log(`   🎮 جلسات ألعاب: ${gameStatsReset} أدمن/مشرف`);
        
        return { gameStatsReset, messageStatsReset, gameActivityReset };
    } catch (error) {
        console.error('❌ خطأ في إعادة تعيين الإحصائيات:', error);
        return { gameStatsReset: 0, messageStatsReset: 0 };
    }
}

