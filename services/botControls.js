import { AsyncLocalStorage } from 'node:async_hooks';
import BotControl from '../database/botControlModel.js';

export const CONTROL_LABELS = {
  bot: 'تشغيل البوت', replies: 'الردود التفاعلية', automatic: 'الرسائل التلقائية',
  services: 'الخدمات الخارجية', ai: 'المحادثة الذكية', tracking: 'تتبع التفاعل',
  welcome: 'الترحيب التلقائي', reports: 'التقارير المجدولة', reminders: 'التذكيرات المجدولة'
};
const controls = new Map();
const notices = new Map();
const context = new AsyncLocalStorage();
export const maintenanceMessage = 'هذا الأمر متوقف مؤقتًا للصيانة. جرّب لاحقًا.';
export const withBotContext = (kind, task) => context.run({ kind }, task);
export function setControlSnapshot(rows) {
  controls.clear();
  for (const row of rows) controls.set(row.key, row);
}
export async function loadBotControls() { setControlSnapshot(await BotControl.find({}).lean()); }
export function controlBlocked(key, now = Date.now()) {
  const row = controls.get(key);
  return row?.enabled === false && (!row.until || new Date(row.until).getTime() > now) ? row : null;
}
export function featureEnabled(key) {
  return !controlBlocked('bot') && !controlBlocked(key);
}
export function outgoingAllowed() {
  const kind = context.getStore()?.kind;
  if (kind === 'maintenance') return featureEnabled('bot');
  return featureEnabled(kind === 'reply' ? 'replies' : 'automatic');
}
export function controlSnapshot() { return [...controls.values()]; }
export async function saveBotControl(key, input) {
  if (typeof input.enabled !== 'boolean') throw new Error('اختر حالة التشغيل');
  const revision = Number(input.revision ?? 0);
  if (!Number.isInteger(revision) || revision < 0) throw new Error('إصدار غير صالح');
  const minutes = Number(input.minutes || 0);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 43200) throw new Error('مدة الإيقاف غير صالحة');
  const state = { enabled: input.enabled, until: !input.enabled && minutes ? new Date(Date.now() + minutes * 60000) : null,
    message: String(input.message || '').trim().slice(0, 500), reason: String(input.reason || '').trim().slice(0, 500) };
  let result;
  try {
    result = await BotControl.findOneAndUpdate({ key, revision }, {
      $set: state, $inc: { revision: 1 },
      $push: { history: { $each: [{ ...state, at: new Date(), actor: 'dashboard:owner' }], $slice: -50 } }
    }, { new: true, upsert: revision === 0, runValidators: true }).lean();
  } catch (error) { if (error.code === 11000) throw new Error('تغيرت الإعدادات؛ حدّث الصفحة'); throw error; }
  if (!result) throw new Error('تغيرت الإعدادات؛ حدّث الصفحة');
  controls.set(key, result);
  return result;
}
export async function denyCommandIfPaused(sock, jid, sender, text) {
  const trigger = String(text || '').trim().split(/\s+/)[0].toLowerCase();
  const rule = controlBlocked(`command:${trigger}`);
  if (!rule) return false;
  const key = JSON.stringify([jid, sender, trigger]);
  const now = Date.now();
  for (const [id, expires] of notices) if (expires <= now) notices.delete(id);
  if (!notices.has(key)) {
    if (notices.size >= 5000) notices.delete(notices.keys().next().value);
    notices.set(key, now + 30000);
    await withBotContext('maintenance', () => sock.sendMessage(jid, { text: rule.message || maintenanceMessage }));
  }
  return true;
}

