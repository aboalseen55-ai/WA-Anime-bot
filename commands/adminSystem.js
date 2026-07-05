import User from "../database/userModel.js";
import Bank from "../database/bankModel.js";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { getHighestRank, getRankInfo, displayRank, getAllRanksDisplay, kingdomRanks } from "./rankSystem.js";
import { ADMINS, getKingdomFromGroupJid, getKingdomIdFromGroupJid, KINGDOMS, WELCOME_LINK } from "../config.js";

const REGION_DISPLAY_NAMES = typeof Intl === 'object' && typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

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
    const mention = getCleanMentionTextForUser(user || userJid);

    return `*~╃ ${kingdomName} ╄~*
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
${WELCOME_LINK}
*
*❀✦═══ •『🍀』• ═══✦❀*

*~╃ ${kingdomShortName} ╄~*`;
}

export function buildWorkWelcomeFormMessage({ nickname, status, enteringSource, moderatorName, kingdom }) {
    const kingdomName = getKingdomDisplayName(kingdom);

    return `*☜ اللقب 🎭 ⟦ ${nickname} ⟧ ➪*

*☜ الحالة ⚡ ⟦ ${status} ⟧ ➪*

*☜ من طرف 🔗 ⟦ ${enteringSource} ⟧ ➪*

*☜ المسؤول 🤝 ⟦ ${moderatorName || 'غير محدد'} ⟧ ➪*

*𓆩 ${kingdomName} 𓆪*`;
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
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على منشن صحيح!' });
            return null;
        }

        const identifier = classifyIdentifier(mentionedJid);
        if (identifier.identifierType !== 'phone_jid') {
            await sock.sendMessage(jid, { text: '❌ هذا المنشن لا يُمثل JID واتساب صالحاً!' });
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
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في معالجة المنشن!' });
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
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على منشن صحيح!' });
            return false;
        }

        const user = await User.findOne({ nickname: { $regex: nickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على مستخدم باسم "${nickname}"!` });
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
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في معالجة المنشن!' });
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
                text: '❌ فقط الأدمنز يستطيعون ترقية المشرفين!'
            });
            return false;
        }

        // الحصول على المستخدم المراد ترقيته بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: '❌ لم يتم العثور على هذا المستخدم!'
            });
            return false;
        }

        // إذا كان مشرفاً بالفعل نعتبر هذه ترقية ثانية لتصبح أدمن عادي
        if (user.role === 'moderator') {
            user.role = 'admin';
            await user.save();

            await sock.sendMessage(jid, {
                text: `🔰 تم ترقية ${user.nickname} من مشرف إلى أدمن بنجاح!`
            });
            // إرسال رسالة الترقية
            await sendPromotionMessage(sock, jid, user, null, 'admin', adminJid);
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
            text: `🔰 تم ترقية ${user.nickname} إلى مشرف بنجاح!`
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
                text: '❌ فقط الأدمنز يستطيعون تخفيض الرتب!'
            });
            return false;
        }

        // الحصول على المستخدم المراد تخفيفه بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: '❌ لم يتم العثور على هذا المستخدم!'
            });
            return false;
        }

        // منع تخفيض الأدمن الرئيسي
        if (user.role === 'super_admin') {
            await sock.sendMessage(jid, {
                text: '❌ لا يمكن تخفيض الأدمن الرئيسي!'
            });
            return false;
        }

        // تخفيض الرتبة حسب الدور الحالي
        if (user.role === 'moderator') {
            user.role = 'member';
            await user.save();
            await sock.sendMessage(jid, {
                text: `👤 تم تخفيض ${user.nickname} من رتبة المشرفين إلى عضو عادي!`
            });
        } else if (user.role === 'admin') {
            user.role = 'moderator';
            await user.save();
            await sock.sendMessage(jid, {
                text: `👤 تم تخفيض ${user.nickname} من رتبة الأدمن إلى مشرف!`
            });
        } else {
            await sock.sendMessage(jid, {
                text: '⚠️ هذا العضو لا يحتاج إلى تخفيض!'
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
                text: '❌ فقط الأدمنز يستطيعون إضافة النقاط!'
            });
            return false;
        }

        // الحصول على المستخدم المراد إضافة النقاط له بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: '❌ لم يتم العثور على هذا المستخدم!'
            });
            return false;
        }

        user.points = (user.points || 0) + amount;
        await user.save();

        await sock.sendMessage(jid, {
            text: `💰 تم إضافة ${amount} نقطة لـ ${user.nickname}!\nمجموع نقاطه: ${user.points}`
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
                text: '❌ فقط الأدمنز والمشرفين يستطيعون إزالة النقاط!'
            });
            return false;
        }

        // الحصول على المستخدم المراد إزالة النقاط منه بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: '❌ لم يتم العثور على هذا المستخدم!'
            });
            return false;
        }

        user.points = Math.max(0, (user.points || 0) - amount);
        await user.save();

        await sock.sendMessage(jid, {
            text: `💰 تم إزالة ${amount} نقطة من ${user.nickname}!\nمجموع نقاطه: ${user.points}`
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
                text: '❌ فقط الأدمن الرئيسي في هذه المملكة يستطيع إضافة العملات!'
            });
            return false;
        }

        // الحصول على المستخدم المراد إضافة العملات له بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: `❌ لم يتم العثور على العضو "${targetNickname}" في هذه المملكة!`
            });
            return false;
        }

        user.coins = (user.coins || 0) + amount;
        await user.save();

        await sock.sendMessage(jid, {
            text: `💰 تم إضافة ${amount} عملة لـ ${user.nickname}!\nمجموع عملاته: ${user.coins}`
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
                text: '❌ فقط الأدمنز يستطيعون إزالة العملات!'
            });
            return false;
        }

        // الحصول على المستخدم المراد إزالة العملات منه بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: `❌ لم يتم العثور على العضو "${targetNickname}" في هذه المملكة!`
            });
            return false;
        }

        user.coins = Math.max(0, (user.coins || 0) - amount);
        await user.save();

        await sock.sendMessage(jid, {
            text: `💰 تم إزالة ${amount} عملة من ${user.nickname}!\nمجموع عملاته: ${user.coins}`
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
                text: '❌ فقط الأدمنز والمشرفين يستطيعون طرد الأعضاء!'
            });
            return false;
        }

        // الحصول على بيانات العضو المراد طرده بالـ nickname
        const user = await findUserByNickname(targetNickname, kingdom);
        if (!user) {
            await sock.sendMessage(jid, {
                text: '❌ لم يتم العثور على هذا المستخدم!'
            });
            return false;
        }

        // منع الأدمن العادي من طرد الأدمن الرئيسي
        if (user.role === 'super_admin' && !isSuper) {
            await sock.sendMessage(jid, {
                text: '❌ لا يمكن طرد الأدمن الرئيسي!'
            });
            return false;
        }

        // منع الأدمن العادي من طرد أدمن آخر
        if (user.role === 'admin' && !isSuper) {
            await sock.sendMessage(jid, {
                text: '❌ لا يمكن طرد الأدمن إلا من قبل أدمن رئيسي!'
            });
            return false;
        }

        // منع المشرف من طرد الأدمنز أو المشرفين الآخرين
        if ((user.role === 'admin' || user.role === 'super_admin' || user.role === 'moderator') && mod.role === 'moderator') {
            await sock.sendMessage(jid, {
                text: '❌ المشرفون لا يمكنهم طرد الأدمنز أو المشرفين الآخرين!'
            });
            return false;
        }

        // طرد فعلي من المجموعة
        try {
            await sock.groupParticipantsUpdate(jid, [{ action: 'remove', participants: [user.jid] }]);
        } catch (error) {
            console.error('خطأ في الطرد الفعلي:', error);
            await sock.sendMessage(jid, { text: '❌ فشل في طرد العضو من المجموعة!' });
            return false;
        }

        // إزالة المجموعة من قائمة مجموعات العضو
        user.groups = user.groups.filter(g => g !== jid);
        await user.save();

        await sock.sendMessage(jid, {
            text: `🚫 تم طرد ${user.nickname} من المجموعة فعلياً!\n\nهل تريد حذف بياناته من قاعدة البيانات؟\nأجب بنعم أو لا.`
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
                text: '❌ فقط الأدمنز والمشرفين يستطيعون حظر الأعضاء!'
            });
            return false;
        }

        // الحصول على المستخدم المراد حظره بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: '❌ لم يتم العثور على هذا المستخدم!'
            });
            return false;
        }

        // منع المشرف من حظر الأدمن الرئيسي
        if (user.role === 'super_admin' && admin.role === 'moderator') {
            await sock.sendMessage(jid, {
                text: '❌ المشرفون لا يمكنهم حظر الأدمن الرئيسي!'
            });
            return false;
        }

        // منع الأدمن العادي من حظر الأدمن الرئيسي
        if (user.role === 'super_admin' && !isSuper) {
            await sock.sendMessage(jid, {
                text: '❌ لا يمكن حظر الأدمن الرئيسي!'
            });
            return false;
        }

        // حظره
        user.isBanned = true;
        user.bannedAt = new Date();
        user.banReason = reason;
        await user.save();

        await sock.sendMessage(jid, {
            text: `🚫 تم حظر ${user.nickname}!\nالسبب: ${reason}`
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
                text: '❌ فقط الأدمنز والمشرفين يستطيعون إزالة الحظر!'
            });
            return false;
        }

        // الحصول على المستخدم بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: '❌ لم يتم العثور على هذا المستخدم!'
            });
            return false;
        }

        // إزالة الحظر
        user.isBanned = false;
        user.bannedAt = null;
        user.banReason = null;
        await user.save();

        await sock.sendMessage(jid, {
            text: `✅ تم إزالة الحظر عن ${user.nickname}!`
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
            kingdom = getKingdomIdFromGroupJid(jid) || 'clover';
        }
        
        // استخدم دالة البحث المحسّنة لتجنب مطابقة أجزاء من الألقاب الطويلة
        const user = await findUserByNickname(targetNickname, kingdom);
        if (!user) {
            await sock.sendMessage(jid, {
                text: '❌ لم يتم العثور على هذا المستخدم!'
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

        let message = `${roleEmoji} معلومات ${user.nickname}\n`;
        message += `━━━━━━━━━━━━━━━━━\n`;
        message += `📛 اللقب: ${user.nickname}\n`;
        message += `🎖️ الرتبة الإدارية: ${roleText}\n`;
        message += `👑 رتبة المملكة: ${kingdomRankDisplay}\n`;
        message += `💰 النقاط: ${user.points || 0}\n`;
        message += `🎖️ نجوم الرتب: ${rankStars}\n`;
        message += `💰 العملات: ${user.coins}\n`;
        message += `🏦 البنك: ${user.bankCoins || 0}\n`;
        message += `📊 الرسائل اليومية: ${user.dailyMessages || 0}\n`;
        message += `�📅 تاريخ الانضمام: ${user.createdAt.toLocaleDateString('ar-EG')}\n`;

        if (user.isBanned) {
            message += `🚫 محظور - السبب: ${user.banReason}\n`;
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
        kingdom = 'clover'; // افتراضياً
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
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على حسابك!' });
            return false;
        }

        if (amount <= 0) {
            await sock.sendMessage(jid, { text: '❌ المبلغ يجب أن يكون أكبر من صفر!' });
            return false;
        }

        if (user.coins < amount) {
            await sock.sendMessage(jid, { text: '❌ ليس لديك عملات كافية!' });
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
            text: `🏦 تم إيداع ${amount} عملة في البنك بنجاح!\n💰 رصيدك الآن: ${user.coins}\n🏦 رصيدك في البنك: ${user.bankCoins}`
        });

        return true;
    } catch (error) {
        console.error('خطأ في الإيداع:', error);
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في الإيداع!' });
        return false;
    }
}

// سحب من البنك
export async function withdrawFromBank(sock, jid, sender, amount) {
    try {
        const kingdom = getKingdomIdFromGroupJid(jid);
        const user = await User.findOne({ jid: sender, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على حسابك!' });
            return false;
        }

        if (amount <= 0) {
            await sock.sendMessage(jid, { text: '❌ المبلغ يجب أن يكون أكبر من صفر!' });
            return false;
        }

        if ((user.bankCoins || 0) < amount) {
            await sock.sendMessage(jid, { text: '❌ ليس لديك عملات كافية في البنك!' });
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
            text: `🏦 تم سحب ${amount} عملة من البنك بنجاح!\n💰 رصيدك الآن: ${user.coins}\n🏦 رصيدك في البنك: ${user.bankCoins}`
        });

        return true;
    } catch (error) {
        console.error('خطأ في السحب:', error);
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في السحب!' });
        return false;
    }
}

// عرض رصيد البنك للمستخدم
export async function showBankBalance(sock, jid, sender) {
    try {
        const kingdom = getKingdomIdFromGroupJid(jid);
        const user = await User.findOne({ jid: sender, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على حسابك!' });
            return;
        }

        const bank = await getBankInfo(kingdom);

        let message = `🏦 معلومات حسابك البنكي\n`;
        message += `━━━━━━━━━━━━━━━━━━━━\n`;
        message += `💰 عملاتك: ${user.coins}\n`;
        message += `🏦 رصيدك في البنك: ${user.bankCoins || 0}\n`;
        message += `🏛️ إجمالي البنك: ${bank.totalCoins}\n`;

        await sock.sendMessage(jid, { text: message });
    } catch (error) {
        console.error('خطأ في عرض الرصيد:', error);
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في عرض الرصيد!' });
    }
}

// تحويل عملات بين الأعضاء
export async function transferCoinsBetweenUsers(sock, jid, sender, recipientNickname, amount) {
    try {
        const kingdom = getKingdomIdFromGroupJid(jid);
        const senderUser = await User.findOne({ jid: sender, kingdom_id: kingdom });
        if (!senderUser) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على حسابك!' });
            return false;
        }

        if (amount <= 0) {
            await sock.sendMessage(jid, { text: '❌ المبلغ يجب أن يكون أكبر من صفر!' });
            return false;
        }

        if (senderUser.coins < amount) {
            await sock.sendMessage(jid, { text: '❌ ليس لديك عملات كافية!' });
            return false;
        }

        // البحث عن المستلم
        const recipientUser = await findUserByNickname(recipientNickname, kingdom);
        if (!recipientUser) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على المستلم!' });
            return false;
        }

        if (recipientUser.jid === sender) {
            await sock.sendMessage(jid, { text: '❌ لا يمكنك التحويل لنفسك!' });
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
            text: `✅ تم التحويل بنجاح!\n💰 تم إرسال ${amount} عملة إلى ${recipientUser.nickname}\n💰 رصيدك الآن: ${senderUser.coins}`
        });

        // إشعار المستلم
        const recipientMention = getCleanMentionTextForUser(recipientUser);
        await sock.sendMessage(jid, {
            text: `💰 ${recipientMention} استلم ${amount} عملة من ${senderUser.nickname}!\n💰 رصيده الآن: ${recipientUser.coins}`,
            mentions: [recipientUser.jid]
        });

        return true;
    } catch (error) {
        console.error('خطأ في التحويل:', error);
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في التحويل!' });
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

        let message = `🏛️ إحصائيات البنك\n`;
        message += `━━━━━━━━━━━━━━━━\n`;
        message += `💰 إجمالي العملات: ${bank.totalCoins}\n`;
        message += `👥 عدد المودعين: ${users.length}\n`;
        message += `📊 عدد المعاملات: ${bank.transactions.length}\n\n`;

        if (users.length > 0) {
            message += `🏦 أكبر المودعين:\n`;
            users.sort((a, b) => (b.bankCoins || 0) - (a.bankCoins || 0)).slice(0, 5).forEach((u, i) => {
                message += `${i + 1}. ${u.nickname} - ${u.bankCoins} عملة\n`;
            });
        }

        await sock.sendMessage(jid, { text: message });
    } catch (error) {
        console.error('خطأ في عرض إحصائيات البنك:', error);
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في عرض الإحصائيات!' });
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

        let message = `👑 الأدمنز والمشرفين\n`;
        message += `━━━━━━━━━━━━━━━━━\n\n`;

        if (superAdmins.length > 0) {
            message += `👑 الأدمن الرئيسي:\n`;
            superAdmins.forEach((admin, i) => {
                const rankStars = admin.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = admin.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌ لا توجد رتبة';
                message += `${i + 1}. ${admin.nickname} 💰${admin.points || 0} 🎖️${rankStars} 👑${kr} 🏦${admin.bankCoins || 0}\n`;
            });
            message += `\n`;
        }

        if (admins.length > 0) {
            message += `👑 الأدمن العادي:\n`;
            admins.forEach((admin, i) => {
                const rankStars = admin.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = admin.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌ لا توجد رتبة';
                message += `${i + 1}. ${admin.nickname} 💰${admin.points || 0} 🎖️${admin.rankStars || 0} 👑${kr} 🏦${admin.bankCoins || 0}\n`;
            });
            message += `\n`;
        }

        if (mods.length > 0) {
            message += `🔰 المشرفين:\n`;
            mods.forEach((mod, i) => {
                const rankStars = mod.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = mod.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌ لا توجد رتبة';
                message += `${i + 1}. ${mod.nickname} 💰${mod.points || 0} 🎖️${rankStars} 👑${kr} 🏦${mod.bankCoins || 0}\n`;
            });
        } else {
            message += `🔰 لا يوجد مشرفين\n`;
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

        let message = `📋 القائمة الكاملة للمستخدمين\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        // الأدمن الرئيسي
        if (superAdmins.length > 0) {
            message += `👑 الأدمن الرئيسي (${superAdmins.length}):\n`;
            superAdmins.forEach((admin, i) => {
                const rankStars = admin.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = admin.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌ لا توجد رتبة';
                message += `${i + 1}. ${admin.nickname}\n`;
                message += `   JID: ${admin.jid}\n`;
                message += `   💰 نقاط: ${admin.points || 0} | 🎖️ نجوم رتبة: ${rankStars} | 👑 رتبة المملكة: ${kr} | 💰 عملات: ${admin.coins} | 🏦 بنك: ${admin.bankCoins || 0}\n\n`;
            });
        }

        // الأدمن العادي
        if (admins.length > 0) {
            message += `👑 الأدمن العادي (${admins.length}):\n`;
            admins.forEach((admin, i) => {
                const rankStars = admin.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = admin.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌ لا توجد رتبة';
                message += `${i + 1}. ${admin.nickname}\n`;
                message += `   JID: ${admin.jid}\n`;
                message += `   💰 نقاط: ${admin.points || 0} | 🎖️ نجوم رتبة: ${rankStars} | 👑 رتبة المملكة: ${kr} | 💰 عملات: ${admin.coins} | 🏦 بنك: ${admin.bankCoins || 0}\n\n`;
            });
        }

        // المشرفين
        if (mods.length > 0) {
            message += `🔰 المشرفين (${mods.length}):\n`;
            mods.forEach((mod, i) => {
                message += `${i + 1}. ${mod.nickname}\n`;
                message += `   JID: ${mod.jid}\n`;
                const rankStars = mod.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = mod.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌ لا توجد رتبة';
                message += `   💰 نقاط: ${mod.points || 0} | 🎖️ نجوم رتبة: ${rankStars} | 👑 رتبة المملكة: ${kr} | 💰 عملات: ${mod.coins} | 🏦 بنك: ${mod.bankCoins || 0}\n\n`;
            });
        }

        // الأعضاء العاديين
        if (members.length > 0) {
            message += `👥 الأعضاء العاديين (${members.length}):\n`;
            members.slice(0, 10).forEach((member, i) => {
                const rankStars = member.rankStarsByKingdom?.[kingdom] || 0;
                const kingdomRank = member.kingdomRankByKingdom?.[kingdom];
                const kr = displayRank(kingdom, kingdomRank || getHighestRank(kingdom, rankStars)) || '❌';
                message += `${i + 1}. ${member.nickname} - 💰${member.points || 0} | 👑${kr}\n`;
            });
            if (members.length > 10) {
                message += `... و ${members.length - 10} آخرين\n`;
            }
            message += `\n`;
        }

        // المحظورين
        if (banned.length > 0) {
            message += `🚫 المحظورين (${banned.length}):\n`;
            banned.forEach((user, i) => {
                message += `${i + 1}. ${user.nickname}\n`;
                message += `   JID: ${user.jid}\n`;
                message += `   السبب: ${user.banReason || 'لم يتم تحديده'}\n\n`;
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

        let message = `👥 قائمة الأعضاء\n`;
        message += `━━━━━━━━━━━━━━\n`;
        message += `إجمالي الأعضاء: ${members.length}\n\n`;

        members.forEach((member, i) => {
            message += `${i + 1}. ${member.nickname}\n`;
            message += `   JID: ${member.jid}\n`;
            message += `   💰 نقاط: ${member.points || 0} | 🎖️ نجوم رتبة: ${member.rankStars || 0} | 💰 عملات: ${member.coins} | 🏦 بنك: ${member.bankCoins || 0}\n\n`;
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
            await sock.sendMessage(jid, { text: '❌ اللقب الجديد لا يمكن أن يكون فارغاً!' });
            return false;
        }

        // تنظيف اللقب الجديد
        newNickname = newNickname.trim();

        // التحقق من أن اللقب الجديد غير مستخدم
        const existingUser = await User.findOne({ nickname: { $regex: new RegExp(`^${newNickname}$`, 'i') } });
        if (existingUser && existingUser.nickname !== currentNickname) {
            await sock.sendMessage(jid, { text: '❌ هذا اللقب مستخدم بالفعل!' });
            return false;
        }

        // الحصول على المستخدم الحالي (الذي يتم تغيير لقبه)
        const user = await User.findOne({ nickname: { $regex: currentNickname, $options: 'i' } });
        if (!user) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على المستخدم!' });
            return false;
        }

        // التحقق من الصلاحيات
        const requester = await User.findOne({ jid: requesterJid });
        
        // هل المطلب هو الأدمن أو مشرف أو الأدمن الرئيسي؟
        const isMod = requester && (requester.role === 'moderator' || requester.role === 'admin' || requester.role === 'super_admin');
        
        // هل يحاول تغيير لقبه الخاص؟
        const isOwnNickname = user.jid === requesterJid;

        if (!isMod && !isOwnNickname) {
            await sock.sendMessage(jid, { text: '❌ يمكنك تغيير لقبك الخاص فقط!' });
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
            successMessage = `✅ تم تحديث لقبك من *${oldNickname}* إلى *${newNickname}*!`;
        } else {
            successMessage = `✅ تم تغيير لقب *${oldNickname}* إلى *${newNickname}*\nبواسطة: ${requester.nickname}`;
        }

        await sock.sendMessage(jid, { text: successMessage });
        return true;
    } catch (error) {
        console.error('خطأ في تغيير اللقب:', error);
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في تغيير اللقب!' });
        return false;
    }
}

// استرجاع اللقب أو إنشاء واحد جديد للعضو
export async function retrieveOrCreateNickname(sock, jid, mentionedJid) {
    try {
        // التحقق من JID
        if (!mentionedJid) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على منشن صحيح!' });
            return null;
        }

        // البحث عن المستخدم بناءً على JID المنشن عليه
        let user = await User.findOne({ jid: mentionedJid });

        // إذا كان المستخدم موجود وله لقب
        if (user && user.nickname) {
            // التحقق من منشنه
            if (user.mention) {
                await sock.sendMessage(jid, { 
                    text: `✅ لقب العضو محفوظ: *${user.nickname}*\n🔗 منشنه المسجل: ${user.mention}`,
                    mentions: [mentionedJid]
                });
            } else {
                // لديه لقب لكن بدون منشن، تحديث المنشن
                try {
                    user.mention = formatCleanMentionText(mentionedJid);
                    user.lid = null;
                    await user.save();

                    await sock.sendMessage(jid, { 
                        text: `✅ لقب العضو محفوظ: *${user.nickname}*\n🔗 تم تحديث منشنه: ${user.mention}`,
                        mentions: [mentionedJid]
                    });
                } catch (saveError) {
                    console.error('خطأ في تحديث المنشن:', saveError);
                    await sock.sendMessage(jid, { text: '⚠️ تم العثور على لقب العضو لكن حدث خطأ في تحديث المنشن' });
                }
            }
            return user.nickname;
        }

        // إنشاء مستخدم جديد أو استكمال البيانات
        if (!user) {
            // التحقق من عدم وجود مستخدم بنفس JID من قبل
            user = new User({
                jid: mentionedJid,
                kingdom_id: 'clover'
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
            await sock.sendMessage(jid, { text: '❌ فشل في إنشاء لقب فريد، يرجى المحاولة لاحقاً' });
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
                text: `✅ تم تسجيل العضو بنجاح!\n\n🎖️ لقبه: *${newNickname}*\n🔗 منشنه: ${user.mention}\n\n💡 يمكنه الآن الاستمتاع بالألعاب والأنشطة!`,
                mentions: [mentionedJid]
            });

            console.log(`✅ تم إنشاء مستخدم جديد: ${newNickname} مع المنشن ${user.mention}`);
            return newNickname;
        } catch (saveError) {
            console.error('خطأ في حفظ المستخدم:', saveError);
            await sock.sendMessage(jid, { text: '❌ حدث خطأ في حفظ بيانات العضو!' });
            return null;
        }
    } catch (error) {
        console.error('خطأ في استرجاع/إنشاء اللقب:', error.message);
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في معالجة المنشن!' });
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
            await sock.sendMessage(jid, { text: '❌ لا يوجد مستخدمين مسجلين!' });
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

        let message = `📊 تقرير جميع المستخدمين\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        // ملخص الإحصائيات
        message += `📈 الإحصائيات:\n`;
        message += `👥 إجمالي المستخدمين: ${allUsers.length}\n`;
        message += `👑 الأدمن الرئيسي: ${superAdmins.length}\n`;
        message += `👑 الأدمن العادي: ${admins.length}\n`;
        message += `🔰 المشرفين: ${mods.length}\n`;
        message += `👤 الأعضاء: ${members.length}\n`;
        message += `🚫 المحظورين: ${banned.length}\n\n`;

        // الأدمن الرئيسي
        if (superAdmins.length > 0) {
            message += `👑 الأدمن الرئيسي (${superAdmins.length}):\n`;
            message += `━━━━━━━━━━━━━━━━\n`;
            superAdmins.forEach((admin, i) => {
                message += `${i + 1}. ${admin.nickname}\n`;
                message += `   💰 نقاط: ${admin.points || 0} | 💰 عملات: ${admin.coins}\n`;
            });
            message += `\n`;
        }

        // الأدمن العادي
        if (admins.length > 0) {
            message += `👑 الأدمن العادي (${admins.length}):\n`;
            message += `━━━━━━━━━━━━━━━━\n`;
            admins.forEach((admin, i) => {
                message += `${i + 1}. ${admin.nickname}\n`;
                message += `   💰 نقاط: ${admin.points || 0} | 💰 عملات: ${admin.coins}\n`;
            });
            message += `\n`;
        }

        // المشرفين
        if (mods.length > 0) {
            message += `🔰 المشرفين (${mods.length}):\n`;
            message += `━━━━━━━━━━━━━━━━\n`;
            mods.forEach((mod, i) => {
                message += `${i + 1}. ${mod.nickname}\n`;
                message += `   💰 نقاط: ${mod.points || 0} | 💰 عملات: ${mod.coins}\n`;
            });
            message += `\n`;
        }

        // الأعضاء العاديين
        if (members.length > 0) {
            message += `👤 الأعضاء (${members.length}):\n`;
            message += `━━━━━━━━━━━━━━━━\n`;
            members.forEach((member, i) => {
                message += `${i + 1}. ${member.nickname}\n`;
                message += `   💰 نقاط: ${member.points || 0} | 💰 عملات: ${member.coins}\n`;
            });
            message += `\n`;
        }

        // المحظورين
        if (banned.length > 0) {
            message += `🚫 المحظورين (${banned.length}):\n`;
            message += `━━━━━━━━━━━━━━━━\n`;
            banned.forEach((user, i) => {
                message += `${i + 1}. ${user.nickname}\n`;
                message += `   السبب: ${user.banReason || 'لم يتم تحديد السبب'}\n`;
            });
        }

        // إذا كانت الرسالة طويلة جداً، قسمها
        if (message.length > 4096) {
            // الرسالة الأولى (إحصائيات + أدمنز + مشرفين)
            let firstMessage = `📊 تقرير جميع المستخدمين\n`;
            firstMessage += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            firstMessage += `📈 الإحصائيات:\n`;
            firstMessage += `👥 إجمالي المستخدمين: ${allUsers.length}\n`;
            firstMessage += `👑 الأدمنز: ${admins.length}\n`;
            firstMessage += `🔰 المشرفين: ${mods.length}\n`;
            firstMessage += `👤 الأعضاء: ${members.length}\n`;
            firstMessage += `🚫 المحظورين: ${banned.length}\n\n`;

            if (admins.length > 0) {
                firstMessage += `👑 الأدمن الرئيسي (${admins.length}):\n`;
                firstMessage += `━━━━━━━━━━━━━━━━\n`;
                admins.forEach((admin, i) => {
                    firstMessage += `${i + 1}. ${admin.nickname}\n`;
                    firstMessage += `   💰 نقاط: ${admin.points || 0} | 💰 عملات: ${admin.coins}\n`;
                });
            }

            if (mods.length > 0) {
                firstMessage += `\n🔰 المشرفين (${mods.length}):\n`;
                firstMessage += `━━━━━━━━━━━━━━━━\n`;
                mods.forEach((mod, i) => {
                    firstMessage += `${i + 1}. ${mod.nickname}\n`;
                    firstMessage += `   💰 نقاط: ${mod.points || 0} | 💰 عملات: ${mod.coins}\n`;
                });
            }

            await sock.sendMessage(jid, { text: firstMessage });

            // الرسالة الثانية (الأعضاء وغيرهم)
            let secondMessage = `👤 الأعضاء (${members.length}):\n`;
            secondMessage += `━━━━━━━━━━━━━━━━\n`;
            members.forEach((member, i) => {
                secondMessage += `${i + 1}. ${member.nickname}\n`;
                secondMessage += `   💰 نقاط: ${member.points || 0} | 💰 عملات: ${member.coins}\n`;
            });

            if (banned.length > 0) {
                secondMessage += `\n🚫 المحظورين (${banned.length}):\n`;
                secondMessage += `━━━━━━━━━━━━━━━━\n`;
                banned.forEach((user, i) => {
                    secondMessage += `${i + 1}. ${user.nickname}\n`;
                    secondMessage += `   السبب: ${user.banReason || 'لم يتم تحديد السبب'}\n`;
                });
            }

            await sock.sendMessage(jid, { text: secondMessage });
        } else {
            await sock.sendMessage(jid, { text: message });
        }
    } catch (error) {
        console.error('خطأ في عرض جميع المستخدمين:', error);
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في عرض البيانات!' });
    }
}
// حذف بيانات المستخدم (فقط الأدمن الرئيسي)
export async function deleteUser(sock, jid, targetNickname, adminJid) {
    try {
        // التحقق من أن المستخدم أدمن رئيسي
        const isSuperAdminUser = await isSuperAdmin(adminJid);
        if (!isSuperAdminUser) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع حذف بيانات المستخدمين!' });
            return false;
        }

        // البحث عن المستخدم
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' } });
        if (!user) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على المستخدم!' });
            return false;
        }

        // منع حذف الأدمن الرئيسي
        const targetIsSuperAdmin = await isSuperAdmin(user.jid);
        if (targetIsSuperAdmin) {
            await sock.sendMessage(jid, { text: '❌ لا يمكن حذف بيانات الأدمن الرئيسي!' });
            return false;
        }

        // حفظ اسم المستخدم قبل الحذف
        const deletedNickname = user.nickname;

        // حذف المستخدم
        await User.deleteOne({ nickname: user.nickname });

        await sock.sendMessage(jid, { text: `✅ تم حذف بيانات المستخدم "${deletedNickname}" بنجاح!` });
        return true;
    } catch (error) {
        console.error('خطأ في حذف بيانات المستخدم:', error);
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في حذف البيانات!' });
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
            await sock.sendMessage(jid, { text: '✅ لا توجد بيانات بدون لقب للحذف!' });
            return;
        }

        const count = usersWithoutNickname.length;
        const confirmMessage = `⚠️ *تحذير - عملية حذف نهائية!*

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
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في الحصول على البيانات!' });
    }
}

// حذف جميع الأعضاء بدون لقب (فقط الأدمن الرئيسي)
export async function deleteUsersWithoutNickname(sock, jid, adminJid) {
    try {
        // التحقق من أن المستخدم أدمن رئيسي
        const isSuperAdminUser = await isSuperAdmin(adminJid);
        if (!isSuperAdminUser) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!' });
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
            await sock.sendMessage(jid, { text: '✅ لا توجد بيانات بدون لقب للحذف!' });
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
        const confirmMessage = `✅ *تم حذف البيانات بنجاح!*

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
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في حذف البيانات!' });
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
                text: '❌ فقط الأدمن الرئيسي يستطيع إضافة نجوم الرتبة!'
            });
            return false;
        }

        // الحصول على المستخدم المراد إضافة النجوم له بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: '❌ لم يتم العثور على هذا المستخدم!'
            });
            return false;
        }

        const oldRankStars = user.rankStarsByKingdom?.[kingdom] || 0;
        const oldRank = getHighestRank(kingdom, oldRankStars);

        if (!user.rankStarsByKingdom) user.rankStarsByKingdom = {};
        user.rankStarsByKingdom[kingdom] = oldRankStars + amount;
        user.markModified('rankStarsByKingdom');
        
        // تحديث الرتبة تلقائياً بناءً على النجوم الجديدة
        const { updateUserRank } = await import('./rankSystem.js');
        const rankUpdate = updateUserRank(user, kingdom);
        
        await user.save();

        let message = `⭐ تم إضافة ${amount} نجمة رتبة لـ ${user.nickname}!\nمجموع نجومه: ${user.rankStarsByKingdom[kingdom]}`;
        
        if (rankUpdate.changed) {
            message += `\n🎖️ ترقية: ${rankUpdate.oldRank || 'بدون رتبة'} → ${rankUpdate.newRank || 'بدون رتبة'}`;
        } else {
            message += `\n👑 رتبة المملكة: ${rankUpdate.newRank || '❌ بدون رتبة'}`;
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
                text: '❌ فقط الأدمنز والمشرفين يستطيعون إزالة نجوم الرتبة!'
            });
            return false;
        }

        // الحصول على المستخدم المراد إزالة النجوم منه بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: '❌ لم يتم العثور على هذا المستخدم!'
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

        let message = `⭐ تم إزالة ${amount} نجمة رتبة من ${user.nickname}!\nمجموع نجومه: ${user.rankStarsByKingdom[kingdom]}`;
        
        if (rankUpdate.changed) {
            message += `\n🎖️ تغيير رتبة: ${rankUpdate.oldRank || 'بدون رتبة'} → ${rankUpdate.newRank || 'بدون رتبة'}`;
        } else {
            message += `\n👑 رتبة المملكة: ${rankUpdate.newRank || '❌ بدون رتبة'}`;
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
                text: '❌ فقط الإمبراطور يستطيع منح الرتب التي تتطلب قراره!'
            });
            return false;
        }

        // التحقق من أن الرتبة تتطلب قرار الإمبراطور
        const rankData = (kingdomRanks[kingdom] || kingdomRanks.clover)?.[rankKey];
        if (!rankData || !rankData.requiresEmperorDecision) {
            await sock.sendMessage(jid, {
                text: '❌ هذه الرتبة لا تتطلب قرار الإمبراطور أو غير موجودة!'
            });
            return false;
        }

        // الحصول على المستخدم المراد منحه الرتبة
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: '❌ لم يتم العثور على هذا المستخدم!'
            });
            return false;
        }

        const oldRank = user.kingdomRankByKingdom?.[kingdom];
        
        // منح الرتبة وتعيين أنها ممنوحة (لا تتغير بالنجوم)
        if (!user.kingdomRankByKingdom) user.kingdomRankByKingdom = {};
        user.kingdomRankByKingdom[kingdom] = rankKey;
        user.markModified('kingdomRankByKingdom');
        user.isRankGranted = true;
        await user.save();

        // رسالة التأكيد
        await sock.sendMessage(jid, {
            text: `✅ تم منح رتبة ${rankData.emoji} ${rankData.name} للاعب ${user.nickname} بقرار من الإمبراطور!`
        });

        // إرسال رسالة للاعب بالترقية
        try {
            const mention = getCleanMentionTextForUser(user);
            await sock.sendMessage(jid, {
                text: `🎖️ مبروك ${mention}! تم ترقيتك إلى رتبة ${rankData.emoji} ${rankData.name} بقرار من الإمبراطور!\n✨ شرف عظيم!`,
                mentions: [user.jid]
            });
        } catch (e) {
            console.log('خطأ في إرسال رسالة الترقية:', e);
        }

        return true;
    } catch (error) {
        console.error('خطأ في منح رتبة الإمبراطور:', error);
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في منح الرتبة!' });
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
        const oldRankInfo = oldRank ? getRankInfo(rankKingdom, oldRank) : null;
        let newRankInfo = null;

        if (newRank === 'moderator') {
            newRankInfo = { name: 'مشرف', emoji: '🔰' };
        } else if (newRank === 'admin') {
            newRankInfo = { name: 'أدمن', emoji: '👑' };
        } else {
            newRankInfo = getRankInfo(rankKingdom, newRank);
        }

        // التحقق من أن newRankInfo موجود
        if (!newRankInfo) {
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

*˼‏🎻┆مــن مـنـصـب 巛「${oldRankInfo ? oldRankInfo.name : 'عضو'}」*

*˼‏⚕️┆إلـى مـنـصـب 巛「${newRankInfo.name}」*

*شـاكـريـن لـه/ا عـلـى كـل جـهـد بـذلـه/بـذلـتـه* *ومـتـمـنـيـن لـه/ا دوام الـتـوفـيـق والسـداد والنـجـاح في جـمـيـع الأمـور🌕⚔️ ⸙*
*╼─━╍╃✧⊰「🍀」⊱✧╄╍━─╾*
*❀《تـــوقــيـع》↡*
*⸂✦┋﹝${signature}﹞┋✦⸃*

*━╍∘╾╃✧⊰ 🍀 ⊱✧╄ ╼∘╍━*`;

        const messageOptions = { text: promotionMessage };
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
                text: '❌ فقط الأدمن الرئيسي يستطيع منح رتبة الإمبراطور!'
            });
            return false;
        }

        // الحصول على المستخدم المراد منحه الرتبة بالـ nickname
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, {
                text: '❌ لم يتم العثور على هذا المستخدم!'
            });
            return false;
        }

        // التحقق من أنه ليس لديه رتبة إمبراطور بالفعل
        if (user.kingdomRankByKingdom?.[kingdom] === 'emperor') {
            await sock.sendMessage(jid, {
                text: '⚠️ هذا العضو لديه رتبة الإمبراطور بالفعل!'
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
            text: `🔐 تم إرسال طلب منح رتبة الإمبراطور لـ ${targetNickname} إلى الخاص الخاص بك.`
        });

        // إرسال رسالة في الخاص تطلب كلمة السر
        await sock.sendMessage(adminJid, {
            text: `🔑 لمنح رتبة الإمبراطور لـ ${targetNickname}، أدخل كلمة المرور:`
        });

        return true;
    } catch (error) {
        console.error('خطأ في بدء منح رتبة الإمبراطور:', error);
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في بدء العملية!' });
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
            await sock.sendMessage(adminJid, { text: '❌ كلمة مرور الأدمن غير مضبوطة في ملف البيئة ADMIN_PASSWORD.' });
            return false;
        }

        if (password !== ADMIN_PASSWORD) {
            await sock.sendMessage(adminJid, { text: '❌ كلمة المرور غير صحيحة!' });
            return false;
        }

        // الحصول على المستخدم
        const user = await User.findOne({ nickname: { $regex: targetNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(adminJid, { text: '❌ لم يتم العثور على المستخدم!' });
            return false;
        }

        // منح الرتبة وتعيين أنها ممنوحة (لا تتغير بالنجوم)
        if (!user.kingdomRankByKingdom) user.kingdomRankByKingdom = {};
        if (!user.rankStarsByKingdom) user.rankStarsByKingdom = {};
        user.kingdomRankByKingdom[kingdom] = 'emperor';
        user.isRankGranted = true;
        user.rankStarsByKingdom[kingdom] = Math.max(user.rankStarsByKingdom[kingdom] || 0, 2000);
        user.markModified('kingdomRankByKingdom');
        user.markModified('rankStarsByKingdom');
        await user.save();

        // إرسال رسالة تأكيد في الخاص
        await sock.sendMessage(adminJid, {
            text: `✅ تم منح رتبة الإمبراطور لـ ${targetNickname} بنجاح!\n✨ شرف عظيم!`
        });

        // إرسال رسالة تأكيد في المجموعة
        await sock.sendMessage(jid, {
            text: `👑 تم منح رتبة الإمبراطور لـ ${targetNickname} بنجاح!\n✨ شرف عظيم!`
        });

        // إرسال رسالة للاعب بالترقية
        try {
            await sock.sendMessage(user.jid, {
                text: `🎖️ مبروك! تم منحك رتبة الإمبراطور بقرار من الأدمن الرئيسي!\n✨ شرف عظيم!`
            });
        } catch (e) {
            console.log('لم يتمكن من إرسال رسالة للاعب مباشرة');
        }

        return true;
    } catch (error) {
        console.error('خطأ في منح رتبة الإمبراطور:', error);
        await sock.sendMessage(adminJid, { text: '❌ حدث خطأ في منح الرتبة!' });
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
            await sock.sendMessage(jid, { text: '❌ هذا الأمر متاح للأدمن والمشرفين فقط!' });
            return false;
        }

        if (!mentionedJid) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على منشن صحيح!' });
            return false;
        }

        if (!nickname || typeof nickname !== 'string') {
            await sock.sendMessage(jid, { text: '❌ اسم المستخدم غير صحيح!' });
            return false;
        }

        // التحقق من وجود المنشن الحقيقي من الرسالة
        if (!realMention) {
            await sock.sendMessage(jid, { text: 'يرجى إرسال المنشن الجديد بالصيغة @المنشن' });
            return false;
        }

        // البحث عن المستخدم
        const user = await User.findOne({ nickname: { $regex: nickname, $options: 'i' } });
        if (!user) {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على مستخدم باسم "${nickname}"!` });
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
            text: `✅ تم تعيين المنشن ${user.mention} للعضو ${user.nickname} بنجاح!`
        });

        return true;
    } catch (error) {
        console.error('خطأ في تعيين المنشن:', error);
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في معالجة المنشن!' });
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
            await sock.sendMessage(jid, { text: '❌ هذا الأمر متاح للأدمن والمشرفين فقط!' });
            return false;
        }

        if (!mentionedJid) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على منشن صحيح!' });
            return false;
        }

        if (!oldNickname || typeof oldNickname !== 'string') {
            await sock.sendMessage(jid, { text: '❌ اسم المستخدم القديم غير صحيح!' });
            return false;
        }

        // التحقق من وجود المنشن الحقيقي من الرسالة
        if (!realMention) {
            await sock.sendMessage(jid, { text: 'يرجى إرسال المنشن الجديد بالصيغة @المنشن' });
            return false;
        }

        // البحث عن المستخدم القديم
        const oldUser = await User.findOne({ nickname: { $regex: oldNickname, $options: 'i' }, kingdom_id: kingdom });
        if (!oldUser) {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على مستخدم باسم "${oldNickname}"!` });
            return false;
        }

        // التحقق من أن المنشن الجديد غير مستخدم بالفعل
        const existingUser = await User.findOne({ jid: mentionedJid, kingdom_id: kingdom });
        if (existingUser && existingUser.nickname !== oldNickname) {
            await sock.sendMessage(jid, { text: '❌ هذا المنشن مرتبط بمستخدم آخر بالفعل!' });
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
        let confirmMessage = `✅ تم تغيير منشن العضو ${oldNickname} بنجاح!\n\n`;
        confirmMessage += `📋 *البيانات القديمة:*\n`;
        confirmMessage += `   • المنشن: ${oldMention || 'لم يكن مسجلاً'}\n`;
        confirmMessage += `   • الرقم: ${oldPhone || 'لم يكن مسجلاً'}\n\n`;
        confirmMessage += `📋 *البيانات الجديدة:*\n`;
        confirmMessage += `   • المنشن: ${oldUser.mention}\n`;
        confirmMessage += `   • الرقم: ${oldUser.phoneNumber}`;

        await sock.sendMessage(jid, { text: confirmMessage });

        return true;
    } catch (error) {
        console.error('خطأ في تغيير المنشن:', error);
        await sock.sendMessage(jid, { text: '❌ حدث خطأ في معالجة المنشن!' });
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
export async function startGameSession(adminJid, gameName) {
    try {
        const user = await User.findOne({ jid: adminJid });
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
export async function stopGameSession(adminJid) {
    try {
        const user = await User.findOne({ jid: adminJid });
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
export function getDailyGameStats(adminJid, user) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const gameStats = {};
    let totalDuration = 0;
    let sessionCount = 0;

    if (user.gamesSessions) {
        user.gamesSessions.forEach(session => {
            const sessionDate = new Date(session.startTime);
            sessionDate.setHours(0, 0, 0, 0);

            // فقط الجلسات من اليوم الحالي والمنتهية
            if (sessionDate.getTime() === today.getTime() && session.endTime) {
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
export function generateAdminDailyReport(user) {
    const { gameStats, totalDuration, sessionCount } = getDailyGameStats(user.jid, user);

    if (sessionCount === 0) {
        return `📊 *تقرير الألعاب اليومي*\n\n✅ لم تقم ببدء أي لعبة اليوم`;
    }

    let report = `📊 *تقرير الألعاب اليومي - ${user.nickname || user.name}*\n\n`;
    report += `📅 التاريخ: ${new Date().toLocaleDateString('ar-SA')}\n\n`;

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
    report += `━━━━━━━━━━━━━━━━━\n`;
    report += `✨ شكراً على إدارتك للألعاب!`;

    return report;
}

/**
 * إرسال التقارير اليومية لجميع الأداريين
 * @param {Object} sock - كائن الـ socket
 * @param {string} groupJid - معرف المجموعة الداخلية (التقارير)
 */
export async function sendAdminsDailyReports(sock, groupJid) {
    try {
        // جلب جميع الأداريين والمشرفين
        const admins = await User.find({ 
            role: { $in: ['admin', 'moderator', 'super_admin'] }
        });

        let reportsSent = 0;
        for (const admin of admins) {
            try {
                const report = generateAdminDailyReport(admin);
                
                // إرسال التقرير فقط في المجموعة الإدارية
                if (groupJid) {
                    const groupReport = `👤 *${admin.nickname || admin.name}*\n${report}`;
                    await sock.sendMessage(groupJid, { text: groupReport });
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
export async function resetDailyGameStats() {
    try {
        // 🔄 إعادة تعيين إحصائيات جميع المستخدمين (رسائل + ألعاب)
        const allUsers = await User.find({});
        
        let gameStatsReset = 0;
        let messageStatsReset = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        for (const user of allUsers) {
            let updated = false;
            
            // ✅ إعادة تعيين الرسائل اليومية لجميع المستخدمين
            if (user.dailyMessages > 0) {
                user.dailyMessages = 0;
                user.lastMessageResetDate = new Date();
                messageStatsReset++;
                updated = true;
            }
            
            // ✅ إعادة تعيين الألعاب - للأداريين فقط
            if (user.role && ['admin', 'moderator', 'super_admin'].includes(user.role)) {
                if (user.gamesSessions && user.gamesSessions.length > 0) {
                    // حذف جلسات اليوم الحالي فقط (إبقاء السجل التاريخي)
                    user.gamesSessions = user.gamesSessions.filter(session => {
                        const sessionDate = new Date(session.startTime);
                        sessionDate.setHours(0, 0, 0, 0);
                        // إبقاء الجلسات القديمة، حذف جلسات اليوم
                        return sessionDate.getTime() < today.getTime();
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
        console.log(`   🎮 جلسات ألعاب: ${gameStatsReset} أدمن/مشرف`);
        
        return { gameStatsReset, messageStatsReset };
    } catch (error) {
        console.error('❌ خطأ في إعادة تعيين الإحصائيات:', error);
        return { gameStatsReset: 0, messageStatsReset: 0 };
    }
}

