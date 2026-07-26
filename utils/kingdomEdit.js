import Kingdom from "../database/kingdomModel.js";
import { ADMIN_PASSWORD, ADMIN_PASSWORD_CONFIGURED, DEVELOPER_JID } from "../config.js";
import { resolveMentionContext } from "../commands/adminSystem.js";
import {
  auditKingdomAction,
  isGroupJid,
  normalizeGroupJid,
  normalizePhoneToJid,
  refreshKingdomCache
} from "./kingdomService.js";

const EDIT_COMMANDS = new Set(["/تعديل_مملكة", "/تعديل_نقابة", "/edit_kingdom"]);
const CANCEL_PATTERN = /^(إلغاء|الغاء|cancel)$/i;
const CONFIRM_PATTERN = /^(تأكيد|تاكيد|confirm)$/i;
const CLEAR_PATTERN = /^(مسح|فارغ|empty|clear|-|تخطي)$/i;

const editSessions = new Map();

const GROUP_ROLE_OPTIONS = [
  {
    key: "mainGroup",
    number: "1",
    label: "المجموعة الأساسية",
    prompt: "أرسل JID المجموعة الأساسية.\nمثال: 120363xxxxxxxx@g.us"
  },
  {
    key: "receptionGroup",
    number: "2",
    label: "مجموعة الاستقبال",
    prompt: "أرسل JID مجموعة الاستقبال."
  },
  {
    key: "workGroup",
    number: "3",
    label: "مجموعة الترحيب/الوورك",
    prompt: "أرسل JID مجموعة الترحيب أو الوورك."
  },
  {
    key: "adminGroup",
    number: "4",
    label: "مجموعة الإدارة",
    prompt: "أرسل JID مجموعة الإدارة."
  },
  {
    key: "extraGroup",
    number: "5",
    label: "مجموعة إضافية",
    prompt: "أرسل JID المجموعة الإضافية."
  }
];

const EDIT_FIELDS = [
  {
    key: "name",
    aliases: ["1", "اسم", "الاسم", "name"],
    label: "اسم المملكة",
    prompt: "أرسل الاسم الجديد للمملكة."
  },
  {
    key: "mainGroup",
    aliases: ["2", "الرئيسي", "القروب_الرئيسي", "main", "mainGroup"],
    label: "القروب الرئيسي",
    prompt: "أرسل JID القروب الرئيسي الجديد.\nمثال: 120363xxxxxxxx@g.us"
  },
  {
    key: "receptionGroup",
    aliases: ["3", "الاستقبال", "قروب_الاستقبال", "reception", "receptionGroup"],
    label: "قروب الاستقبال",
    prompt: "أرسل JID قروب الاستقبال الجديد، أو اكتب: مسح"
  },
  {
    key: "adminGroup",
    aliases: ["4", "الإدارة", "الادارة", "قروب_الإدارة", "admin", "adminGroup"],
    label: "قروب الإدارة",
    prompt: "أرسل JID قروب الإدارة الجديد، أو اكتب: مسح"
  },
  {
    key: "workGroup",
    aliases: ["5", "الوورك", "قروب_الوورك", "work", "workGroup"],
    label: "قروب الوورك",
    prompt: "أرسل JID قروب الوورك الجديد، أو اكتب: مسح"
  },
  {
    key: "groupsSetup",
    aliases: ["6", "القروبات", "قروبات", "groupIds", "groups"],
    label: "إعادة ضبط القروبات",
    prompt: "كم قروب تريد ربطه بهذه المملكة؟\nاكتب رقمًا مثل 3 أو كلمة مثل ثلاث."
  },
  {
    key: "admins",
    aliases: ["7", "الأدمن", "الادمن", "admins"],
    label: "أدمن المملكة",
    prompt: "أرسل أرقام أو JID الأدمن مفصولة بسطر أو فاصلة.\nمثال: 9627xxxxxxx, 120xxxxx@lid"
  },
  {
    key: "bankStartingBalance",
    aliases: ["8", "البنك", "الرصيد", "bank"],
    label: "رصيد البنك الابتدائي",
    prompt: "أرسل الرصيد الابتدائي بالأرقام."
  },
  {
    key: "isActive",
    aliases: ["9", "الحالة", "active", "status"],
    label: "حالة المملكة",
    prompt: "أرسل: نشطة أو معطلة"
  },
  {
    key: "mainGroupInviteLink",
    aliases: ["10", "رابط_الرئيسي", "رابط الأساسي", "رابط_الأساسي", "mainLink", "mainInvite"],
    label: "رابط دعوة القروب الرئيسي",
    prompt: "أرسل رابط دعوة القروب الرئيسي، أو اكتب: مسح"
  },
  {
    key: "receptionGroupInviteLink",
    aliases: ["11", "رابط_الاستقبال", "receptionLink", "receptionInvite"],
    label: "رابط دعوة قروب الاستقبال",
    prompt: "أرسل رابط دعوة قروب الاستقبال، أو اكتب: مسح"
  },
  {
    key: "workGroupInviteLink",
    aliases: ["12", "رابط_الوورك", "رابط_الترحيب", "workLink", "workInvite"],
    label: "رابط دعوة قروب الوورك",
    prompt: "أرسل رابط دعوة قروب الوورك، أو اكتب: مسح"
  },
  {
    key: "adminGroupInviteLink",
    aliases: ["13", "رابط_الإدارة", "رابط_الادارة", "adminLink", "adminInvite"],
    label: "رابط دعوة قروب الإدارة",
    prompt: "أرسل رابط دعوة قروب الإدارة، أو اكتب: مسح"
  },
  {
    key: "announcementLink",
    aliases: ["14", "رابط_الإعلانات", "رابط_الاعلانات", "رابط الإعلانات", "announcementLink"],
    label: "رابط الإعلانات",
    prompt: "أرسل رابط الإعلانات، أو اكتب: مسح"
  }
];

