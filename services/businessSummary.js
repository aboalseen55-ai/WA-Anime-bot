import BusinessOrder from '../database/businessOrderModel.js';
import BusinessDailyStat from '../database/businessDailyStatModel.js';
import BusinessSettings from '../database/businessSettingsModel.js';
import { featureEnabled, withBotContext } from './botControls.js';
import { getBusinessSettings, ownerJidsOf, zonedParts, ORDER_STATUSES } from './businessMode.js';

let timer = null;
let activeSock = null;

export async function collectBusinessSummary(dateKey) {
  const [stat, todayOrders, openCount] = await Promise.all([
    BusinessDailyStat.findOne({ dateKey }).lean(),
    BusinessOrder.find({ dateKey }).sort({ ref: 1 }).limit(50).lean(),
    BusinessOrder.countDocuments({ status: 'new' })
  ]);
  return { dateKey, stat: stat || {}, orders: todayOrders, openCount };
}

export function formatBusinessSummary(settings, { dateKey, stat, orders, openCount }) {
  const lines = [
    `📊 *ملخص ${settings.businessName || 'الأعمال'} اليومي*`,
    `📅 ${dateKey}`,
    '',
    `💬 رسائل العملاء: ${stat.messages || 0}`,
    `🆕 عملاء جدد: ${stat.newContacts || 0}`,
    `❓ أسئلة شائعة أُجيب عنها: ${stat.faqHits || 0}`,
    `👋 ردود ترحيب تلقائية: ${stat.autoReplies || 0}`,
    `🧾 ${settings.orders?.label || 'طلب'} اليوم: ${orders.length}`
  ];
  if (orders.length) {
    lines.push('');
    for (const order of orders.slice(0, 10)) {
      const detail = String(order.answers?.[0]?.answer || '').replace(/\s+/g, ' ').slice(0, 60);
      lines.push(`#${order.ref} • ${order.customerName || '—'} • ${ORDER_STATUSES[order.status] || order.status}${detail ? `\n   ${detail}` : ''}`);
    }
    if (orders.length > 10) lines.push(`… و${orders.length - 10} غيرها في لوحة التحكم`);
  }
  lines.push('', openCount ? `⏳ بانتظار المتابعة: ${openCount}` : '✅ لا توجد طلبات معلّقة');
  return lines.join('\n');
}

export async function buildBusinessSummaryText(now = new Date()) {
  const settings = await getBusinessSettings({ refresh: true });
  const { dateKey } = zonedParts(now, settings.timeZone);
  return { settings, dateKey, text: formatBusinessSummary(settings, await collectBusinessSummary(dateKey)) };
}

export async function sendBusinessSummary(sock, { force = false } = {}) {
  const { settings, dateKey, text } = await buildBusinessSummaryText();
  if (!force && (!settings.enabled || !settings.summary.enabled)) return { sent: 0 };
  // Claim the day before sending so a reconnect does not send the same summary twice.
  if (!force) {
    const claimed = await BusinessSettings.updateOne({ key: 'main', lastSummaryDate: { $ne: dateKey } }, { $set: { lastSummaryDate: dateKey } });
    if (!claimed.modifiedCount) return { sent: 0 };
  }
  let sent = 0;
  for (const owner of ownerJidsOf(settings)) {
    try { await sock.sendMessage(owner, { text }); sent++; } catch (error) { console.warn('Business summary failed:', error.message); }
  }
  return { sent };
}

export function nextSummaryDelayMs(settings, now = new Date()) {
  const [hour, minute] = settings.summary.time.split(':').map(Number);
  const target = hour * 60 + minute;
  const { minutes } = zonedParts(now, settings.timeZone);
  let delayMinutes = target - minutes;
  if (delayMinutes <= 0) delayMinutes += 24 * 60;
  // Land a few seconds into the minute; DST shifts are corrected by the next reschedule.
  return delayMinutes * 60000 - now.getSeconds() * 1000 - now.getMilliseconds() + 5000;
}

export async function scheduleBusinessSummary(sock = activeSock) {
  if (sock) activeSock = sock;
  if (timer) { clearTimeout(timer); timer = null; }
  if (!activeSock) return;
  let settings;
  try { settings = await getBusinessSettings({ refresh: true }); } catch (error) { console.warn('Business summary schedule failed:', error.message); return; }
  if (!settings.enabled || !settings.summary.enabled) return;
  timer = setTimeout(async () => {
    timer = null;
    try {
      if (featureEnabled('automatic') && featureEnabled('business')) await withBotContext('automatic', () => sendBusinessSummary(activeSock));
    } catch (error) { console.warn('Business summary failed:', error.message); }
    scheduleBusinessSummary();
  }, nextSummaryDelayMs(settings));
  timer.unref?.();
}
