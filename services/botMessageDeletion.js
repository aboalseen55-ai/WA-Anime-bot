import mongoose from 'mongoose';
import { isDeveloper } from '../utils/kingdomService.js';
import { isModerator } from '../commands/adminSystem.js';
import { getKingdomIdFromGroupJid } from '../config.js';

const schema = new mongoose.Schema({
  chat: String, messageId: String, key: mongoose.Schema.Types.Mixed,
  sentAt: Date, revoked: { type: Boolean, default: false },
  expiresAt: { type: Date, expires: 0 }
});
schema.index({ chat: 1, messageId: 1 }, { unique: true });
schema.index({ chat: 1, revoked: 1, sentAt: -1 });
export const BotSentMessage = mongoose.models.BotSentMessage || mongoose.model('BotSentMessage', schema);
export const DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;
const running = new Set();

export async function rememberBotMessage(message) {
  if (!message?.key?.fromMe || !message.key.id || !message.key.remoteJid || !message.message) return;
  if (message.message.protocolMessage || message.message.reactionMessage) return;
  const seconds = Number(message.messageTimestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const sentAt = new Date(seconds * 1000);
  try {
    await BotSentMessage.updateOne({ chat: message.key.remoteJid, messageId: message.key.id }, {
      $setOnInsert: { key: message.key, sentAt, expiresAt: new Date(sentAt.getTime() + 30 * 86400000) }
    }, { upsert: true });
  } catch { console.warn('Could not record outgoing message for deletion'); }
}

export async function handleBotDeletion(sock, jid, sender, text) {
  if (text.split(/\s+/)[0] !== '/حذف_رسائلي') return false;
  const reply = text => sock.sendMessage(jid, { text });
  if (jid.endsWith('@g.us') && !isDeveloper(sender) &&
      !(await isModerator(sender, getKingdomIdFromGroupJid(jid)))) {
    await reply('حذف رسائل البوت في المجموعة متاح للمطور ومشرف المملكة فقط.');
    return true;
  }
  const countText = text.trim().split(/\s+/);
  const digits = (countText[1] || '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c));
  if (countText.length !== 2 || !/^\d+$/.test(digits) || Number(digits) < 1 || Number(digits) > 100) {
    await reply('الاستخدام: /حذف_رسائلي 10\nالعدد المسموح من 1 إلى 100، لرسائل البوت فقط.');
    return true;
  }
  if (running.has(jid)) { await reply('هناك عملية حذف جارية في هذه المحادثة.'); return true; }
  running.add(jid);
  try {
    const rows = await BotSentMessage.find({ chat: jid, revoked: false }).sort({ sentAt: -1, _id: -1 }).limit(Number(digits)).lean();
    let requested = 0, expired = 0, failed = 0;
    for (const row of rows) {
      if (Date.now() - new Date(row.sentAt).getTime() >= DELETE_WINDOW_MS) { expired++; continue; }
      if (!row.key?.fromMe || row.key.remoteJid !== jid) { failed++; continue; }
      try {
        await sock.sendMessage(jid, { delete: row.key });
        await BotSentMessage.updateOne({ _id: row._id }, { $set: { revoked: true } });
        requested++;
      } catch { failed++; }
    }
    await reply(`طلبات الحذف لدى الجميع: ${requested}\nخارج نافذة الحذف المعتمدة (48 ساعة): ${expired}\nتعذر تنفيذها: ${failed}\nغير متوفرة في السجل: ${Number(digits) - rows.length}\nالسجل يشمل رسائل البوت المسجلة بعد تفعيل الميزة. وصول الحذف لكل الأجهزة يخضع لواتساب.`);
  } finally { running.delete(jid); }
  return true;
}