function isPrivateChat(jid) {
  return !String(jid || "").endsWith("@g.us");
}

function normalizeChoice(value) {
  return String(value || "").trim().toLowerCase();
}

function splitList(value) {
  return String(value || "")
    .split(/[\n,،]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildGroupRolesPrompt(count) {
  return `اختر أنواع القروبات وعددها ${count}.
أرسل الأرقام مفصولة بفواصل أو مسافات.

1. المجموعة الأساسية
2. مجموعة الاستقبال
3. مجموعة الترحيب/الوورك
4. مجموعة الإدارة
5. مجموعة إضافية

مثال: 1,2,3
لازم تختار المجموعة الأساسية رقم 1.`;
}

function parseGroupCount(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const digits = normalized.match(/\d+/)?.[0];
  if (digits) return Number(digits);

  const words = {
    "واحد": 1,
    "واحدة": 1,
    "قروب": 1,
    "مجموعة": 1,
    "اثنين": 2,
    "إثنين": 2,
    "اثنتين": 2,
    "ثنين": 2,
    "ثلاث": 3,
    "ثلاثة": 3,
    "اربع": 4,
    "أربع": 4,
    "اربعة": 4,
    "أربعة": 4,
    "خمس": 5,
    "خمسة": 5,
    "ست": 6,
    "ستة": 6,
    "سبع": 7,
    "سبعة": 7,
    "ثمان": 8,
    "ثمانية": 8,
    "تسع": 9,
    "تسعة": 9,
    "عشر": 10,
    "عشرة": 10
  };

  if (words[normalized]) return words[normalized];

  for (const token of normalized.split(/\s+/)) {
    if (words[token]) return words[token];
  }

  return null;
}

function parseGroupRoles(value, expectedCount) {
  const tokens = String(value || "")
    .split(/[\s,،]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const roles = [];
  const usedSpecificRoles = new Set();

  for (const token of tokens) {
    const option = GROUP_ROLE_OPTIONS.find((item) => item.number === token || item.label.includes(token));
    if (!option) {
      return { ok: false, message: `❌ لم أفهم نوع القروب: ${token}` };
    }

    if (option.key !== "extraGroup" && usedSpecificRoles.has(option.key)) {
      return { ok: false, message: `❌ لا يمكن تكرار ${option.label}.` };
    }

    if (option.key !== "extraGroup") usedSpecificRoles.add(option.key);
    roles.push({ ...option, index: roles.length + 1 });
  }

  if (roles.length !== expectedCount) {
    return { ok: false, message: `❌ اختر ${expectedCount} نوع/أنواع بالضبط.` };
  }

  if (!roles.some((role) => role.key === "mainGroup")) {
    return { ok: false, message: "❌ لازم تختار المجموعة الأساسية رقم 1." };
  }

  return { ok: true, roles };
}

function findField(value) {
  const choice = normalizeChoice(value);
  return EDIT_FIELDS.find((field) => field.aliases.some((alias) => normalizeChoice(alias) === choice));
}

function formatValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return formatGroupSetup(value);
  if (Array.isArray(value)) return value.length ? value.join("\n") : "-";
  if (typeof value === "boolean") return value ? "نشطة" : "معطلة";
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function isInviteLinkField(key) {
  return [
    "mainGroupInviteLink",
    "receptionGroupInviteLink",
    "workGroupInviteLink",
    "adminGroupInviteLink"
  ].includes(key);
}

function isUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value || "").trim());
}

