import crypto from "crypto";
import Kingdom from "../database/kingdomModel.js";
import KingdomAccessCode from "../database/kingdomAccessCodeModel.js";
import KingdomAuditLog from "../database/kingdomAuditLogModel.js";
import Bank from "../database/bankModel.js";
import User from "../database/userModel.js";
import MafiaSession from "../database/mafiaSessionModel.js";
import MafiaPlayer from "../database/mafiaPlayerModel.js";
import { resolveMentionContext } from "../commands/adminSystem.js";
import { ADMINS, DEFAULT_KINGDOMS, DEVELOPER_JID, DEVELOPER_JIDS, KINGDOMS, replaceKingdoms } from "../config.js";

const CODE_BYTES = 6;

export function isDeveloper(sender) {
  return DEVELOPER_JIDS.includes(sender);
}

export function normalizePhoneToJid(phoneOrJid) {
  const value = String(phoneOrJid || "").trim();
  if (!value) return "";
  if (value.includes("@")) return value;

  const digits = value.replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : "";
}

export function normalizeGroupJid(value) {
  return String(value || "").trim();
}

export function isGroupJid(value) {
  return /^[0-9-]+@g\.us$/.test(String(value || "").trim());
}

export function isValidKingdomId(value) {
  return /^[a-z][a-z0-9_-]{2,30}$/.test(String(value || "").trim());
}

async function generateUniqueKingdomId(name) {
  const baseFromName = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  const base = isValidKingdomId(baseFromName) ? baseFromName : "kingdom";

  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = crypto.randomBytes(2).toString("hex");
    const id = `${base}_${suffix}`.slice(0, 30);
    const existing = await Kingdom.exists({ id });
    if (!existing) return id;
  }

  return `kingdom_${crypto.randomBytes(5).toString("hex")}`.slice(0, 30);
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateCode() {
  return crypto.randomBytes(CODE_BYTES).toString("hex").toUpperCase();
}

function kingdomDocToConfig(doc) {
  return {
    id: doc.id,
    name: doc.name,
    mainGroup: doc.mainGroup,
    receptionGroup: doc.receptionGroup || "",
    workGroup: doc.workGroup || "",
    groupIds: doc.groupIds || [],
    adminGroup: doc.adminGroup || "",
    admins: doc.admins?.length ? doc.admins : ADMINS,
    bankStartingBalance: doc.bankStartingBalance ?? 1000000
  };
}

function defaultKingdomToDoc(kingdom) {
  return {
    id: kingdom.id,
    name: kingdom.name,
    mainGroup: kingdom.mainGroup,
    receptionGroup: kingdom.receptionGroup || "",
    workGroup: kingdom.workGroup || "",
    adminGroup: kingdom.adminGroup || "",
    groupIds: kingdom.groupIds?.length ? kingdom.groupIds : [kingdom.mainGroup].filter(Boolean),
    admins: kingdom.admins?.length ? kingdom.admins : ADMINS,
    bankStartingBalance: kingdom.bankStartingBalance ?? 1000000,
    isActive: true,
    createdByJid: DEVELOPER_JID,
    createdByName: "system"
  };
}

export async function auditKingdomAction(action, actorJid, details = {}, kingdomId = null) {
  await KingdomAuditLog.create({ action, actorJid, kingdomId, details });
}

export async function syncDefaultKingdomsToDatabase() {
  for (const kingdom of Object.values(DEFAULT_KINGDOMS)) {
    const doc = defaultKingdomToDoc(kingdom);
    await Kingdom.updateOne(
      { id: doc.id },
      { $setOnInsert: doc },
      { upsert: true }
    );
  }
}

export async function refreshKingdomCache() {
  const docs = await Kingdom.find({ isActive: true }).lean();
  const nextKingdoms = {};

  for (const doc of docs) {
    nextKingdoms[doc.id] = kingdomDocToConfig(doc);
  }

  if (!Object.keys(nextKingdoms).length) {
    Object.assign(nextKingdoms, DEFAULT_KINGDOMS);
  }

  replaceKingdoms(nextKingdoms);
  return KINGDOMS;
}

export async function initializeKingdomSystem() {
  await syncDefaultKingdomsToDatabase();
  await refreshKingdomCache();
}

