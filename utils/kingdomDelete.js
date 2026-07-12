import Kingdom from "../database/kingdomModel.js";
import Bank from "../database/bankModel.js";
import User from "../database/userModel.js";
import MafiaSession from "../database/mafiaSessionModel.js";
import { ADMIN_PASSWORD, ADMIN_PASSWORD_CONFIGURED, DEFAULT_KINGDOMS, DEVELOPER_JID } from "../config.js";
import { deleteKingdomById, isDeveloper } from "./kingdomService.js";

const DELETE_COMMANDS = new Set(["/حذف_مملكة", "/حذف_نقابة", "/delete_kingdom"]);
const CANCEL_PATTERN = /^(إلغاء|الغاء|cancel)$/i;
const CONFIRM_PREFIX_PATTERN = /^(حذف|delete)\s+([a-z][a-z0-9_-]{2,30})$/i;

const deleteSessions = new Map();

function isPrivateChat(jid) {
  return !String(jid || "").endsWith("@g.us");
}

function getKingdomGroups(kingdom) {
  return [
    kingdom.mainGroup,
    kingdom.receptionGroup,
    kingdom.adminGroup,
    kingdom.workGroup,
    ...(kingdom.groupIds || [])
  ].filter(Boolean);
}

function formatKingdomChoiceList(kingdoms) {
  if (!kingdoms.length) return "لا توجد ممالك قابلة للحذف.";

  return kingdoms.map((kingdom, index) => {
    const protectedLabel = DEFAULT_KINGDOMS[kingdom.id] ? " - محمية" : "";
    return `${index + 1}. ${kingdom.name} (${kingdom.id})${protectedLabel}`;
  }).join("\n");
}

function normalizeSelection(value) {
  return String(value || "").trim().toLowerCase();
}

async function loadKingdomChoices() {
  return Kingdom.find({}).sort({ createdAt: 1 }).select("id name mainGroup receptionGroup adminGroup workGroup groupIds createdAt").lean();
}

async function selectKingdom(session, value) {
  const choice = normalizeSelection(value);
  const number = Number(choice);

  if (Number.isInteger(number) && number >= 1 && number <= session.kingdoms.length) {
    return session.kingdoms[number - 1];
  }

  const escaped = choice.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = session.kingdoms.filter((kingdom) => {
    return kingdom.id === choice || new RegExp(`^${escaped}$`, "i").test(kingdom.name);
  });

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    return { ambiguous: true, matches };
  }

  return null;
}

async function buildDeleteSummary(kingdom) {
  const groups = [...new Set(getKingdomGroups(kingdom))];
  const [usersCount, adminsCount, bank, mafiaSessionsCount] = await Promise.all([
    User.countDocuments({ kingdom_id: kingdom.id }),
    User.countDocuments({ kingdom_id: kingdom.id, role: { $in: ["super_admin", "admin", "moderator"] } }),
    Bank.findOne({ kingdom: kingdom.id }).lean(),
    groups.length ? MafiaSession.countDocuments({ groupId: { $in: groups } }) : 0
  ]);

  return `⚠️ *تأكيد حذف مملكة*

المملكة: ${kingdom.name}
المعرف: ${kingdom.id}
تاريخ الإنشاء: ${kingdom.createdAt ? new Date(kingdom.createdAt).toLocaleString("ar-EG") : "-"}

سيتم حذف:
• سجل المملكة من قاعدة البيانات
• الأعضاء: ${usersCount}
• الإدارة داخل المملكة: ${adminsCount}
• البنك: ${bank ? bank.totalCoins : "لا يوجد"}
• جلسات المافيا المرتبطة بقروباتها: ${mafiaSessionsCount}

القروبات المرتبطة:
${groups.length ? groups.join("\n") : "-"}

للتأكيد النهائي اكتب بالضبط:
حذف ${kingdom.id}

للإلغاء اكتب: إلغاء`;
}

export async function handleStartKingdomDelete(sock, jid, sender, trimmedText) {
  const command = String(trimmedText || "").split(/\s+/)[0];
  if (!DELETE_COMMANDS.has(command)) return false;

  if (!isPrivateChat(jid)) {
    await sock.sendMessage(jid, { text: "🔐 للحذف بأمان، أرسل أمر /حذف_مملكة في خاص البوت فقط." });
    return true;
  }

  if (!isDeveloper(sender)) {
    await sock.sendMessage(jid, { text: "❌ هذا الأمر خاص بالمطور فقط." });
    return true;
  }

  if (!ADMIN_PASSWORD_CONFIGURED) {
    await sock.sendMessage(jid, { text: "❌ ADMIN_PASSWORD غير مضبوط في Railway variables." });
    return true;
  }

  deleteSessions.set(sender, { stage: "password", startedAt: Date.now() });
  await sock.sendMessage(jid, { text: "🔐 أرسل كلمة مرور الأدمن لبدء حذف مملكة.\nللإلغاء اكتب: إلغاء" });
  return true;
}