function isWhatsappInviteLink(value) {
  return /^https?:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+/i.test(String(value || "").trim());
}

function buildGroupIds(data, explicitGroupIds = data.groupIds || []) {
  return [
    ...new Set([
      data.mainGroup,
      data.receptionGroup,
      data.adminGroup,
      data.workGroup,
      ...explicitGroupIds
    ].filter(Boolean))
  ];
}

function getCurrentGroupRole(session) {
  return session.groupSetup?.roles?.[session.groupSetup?.currentIndex || 0];
}

function getGroupSetupJids(groupSetup) {
  return [
    groupSetup?.mainGroup,
    groupSetup?.receptionGroup,
    groupSetup?.workGroup,
    groupSetup?.adminGroup,
    ...(groupSetup?.extraGroupIds || [])
  ].filter(Boolean);
}

function formatGroupSetup(groupSetup) {
  const lines = [];
  if (groupSetup?.mainGroup) lines.push(`الأساسية: ${groupSetup.mainGroup}`);
  if (groupSetup?.receptionGroup) lines.push(`الاستقبال: ${groupSetup.receptionGroup}`);
  if (groupSetup?.workGroup) lines.push(`الترحيب/الوورك: ${groupSetup.workGroup}`);
  if (groupSetup?.adminGroup) lines.push(`الإدارة: ${groupSetup.adminGroup}`);
  for (const [index, groupJid] of (groupSetup?.extraGroupIds || []).entries()) {
    lines.push(`إضافية ${index + 1}: ${groupJid}`);
  }
  return lines.length ? lines.join("\n") : "-";
}

function buildFieldsMenu(kingdom) {
  return `اختر الحقل المراد تعديله في *${kingdom.name}* (${kingdom.id}):

1. اسم المملكة
2. القروب الرئيسي
3. قروب الاستقبال
4. قروب الإدارة
5. قروب الوورك
6. إعادة ضبط القروبات
7. أدمن المملكة
8. رصيد البنك الابتدائي
9. حالة المملكة
10. رابط دعوة القروب الرئيسي
11. رابط دعوة قروب الاستقبال
12. رابط دعوة قروب الوورك
13. رابط دعوة قروب الإدارة
14. رابط الإعلانات

أرسل الرقم أو الاسم، وللإلغاء اكتب: إلغاء`;
}

function formatKingdomList(kingdoms) {
  if (!kingdoms.length) return "لا توجد ممالك مسجلة.";
  return kingdoms.map((kingdom) => `• ${kingdom.name} (${kingdom.id})`).join("\n");
}

