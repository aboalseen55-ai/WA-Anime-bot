import { dashboardReply } from '../services/dashboardTemplates.js';
import { isSuperAdminInKingdom, grantEmperorRankWithPassword, deleteUser } from "../commands/adminSystem.js";
import User from "../database/userModel.js";
import { awaitingEmperorPassword, pendingKick } from "./handlerState.js";

// التحقق من طلب حذف بيانات المطرود
export async function handleKickConfirmation(sock, jid, sender, trimmedText, kingdom) {
  if (!(pendingKick[jid] && (trimmedText.toLowerCase() === 'نعم' || trimmedText.toLowerCase() === 'لا'))) return false;

  const kickData = pendingKick[jid];

  // التحقق من أن الرد من مشرف أو أدمن (في نفس المملكة)
  const isSuper = await isSuperAdminInKingdom(sender, kingdom);
  const admin = await User.findOne({ jid: sender, kingdom_id: kingdom });
  const isModOrAdmin = admin && (isSuper || admin.role === 'admin' || admin.role === 'moderator');

  if (!isModOrAdmin) {
    await sock.sendMessage(jid, { text: dashboardReply('reply_1f45fb8219da7caa')(['❌ فقط المشرفون والأدمنز يمكنهم الرد على هذا السؤال!']) });
    return true;
  }

  if (trimmedText.toLowerCase() === 'نعم') {
    // حذف البيانات
    await deleteUser(sock, jid, kickData.userId, sender);
    await sock.sendMessage(jid, { text: dashboardReply('reply_ed705629dfd2c162')`✅ تم حذف بيانات ${kickData.nickname} من قاعدة البيانات!` });
  } else {
    await sock.sendMessage(jid, { text: dashboardReply('reply_06aa610196f3dd2f')`ℹ️ تم الاحتفاظ ببيانات ${kickData.nickname}.` });
  }

  delete pendingKick[jid];
  return true;
}

// معالجة كلمة السر لمنح رتبة الإمبراطور
export async function handleEmperorPassword(sock, sender, text) {
  if (!awaitingEmperorPassword.has(sender)) return false;

  const data = awaitingEmperorPassword.get(sender);
  awaitingEmperorPassword.delete(sender);

  // التحقق من كلمة السر
  const { ADMIN_PASSWORD, ADMIN_PASSWORD_CONFIGURED } = await import('../config.js');
  if (!ADMIN_PASSWORD_CONFIGURED) {
    await sock.sendMessage(sender, { text: dashboardReply('reply_cd46f6729d92908e')(['❌ كلمة مرور الأدمن غير مضبوطة في ملف البيئة ADMIN_PASSWORD. تم إلغاء العملية.']) });
    return true;
  }

  if (text.trim() === ADMIN_PASSWORD) {
    // منح الرتبة
    await grantEmperorRankWithPassword(sock, data.groupJid, data.nickname, text.trim(), sender);
  } else {
    await sock.sendMessage(sender, { text: dashboardReply('reply_b8556ab18fcf5378')(['❌ كلمة المرور غير صحيحة! تم إلغاء العملية.']) });
  }
  return true;
}