export async function handleKingdomDeleteStep(sock, jid, sender, text) {
  const session = deleteSessions.get(sender);
  if (!session) return false;

  if (!isPrivateChat(jid)) {
    await sock.sendMessage(jid, { text: "🔐 أكمل حذف المملكة في الخاص فقط." });
    return true;
  }

  const trimmed = String(text || "").trim();
  if (!trimmed) return true;

  if (CANCEL_PATTERN.test(trimmed)) {
    deleteSessions.delete(sender);
    await sock.sendMessage(jid, { text: "✅ تم إلغاء حذف المملكة." });
    return true;
  }

  if (session.stage === "password") {
    if (trimmed !== ADMIN_PASSWORD) {
      deleteSessions.delete(sender);
      await sock.sendMessage(jid, { text: "❌ كلمة المرور غير صحيحة. تم إلغاء العملية." });
      return true;
    }

    const kingdoms = await loadKingdomChoices();
    const deletable = kingdoms.filter((kingdom) => !DEFAULT_KINGDOMS[kingdom.id]);
    if (!deletable.length) {
      deleteSessions.delete(sender);
      await sock.sendMessage(jid, { text: "لا توجد ممالك قابلة للحذف. الممالك الافتراضية محمية ويمكن تعطيلها من /تعديل_مملكة." });
      return true;
    }

    session.stage = "select";
    session.kingdoms = deletable.map((kingdom) => ({
      ...kingdom,
      _id: String(kingdom._id)
    }));
    deleteSessions.set(sender, session);

    await sock.sendMessage(jid, {
      text: `✅ تم قبول كلمة المرور.\n\nاختر المملكة المراد حذفها بإرسال الرقم أو المعرف:\n${formatKingdomChoiceList(session.kingdoms)}\n\nللإلغاء اكتب: إلغاء`
    });
    return true;
  }

  if (session.stage === "select") {
    const selected = await selectKingdom(session, trimmed);
    if (!selected) {
      await sock.sendMessage(jid, { text: `❌ لم أجد هذا الاختيار. أرسل رقمًا من القائمة أو معرف المملكة:\n${formatKingdomChoiceList(session.kingdoms)}` });
      return true;
    }

    if (selected.ambiguous) {
      await sock.sendMessage(jid, {
        text: `وجدت أكثر من مملكة بهذا الاسم. اختر بالرقم أو المعرف:\n${formatKingdomChoiceList(selected.matches)}`
      });
      return true;
    }

    if (DEFAULT_KINGDOMS[selected.id]) {
      await sock.sendMessage(jid, { text: "❌ هذه المملكة محمية لأنها افتراضية. استخدم /تعديل_مملكة لتعطيلها بدل حذفها." });
      return true;
    }

    const freshKingdom = await Kingdom.findOne({ id: selected.id }).lean();
    if (!freshKingdom) {
      deleteSessions.delete(sender);
      await sock.sendMessage(jid, { text: "❌ لم أعد أجد هذه المملكة. أعد المحاولة." });
      return true;
    }

    session.stage = "confirm";
    session.kingdomId = freshKingdom.id;
    session.kingdomName = freshKingdom.name;
    deleteSessions.set(sender, session);

    await sock.sendMessage(jid, { text: await buildDeleteSummary(freshKingdom) });
    return true;
  }

  if (session.stage === "confirm") {
    const match = trimmed.match(CONFIRM_PREFIX_PATTERN);
    if (!match || match[2].toLowerCase() !== session.kingdomId) {
      await sock.sendMessage(jid, {
        text: `للتأكيد اكتب بالضبط:\nحذف ${session.kingdomId}\n\nللإلغاء اكتب: إلغاء`
      });
      return true;
    }

    try {
      const result = await deleteKingdomById(session.kingdomId, sender);
      deleteSessions.delete(sender);

      const message = `✅ تم حذف المملكة بنجاح.

المملكة: ${result.kingdom.name} (${result.kingdom.id})
الأعضاء المحذوفون: ${result.deleted.users}
البنك المحذوف: ${result.deleted.bank}
جلسات المافيا المحذوفة: ${result.deleted.mafiaSessions}
لاعبو المافيا المفصولون عن قروباتها: ${result.deleted.mafiaPlayersUnlinked}`;

      await sock.sendMessage(jid, { text: message });
      await sock.sendMessage(DEVELOPER_JID, {
        text: `🗑️ تم حذف مملكة\nالمملكة: ${result.kingdom.name} (${result.kingdom.id})\nبواسطة: ${sender}`
      });
    } catch (error) {
      deleteSessions.delete(sender);
      await sock.sendMessage(jid, { text: `❌ فشل حذف المملكة: ${error.message}` });
    }
    return true;
  }

  return true;
}