function formatChangeSummary(session) {
  return `راجع التعديل:

المملكة: ${session.kingdomName} (${session.kingdomId})
الحقل: ${session.field.label}
القيمة الحالية:
${formatValue(session.oldValue)}

القيمة الجديدة:
${formatValue(session.newValue)}

اكتب *تأكيد* للحفظ أو *إلغاء* للإلغاء.`;
}

async function findKingdomMatches(input) {
  const value = String(input || "").trim();
  if (!value) return [];

  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Kingdom.find({
    $or: [
      { id: value.toLowerCase() },
      { name: new RegExp(`^${escaped}$`, "i") }
    ]
  }).sort({ createdAt: 1 });
}

async function assertGroupOwnershipAvailable(groupJids, currentKingdomMongoId) {
  const groups = [...new Set(groupJids.filter(Boolean))];
  if (!groups.length) return { ok: true };

  const existing = await Kingdom.findOne({
    _id: { $ne: currentKingdomMongoId },
    $or: [
      { mainGroup: { $in: groups } },
      { receptionGroup: { $in: groups } },
      { adminGroup: { $in: groups } },
      { workGroup: { $in: groups } },
      { groupIds: { $in: groups } }
    ]
  }).lean();

  if (existing) {
    return { ok: false, message: `❌ أحد هذه القروبات مربوط مسبقًا بمملكة: ${existing.name} (${existing.id})` };
  }

  return { ok: true };
}

async function validateGroupAccess(sock, groupJids) {
  for (const groupJid of [...new Set(groupJids.filter(Boolean))]) {
    try {
      await sock.groupMetadata(groupJid);
    } catch (error) {
      return { ok: false, message: `❌ تعذر قراءة القروب ${groupJid}. تأكد أن البوت داخل القروب.` };
    }
  }

  return { ok: true };
}

async function validateNewValue(sock, session, rawValue) {
  const value = String(rawValue || "").trim();
  const key = session.field.key;
  const kingdom = await Kingdom.findById(session.kingdomMongoId).lean();
  if (!kingdom) return { ok: false, message: "❌ لم أعد أجد هذه المملكة في قاعدة البيانات." };

  if (key === "name") {
    if (value.length < 2 || value.length > 80) {
      return { ok: false, message: "❌ اسم المملكة يجب أن يكون بين 2 و80 حرفًا." };
    }
    return { ok: true, value };
  }

  if (["mainGroup", "receptionGroup", "adminGroup", "workGroup"].includes(key)) {
    if (key !== "mainGroup" && CLEAR_PATTERN.test(value)) {
      return { ok: true, value: "" };
    }

    const groupJid = normalizeGroupJid(value);
    if (!isGroupJid(groupJid)) {
      return { ok: false, message: "❌ JID القروب غير صحيح. يجب أن ينتهي بـ @g.us" };
    }

    const ownership = await assertGroupOwnershipAvailable([groupJid], kingdom._id);
    if (!ownership.ok) return ownership;

    const access = await validateGroupAccess(sock, [groupJid]);
    if (!access.ok) return access;

    return { ok: true, value: groupJid };
  }

  if (key === "groupIds") {
    let groupIds = [];
    if (!CLEAR_PATTERN.test(value)) {
      groupIds = splitList(value).map(normalizeGroupJid);
      const invalid = groupIds.find((groupJid) => !isGroupJid(groupJid));
      if (invalid) {
        return { ok: false, message: `❌ JID غير صحيح: ${invalid}` };
      }
    }

    const finalGroups = buildGroupIds(kingdom, groupIds);
    const ownership = await assertGroupOwnershipAvailable(finalGroups, kingdom._id);
    if (!ownership.ok) return ownership;

    const access = await validateGroupAccess(sock, finalGroups);
    if (!access.ok) return access;

    return { ok: true, value: finalGroups };
  }

  if (key === "admins") {
    const admins = splitList(value).map(normalizePhoneToJid).filter(Boolean);
    if (!admins.length) {
      return { ok: false, message: "❌ أرسل رقم أو JID أدمن واحد على الأقل." };
    }
    return { ok: true, value: [...new Set(admins)] };
  }

  if (key === "bankStartingBalance") {
    const amount = Number(value);
    if (!Number.isInteger(amount) || amount < 0) {
      return { ok: false, message: "❌ الرصيد يجب أن يكون رقمًا صحيحًا موجبًا أو صفر." };
    }
    return { ok: true, value: amount };
  }

  if (key === "isActive") {
    if (/^(نشطة|نشط|active|on|true|1)$/i.test(value)) return { ok: true, value: true };
    if (/^(معطلة|معطل|inactive|off|false|0)$/i.test(value)) return { ok: true, value: false };
    return { ok: false, message: "❌ الحالة يجب أن تكون: نشطة أو معطلة." };
  }

  if (isInviteLinkField(key)) {
    if (CLEAR_PATTERN.test(value)) return { ok: true, value: "" };
    if (!isWhatsappInviteLink(value)) {
      return { ok: false, message: "❌ رابط الدعوة يجب أن يكون من نوع https://chat.whatsapp.com/..." };
    }
    return { ok: true, value };
  }

  if (key === "announcementLink") {
    if (CLEAR_PATTERN.test(value)) return { ok: true, value: "" };
    if (!isUrl(value)) {
      return { ok: false, message: "❌ رابط الإعلانات يجب أن يبدأ بـ http:// أو https://" };
    }
    return { ok: true, value };
  }

  return { ok: false, message: "❌ هذا الحقل غير مدعوم." };
}

