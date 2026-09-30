import BusinessOrder from '../database/businessOrderModel.js';
import BusinessDailyStat from '../database/businessDailyStatModel.js';
import { audit } from './dashboardData.js';
import { withBotContext } from './botControls.js';
import { businessStore, getBusinessSettings, setBusinessSettingsCache, validateBusinessSettings, zonedParts, ORDER_STATUSES, DEFAULT_BUSINESS_SETTINGS } from './businessMode.js';
import { buildBusinessSummaryText, scheduleBusinessSummary, sendBusinessSummary } from './businessSummary.js';

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Dashboard API for business mode. Returns the response body for routes under
 * "business", or null so the dashboard keeps looking for another handler.
 */
export async function handleBusinessRoute(route, method, input, url, { getSock } = {}) {
  if (route !== 'business' && !route.startsWith('business/')) return null;

  if (route === 'business' && method === 'GET') {
    const settings = await getBusinessSettings({ refresh: true });
    const status = String(url?.searchParams.get('status') || '');
    const q = String(url?.searchParams.get('q') || '').trim().slice(0, 60);
    const filter = {};
    if (Object.hasOwn(ORDER_STATUSES, status)) filter.status = status;
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ customerName: pattern }, { customerPhone: pattern }, { 'answers.answer': pattern }, ...(/^\d+$/.test(q) ? [{ ref: Number(q) }] : [])];
    }
    const { dateKey } = zonedParts(new Date(), settings.timeZone);
    const [orders, today, openCount] = await Promise.all([
      BusinessOrder.find(filter).sort({ createdAt: -1 }).limit(100).lean(),
      BusinessDailyStat.findOne({ dateKey }).lean(),
      BusinessOrder.countDocuments({ status: 'new' })
    ]);
    const { orderSeq, lastSummaryDate, _id, __v, key, ...publicSettings } = settings;
    return { settings: publicSettings, defaults: DEFAULT_BUSINESS_SETTINGS, statuses: ORDER_STATUSES, orders, today: { dateKey, ...(today || {}) }, openCount };
  }

  if (route === 'business/settings' && method === 'PUT') {
    const values = validateBusinessSettings(input);
    setBusinessSettingsCache(await businessStore().saveSettings(values));
    await scheduleBusinessSummary();
    await audit('business_settings_updated', values.enabled ? 'enabled' : 'disabled');
    return { ok: true };
  }

  const order = /^business\/orders\/([a-f0-9]{24})$/.exec(route);
  if (order && method === 'PUT') {
    if (!Object.hasOwn(ORDER_STATUSES, input.status)) throw new Error('حالة الطلب غير صالحة');
    const updated = await BusinessOrder.findByIdAndUpdate(order[1], { $set: { status: input.status, note: String(input.note ?? '').trim().slice(0, 500) } }, { new: true, runValidators: true }).lean();
    if (!updated) throw new Error('الطلب غير موجود');
    await audit('business_order_updated', `#${updated.ref} ${input.status}`);
    return { ok: true, order: updated };
  }

  if (route === 'business/summary' && method === 'GET') {
    const { text } = await buildBusinessSummaryText();
    return { text };
  }

  if (route === 'business/summary' && method === 'POST') {
    const sock = getSock?.();
    if (!sock) throw new Error('البوت غير متصل بواتساب');
    const result = await withBotContext('automatic', () => sendBusinessSummary(sock, { force: true }));
    return { ok: true, sent: result.sent };
  }

  return null;
}