export async function generateKingdomAccessCode(generatedByJid) {
  const code = generateCode();
  const codeDoc = await KingdomAccessCode.create({
    codeHash: hashCode(code),
    generatedByJid,
    deliveredToJid: DEVELOPER_JID
  });

  await KingdomAccessCode.updateMany(
    { _id: { $ne: codeDoc._id }, status: "active" },
    { $set: { status: "revoked", replacedByCodeId: codeDoc._id } }
  );

  await auditKingdomAction("kingdom_code_generated", generatedByJid, { codeId: codeDoc._id });
  return { code, codeDoc };
}

export async function consumeKingdomAccessCode(code, usedByJid) {
  const codeHash = hashCode(String(code || "").trim().toUpperCase());
  const codeDoc = await KingdomAccessCode.findOneAndUpdate(
    { codeHash, status: "active" },
    { $set: { status: "used", usedByJid, usedAt: new Date() } },
    { new: true }
  );

  if (!codeDoc) return null;

  await auditKingdomAction("kingdom_code_used", usedByJid, { codeId: codeDoc._id });
  return codeDoc;
}

export async function createKingdomFromRegistration(data, actorJid, codeId) {
  const name = String(data.name || "").trim();
  const id = data.id ? String(data.id).trim().toLowerCase() : await generateUniqueKingdomId(name);
  const mainGroup = normalizeGroupJid(data.mainGroup);
  const receptionGroup = normalizeGroupJid(data.receptionGroup);
  const adminGroup = normalizeGroupJid(data.adminGroup);
  const workGroup = normalizeGroupJid(data.workGroup);
  const bankStartingBalance = Number(data.bankStartingBalance || 1000000);
  const admins = [normalizePhoneToJid(data.ownerJid || actorJid)].filter(Boolean);
  const extraGroupIds = Array.isArray(data.extraGroupIds) ? data.extraGroupIds.map(normalizeGroupJid) : [];
  const groupIds = [...new Set([mainGroup, receptionGroup, adminGroup, workGroup, ...extraGroupIds].filter(Boolean))];

  const kingdom = await Kingdom.create({
    id,
    name,
    mainGroup,
    receptionGroup,
    adminGroup,
    workGroup,
    groupIds,
    admins,
    bankStartingBalance,
    createdByJid: actorJid,
    createdByName: data.createdByName || null,
    registrationCodeId: codeId
  });

  await Bank.updateOne(
    { kingdom: id },
    { $setOnInsert: { kingdom: id, totalCoins: bankStartingBalance } },
    { upsert: true }
  );

  await auditKingdomAction("kingdom_created", actorJid, { kingdom: kingdom.toObject() }, id);
  await refreshKingdomCache();

  return kingdom;
}

export async function deleteKingdomById(kingdomId, actorJid) {
  const id = String(kingdomId || "").trim().toLowerCase();
  const kingdom = await Kingdom.findOne({ id }).lean();
  if (!kingdom) {
    throw new Error("لم أجد هذه المملكة في قاعدة البيانات.");
  }

  if (DEFAULT_KINGDOMS[kingdom.id]) {
    throw new Error("لا يمكن حذف مملكة افتراضية من الكود. استخدم تعديل المملكة لتعطيلها بدل الحذف.");
  }

  const groupIds = [
    kingdom.mainGroup,
    kingdom.receptionGroup,
    kingdom.adminGroup,
    kingdom.workGroup,
    ...(kingdom.groupIds || [])
  ].filter(Boolean);
  const uniqueGroupIds = [...new Set(groupIds)];

  const [usersBefore, bankBefore, mafiaSessionsBefore] = await Promise.all([
    User.countDocuments({ kingdom_id: kingdom.id }),
    Bank.findOne({ kingdom: kingdom.id }).lean(),
    uniqueGroupIds.length ? MafiaSession.countDocuments({ groupId: { $in: uniqueGroupIds } }) : 0
  ]);

  const [usersResult, bankResult, mafiaSessionsResult, mafiaPlayersResult, kingdomResult] = await Promise.all([
    User.deleteMany({ kingdom_id: kingdom.id }),
    Bank.deleteOne({ kingdom: kingdom.id }),
    uniqueGroupIds.length ? MafiaSession.deleteMany({ groupId: { $in: uniqueGroupIds } }) : { deletedCount: 0 },
    uniqueGroupIds.length ? MafiaPlayer.updateMany(
      { groupIds: { $in: uniqueGroupIds } },
      { $pull: { groupIds: { $in: uniqueGroupIds } } }
    ) : { modifiedCount: 0 },
    Kingdom.deleteOne({ _id: kingdom._id })
  ]);

  if (!kingdomResult.deletedCount) {
    throw new Error("تعذر حذف سجل المملكة. حاول مرة أخرى.");
  }

  const deleted = {
    users: usersResult.deletedCount || 0,
    bank: bankResult.deletedCount || 0,
    mafiaSessions: mafiaSessionsResult.deletedCount || 0,
    mafiaPlayersUnlinked: mafiaPlayersResult.modifiedCount || 0
  };

  await auditKingdomAction("kingdom_deleted", actorJid, {
    kingdom,
    groupIds: uniqueGroupIds,
    before: {
      users: usersBefore,
      bank: bankBefore ? bankBefore.totalCoins : null,
      mafiaSessions: mafiaSessionsBefore
    },
    deleted
  }, kingdom.id);
  await refreshKingdomCache();

  return { kingdom, deleted, groupIds: uniqueGroupIds };
}