async function saveKingdomEdit(session, actorJid) {
  const kingdom = await Kingdom.findById(session.kingdomMongoId);
  if (!kingdom) throw new Error("لم أعد أجد هذه المملكة في قاعدة البيانات.");

  if (session.field.key === "groupsSetup") {
    kingdom.mainGroup = session.newValue.mainGroup || "";
    kingdom.receptionGroup = session.newValue.receptionGroup || "";
    kingdom.adminGroup = session.newValue.adminGroup || "";
    kingdom.workGroup = session.newValue.workGroup || "";
    kingdom.groupIds = getGroupSetupJids(session.newValue);
  } else {
  kingdom[session.field.key] = session.newValue;
  }

  if (["mainGroup", "receptionGroup", "adminGroup", "workGroup"].includes(session.field.key)) {
    kingdom.groupIds = buildGroupIds(kingdom.toObject());
  }

  if (session.field.key === "groupIds") {
    kingdom.groupIds = session.newValue;
  }

  await kingdom.save();
  await auditKingdomAction("kingdom_updated", actorJid, {
    field: session.field.key,
    oldValue: session.oldValue,
    newValue: session.newValue
  }, kingdom.id);
  await refreshKingdomCache();

  return kingdom;
}

export async function handleStartKingdomEdit(sock, jid, sender, trimmedText) {
  const command = String(trimmedText || "").split(/\s+/)[0];
  if (!EDIT_COMMANDS.has(command)) return false;

  if (!isPrivateChat(jid)) {
    await sock.sendMessage(jid, { text: "🔐 للتعديل بأمان، أرسل أمر /تعديل_مملكة في خاص البوت فقط." });
    return true;
  }

  if (!ADMIN_PASSWORD_CONFIGURED) {
    await sock.sendMessage(jid, { text: "❌ ADMIN_PASSWORD غير مضبوط في Railway variables." });
    return true;
  }

  editSessions.set(sender, { stage: "password", startedAt: Date.now() });
  await sock.sendMessage(jid, { text: "🔐 أرسل كلمة مرور الأدمن لبدء تعديل المملكة.\nللإلغاء اكتب: إلغاء" });
  return true;
}

