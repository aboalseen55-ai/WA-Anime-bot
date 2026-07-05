import Kingdom from "../database/kingdomModel.js";
import { ADMIN_PASSWORD, ADMIN_PASSWORD_CONFIGURED, DEVELOPER_JID } from "../config.js";
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
    key: "groupIds",
    aliases: ["6", "القروبات", "قروبات", "groupIds", "groups"],
    label: "القروبات المرتبطة",
    prompt: "أرسل JID القروبات المرتبطة مفصولة بسطر أو فاصلة.\nاكتب: مسح لإبقاء قروبات الحقول الأساسية فقط."
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

function findField(value) {
  const choice = normalizeChoice(value);
  return EDIT_FIELDS.find((field) => field.aliases.some((alias) => normalizeChoice(alias) === choice));
}

function formatValue(value) {
  if (Array.isArray(value)) return value.length ? value.join("\n") : "-";
  if (typeof value === "boolean") return value ? "نشطة" : "معطلة";
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
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

function buildFieldsMenu(kingdom) {
  return `اختر الحقل المراد تعديله في *${kingdom.name}* (${kingdom.id}):

1. اسم المملكة
2. القروب الرئيسي
3. قروب الاستقبال
4. قروب الإدارة
5. قروب الوورك
6. القروبات المرتبطة
7. أدمن المملكة
8. رصيد البنك الابتدائي
9. حالة المملكة

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

async function findKingdomByInput(input) {
  const value = String(input || "").trim();
  if (!value) return null;

  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Kingdom.findOne({
    $or: [
      { id: value.toLowerCase() },
      { name: new RegExp(`^${escaped}$`, "i") }
    ]
  });
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

  return { ok: false, message: "❌ هذا الحقل غير مدعوم." };
}

async function saveKingdomEdit(session, actorJid) {
  const kingdom = await Kingdom.findById(session.kingdomMongoId);
  if (!kingdom) throw new Error("لم أعد أجد هذه المملكة في قاعدة البيانات.");

  kingdom[session.field.key] = session.newValue;

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
    const kingdom = await findKingdomByInput(trimmed);
    if (!kingdom) {
      await sock.sendMessage(jid, { text: "❌ لم أجد هذه المملكة. أرسل المعرف مثل clover أو الاسم كما يظهر في التقرير." });
      return true;
    }

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
      await sock.sendMessage(jid, { text: "❌ اختر رقمًا من 1 إلى 9 أو اسم الحقل." });
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
    session.oldValue = kingdom[field.key];
    editSessions.set(sender, session);
    await sock.sendMessage(jid, { text: `${field.prompt}\n\nالقيمة الحالية:\n${formatValue(session.oldValue)}` });
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
      await sock.sendMessage(jid, { text: `✅ تم تعديل ${kingdom.name} بنجاح.\nالحقل: ${session.field.label}` });
      await sock.sendMessage(DEVELOPER_JID, {
        text: `🏰 تم تعديل مملكة\nالمملكة: ${kingdom.name} (${kingdom.id})\nالحقل: ${session.field.label}\nبواسطة: ${sender}`
      });
    } catch (error) {
      editSessions.delete(sender);
      await sock.sendMessage(jid, { text: `❌ فشل تعديل المملكة: ${error.message}` });
    }
    return true;
  }

  return true;
}