export async function buildKingdomsReport(options = {}) {
  const kingdoms = await Kingdom.find({}).sort({ createdAt: 1 }).lean();
  const activeCodes = await KingdomAccessCode.countDocuments({ status: "active" });
  const usedCodes = await KingdomAccessCode.countDocuments({ status: "used" });
  const revokedCodes = await KingdomAccessCode.countDocuments({ status: "revoked" });
  const mentions = [];

  if (!kingdoms.length) {
    const text = "لا توجد ممالك مسجلة في قاعدة البيانات.";
    return options.withMentions ? { text, mentions: [] } : text;
  }

  let report = `🏰 *تقرير الممالك*\n`;
  report += `عدد الممالك: ${kingdoms.length}\n`;
  report += `رموز الفتح: نشطة ${activeCodes} | مستخدمة ${usedCodes} | ملغاة ${revokedCodes}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━\n`;

  for (const kingdom of kingdoms) {
    const [usersCount, adminsCount, bank] = await Promise.all([
      User.countDocuments({ kingdom_id: kingdom.id }),
      User.countDocuments({ kingdom_id: kingdom.id, role: { $in: ["super_admin", "admin", "moderator"] } }),
      Bank.findOne({ kingdom: kingdom.id }).lean()
    ]);

    report += `\n*${kingdom.name}* (${kingdom.id})\n`;
    report += `الحالة: ${kingdom.isActive ? "نشطة" : "معطلة"}\n`;
    report += `الأعضاء: ${usersCount} | الإدارة: ${adminsCount}\n`;
    report += `البنك: ${bank?.totalCoins ?? kingdom.bankStartingBalance ?? 0}\n`;
    report += `الرئيسي: ${kingdom.mainGroup || "-"}\n`;
    report += `الاستقبال: ${kingdom.receptionGroup || "-"}\n`;
    report += `الإدارة: ${kingdom.adminGroup || "-"}\n`;
    report += `الوورك: ${kingdom.workGroup || "-"}\n`;
    report += `تاريخ الإنشاء: ${new Date(kingdom.createdAt).toLocaleString("ar-EG")}\n`;
  }

  const recentLogs = await KingdomAuditLog.find({}).sort({ createdAt: -1 }).limit(8).lean();
  if (recentLogs.length) {
    report += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    report += `*آخر العمليات*\n`;
    for (const log of recentLogs) {
      const actor = await resolveMentionContext(log.actorJid, log.kingdomId);
      mentions.push(...actor.mentions);
      report += `• ${log.action} | ${actor.text} | ${new Date(log.createdAt).toLocaleString("ar-EG")}`;
      if (log.kingdomId) report += ` | ${log.kingdomId}`;
      report += `\n`;
    }
  }

  if (options.withMentions) {
    return { text: report, mentions: [...new Set(mentions)] };
  }

  return report;
}