export async function handleKingdomEditStep(sock, jid, sender, text) {
  const session = editSessions.get(sender);
  if (!session) return false;

  if (!isPrivateChat(jid)) {
    await sock.sendMessage(jid, { text: "🔐 أكمل تعديل المملكة في الخاص فقط." });
    return true;
  }

  const trimmed = String(text || "").trim();
  if (!trimmed) return true;

  if (CANCEL_PATTERN.test(trimmed)) {
    editSessions.delete(sender);
    await sock.sendMessage(jid, { text: "✅ تم إلغاء تعديل المملكة." });
    return true;
  }

  if (session.stage === "password") {
    if (trimmed !== ADMIN_PASSWORD) {
      editSessions.delete(sender);
      await sock.sendMessage(jid, { text: "❌ كلمة المرور غير صحيحة. تم إلغاء العملية." });
      return true;
    }

    const kingdoms = await Kingdom.find({}).sort({ createdAt: 1 }).select("id name").lean();
    session.stage = "kingdom";
    editSessions.set(sender, session);
    await sock.sendMessage(jid, {
      text: `✅ تم قبول كلمة المرور.\n\nأرسل معرف المملكة أو اسمها:\n${formatKingdomList(kingdoms)}`
    });
    return true;
  }

  if (session.stage === "kingdom") {
    const kingdoms = await findKingdomMatches(trimmed);
    if (!kingdoms.length) {
      await sock.sendMessage(jid, { text: "❌ لم أجد هذه المملكة. أرسل المعرف مثل clover أو الاسم كما يظهر في التقرير." });
      return true;
    }

    if (kingdoms.length > 1) {
      await sock.sendMessage(jid, {
        text: `وجدت أكثر من مملكة بهذا الاسم. أرسل المعرف المطلوب:\n${formatKingdomList(kingdoms)}`
      });
      return true;
    }

    const kingdom = kingdoms[0];
    session.stage = "field";
    session.kingdomMongoId = kingdom._id;
    session.kingdomId = kingdom.id;
    session.kingdomName = kingdom.name;
    editSessions.set(sender, session);
    await sock.sendMessage(jid, { text: buildFieldsMenu(kingdom) });
    return true;
  }

  if (session.stage === "field") {
    const field = findField(trimmed);
    if (!field) {
      await sock.sendMessage(jid, { text: "❌ اختر رقمًا من 1 إلى 14 أو اسم الحقل." });
      return true;
    }

    const kingdom = await Kingdom.findById(session.kingdomMongoId).lean();
    if (!kingdom) {
      editSessions.delete(sender);
      await sock.sendMessage(jid, { text: "❌ لم أعد أجد هذه المملكة. أعد المحاولة." });
      return true;
    }

    session.stage = "value";
    session.field = field;
    session.oldValue = field.key === "groupsSetup"
      ? {
          mainGroup: kingdom.mainGroup,
          receptionGroup: kingdom.receptionGroup,
          workGroup: kingdom.workGroup,
          adminGroup: kingdom.adminGroup,
          extraGroupIds: (kingdom.groupIds || []).filter((groupJid) => ![
            kingdom.mainGroup,
            kingdom.receptionGroup,
            kingdom.workGroup,
            kingdom.adminGroup
          ].includes(groupJid))
        }
      : kingdom[field.key];

    if (field.key === "groupsSetup") {
      session.stage = "groupCount";
      session.groupSetup = {};
      editSessions.set(sender, session);
      await sock.sendMessage(jid, { text: `${field.prompt}\n\nالقيمة الحالية:\n${formatValue(session.oldValue)}` });
      return true;
    }

    editSessions.set(sender, session);
    await sock.sendMessage(jid, { text: `${field.prompt}\n\nالقيمة الحالية:\n${formatValue(session.oldValue)}` });
    return true;
  }

  if (session.stage === "groupCount") {
    const count = parseGroupCount(trimmed);
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      await sock.sendMessage(jid, { text: "❌ عدد القروبات يجب أن يكون من 1 إلى 10." });
      return true;
    }

    session.stage = "groupRoles";
    session.groupSetup = { count };
    editSessions.set(sender, session);
    await sock.sendMessage(jid, { text: buildGroupRolesPrompt(count) });
    return true;
  }

  if (session.stage === "groupRoles") {
    const validation = parseGroupRoles(trimmed, session.groupSetup?.count || 0);
    if (!validation.ok) {
      await sock.sendMessage(jid, { text: `${validation.message}\n\n${buildGroupRolesPrompt(session.groupSetup?.count || 0)}` });
      return true;
    }

    session.stage = "groupJid";
    session.groupSetup.roles = validation.roles;
    session.groupSetup.currentIndex = 0;
    editSessions.set(sender, session);
    await sock.sendMessage(jid, { text: getCurrentGroupRole(session).prompt });
    return true;
  }

  if (session.stage === "groupJid") {
    const role = getCurrentGroupRole(session);
    if (!role) {
      session.stage = "confirm";
      session.newValue = session.groupSetup;
      editSessions.set(sender, session);
      await sock.sendMessage(jid, { text: formatChangeSummary(session) });
      return true;
    }

    const groupJid = normalizeGroupJid(trimmed);
    if (!isGroupJid(groupJid)) {
      await sock.sendMessage(jid, { text: `❌ JID القروب غير صحيح. يجب أن ينتهي بـ @g.us\n\n${role.prompt}` });
      return true;
    }

    if (getGroupSetupJids(session.groupSetup).includes(groupJid)) {
      await sock.sendMessage(jid, { text: `❌ هذا الـ JID مكرر داخل نفس المملكة.\n\n${role.prompt}` });
      return true;
    }

    const ownership = await assertGroupOwnershipAvailable([groupJid], session.kingdomMongoId);
    if (!ownership.ok) {
      await sock.sendMessage(jid, { text: `${ownership.message}\n\n${role.prompt}` });
      return true;
    }

    const access = await validateGroupAccess(sock, [groupJid]);
    if (!access.ok) {
      await sock.sendMessage(jid, { text: `${access.message}\n\n${role.prompt}` });
      return true;
    }

    if (role.key === "extraGroup") {
      session.groupSetup.extraGroupIds = [...(session.groupSetup.extraGroupIds || []), groupJid];
    } else {
      session.groupSetup[role.key] = groupJid;
    }

    session.groupSetup.currentIndex = (session.groupSetup.currentIndex || 0) + 1;
    if (session.groupSetup.currentIndex < session.groupSetup.roles.length) {
      const nextRole = getCurrentGroupRole(session);
      editSessions.set(sender, session);
      await sock.sendMessage(jid, { text: `✅ تم حفظ ${role.label}.\n\n${nextRole.prompt}` });
      return true;
    }

    session.stage = "confirm";
    session.newValue = session.groupSetup;
    editSessions.set(sender, session);
    await sock.sendMessage(jid, { text: formatChangeSummary(session) });
    return true;
  }

  if (session.stage === "value") {
    const validation = await validateNewValue(sock, session, trimmed);
    if (!validation.ok) {
      await sock.sendMessage(jid, { text: `${validation.message}\n\n${session.field.prompt}` });
      return true;
    }

    session.stage = "confirm";
    session.newValue = validation.value;
    editSessions.set(sender, session);
    await sock.sendMessage(jid, { text: formatChangeSummary(session) });
    return true;
  }

  if (session.stage === "confirm") {
    if (!CONFIRM_PATTERN.test(trimmed)) {
      await sock.sendMessage(jid, { text: "اكتب تأكيد للحفظ أو إلغاء للإلغاء." });
      return true;
    }

    try {
      const kingdom = await saveKingdomEdit(session, sender);
      editSessions.delete(sender);
      const actor = await resolveMentionContext(sender, kingdom.id);
      await sock.sendMessage(jid, { text: `✅ تم تعديل ${kingdom.name} بنجاح.\nالحقل: ${session.field.label}` });
      await sock.sendMessage(DEVELOPER_JID, {
        text: `🏰 تم تعديل مملكة\nالمملكة: ${kingdom.name} (${kingdom.id})\nالحقل: ${session.field.label}\nبواسطة: ${actor.text}`,
        mentions: actor.mentions
      });
    } catch (error) {
      editSessions.delete(sender);
      await sock.sendMessage(jid, { text: `❌ فشل تعديل المملكة: ${error.message}` });
    }
    return true;
  }

  return true;
}
