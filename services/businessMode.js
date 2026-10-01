import BusinessSettings from '../database/businessSettingsModel.js';
import BusinessOrder from '../database/businessOrderModel.js';
import BusinessContact from '../database/businessContactModel.js';
import BusinessDailyStat from '../database/businessDailyStatModel.js';
import { featureEnabled } from './botControls.js';
import { DEVELOPER_JID, DEVELOPER_JIDS } from '../config.js';

export const ORDER_STATUSES = { new: 'جديد', confirmed: 'مؤكد', done: 'منجز', cancelled: 'ملغي' };
const AUTO_REPLY_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const SESSION_TTL_MS = 15 * 60 * 1000;
const CANCEL_WORDS = ['الغاء', 'cancel', 'stop'];

export const DEFAULT_BUSINESS_SETTINGS = Object.freeze({
  enabled: false,
  businessName: '',
  ownerJids: [],
  timeZone: 'Asia/Amman',
  greeting: 'أهلًا {name} 👋\nشكرًا لتواصلك مع {business}. اكتب سؤالك، أو اكتب "طلب" لتسجيل طلب جديد.',
  awayMessage: 'أهلًا {name}، نحن خارج أوقات الدوام حاليًا ({hours}). سنرد عليك أول ما نرجع. تقدر تكتب "طلب" وسنسجله لك الآن.',
  hours: { enabled: false, start: '09:00', end: '17:00', days: [0, 1, 2, 3, 4, 6] },
  faq: [],
  orders: {
    enabled: true,
    label: 'طلب',
    keywords: ['طلب', 'اطلب', 'حجز', 'احجز', 'order', 'book'],
    questions: ['شو حاب تطلب أو تحجز؟ اكتب التفاصيل.', 'ما اسمك؟', 'الموعد أو العنوان المناسب لك؟'],
    confirmation: 'تم تسجيل {label} رقم #{ref} ✅\nسنتواصل معك قريبًا لتأكيده.',
    notifyOwner: true
  },
  summary: { enabled: true, time: '21:00' }
});

// ---------- persistence (swappable for tests) ----------
const mongoStore = {
  async loadSettings() { return BusinessSettings.findOne({ key: 'main' }).lean(); },
  async saveSettings(values) {
    return BusinessSettings.findOneAndUpdate({ key: 'main' }, { $set: values }, { new: true, upsert: true, runValidators: true }).lean();
  },
  async touchContact(jid, { name, phone, dateKey, now }) {
    const before = await BusinessContact.findOneAndUpdate(
      { jid },
      { $set: { lastSeenAt: now, ...(name ? { name } : {}), ...(phone ? { phone } : {}) }, $inc: { messageCount: 1 }, $setOnInsert: { firstDateKey: dateKey } },
      { upsert: true, new: false }
    ).lean();
    return { isNew: !before, lastAutoReplyAt: before?.lastAutoReplyAt || null };
  },
  async markAutoReply(jid, now) { await BusinessContact.updateOne({ jid }, { $set: { lastAutoReplyAt: now } }); },
  async bumpStat(dateKey, field, amount = 1) {
    await BusinessDailyStat.updateOne({ dateKey }, { $inc: { [field]: amount } }, { upsert: true });
  },
  async nextOrderRef() {
    const row = await BusinessSettings.findOneAndUpdate({ key: 'main' }, { $inc: { orderSeq: 1 } }, { new: true, upsert: true }).lean();
    return row.orderSeq;
  },
  async createOrder(values) { return (await BusinessOrder.create(values)).toObject(); }
};
let store = mongoStore;
export function setBusinessStore(next) { store = next ? { ...mongoStore, ...next } : mongoStore; }
export function businessStore() { return store; }

// ---------- settings cache ----------
let settingsCache = null;
export function mergeBusinessSettings(row = {}) {
  const base = structuredClone(DEFAULT_BUSINESS_SETTINGS);
  const merged = { ...base, ...(row || {}) };
  merged.hours = { ...base.hours, ...(row?.hours || {}) };
  merged.orders = { ...base.orders, ...(row?.orders || {}) };
  merged.summary = { ...base.summary, ...(row?.summary || {}) };
  merged.faq = Array.isArray(row?.faq) ? row.faq : [];
  merged.ownerJids = Array.isArray(row?.ownerJids) ? row.ownerJids : [];
  return merged;
}
export function setBusinessSettingsCache(row) { settingsCache = row ? mergeBusinessSettings(row) : null; }
export async function getBusinessSettings({ refresh = false } = {}) {
  if (!settingsCache || refresh) settingsCache = mergeBusinessSettings(await store.loadSettings());
  return settingsCache;
}
export function ownerJidsOf(settings) {
  return settings.ownerJids?.length ? settings.ownerJids : [DEVELOPER_JID];
}

// ---------- validation ----------
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const list = (value) => (Array.isArray(value) ? value : String(value ?? '').split(/[\n,،]/)).map(item => String(item).trim()).filter(Boolean);

export function normalizeOwnerJid(value) {
  const text = String(value || '').trim();
  if (/^\d{6,20}@(s\.whatsapp\.net|lid)$/.test(text)) return text;
  const digits = text.replace(/[\s+\-()]/g, '');
  if (/^\d{6,20}$/.test(digits)) return `${digits}@s.whatsapp.net`;
  throw new Error('رقم المالك غير صالح: ' + text);
}

export function validateBusinessSettings(input = {}) {
  const timeZone = clean(input.timeZone || 'Asia/Amman', 64);
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new Error('المنطقة الزمنية غير صالحة'); }
  const hours = input.hours || {};
  const start = clean(hours.start || '09:00', 5), end = clean(hours.end || '17:00', 5);
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) throw new Error('صيغة وقت الدوام يجب أن تكون HH:MM');
  const days = [...new Set((Array.isArray(hours.days) ? hours.days : []).map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  const faqInput = Array.isArray(input.faq) ? input.faq : [];
  if (faqInput.length > 60) throw new Error('الحد الأقصى 60 سؤالًا شائعًا');
  const faq = faqInput.map(item => ({
    question: clean(item?.question, 120),
    keywords: list(item?.keywords).map(word => word.slice(0, 40)).slice(0, 15),
    answer: clean(item?.answer, 1500),
    enabled: item?.enabled !== false
  })).filter(item => item.question || item.answer || item.keywords.length);
  for (const item of faq) {
    if (!item.keywords.length || !item.answer) throw new Error('كل سؤال شائع يحتاج كلمات مفتاحية وجوابًا');
  }
  const ordersInput = input.orders || {};
  const orders = {
    enabled: ordersInput.enabled !== false,
    label: clean(ordersInput.label || 'طلب', 40),
    keywords: list(ordersInput.keywords).map(word => word.slice(0, 40)).slice(0, 15),
    questions: list(Array.isArray(ordersInput.questions) ? ordersInput.questions : String(ordersInput.questions ?? '').split('\n')).map(q => q.slice(0, 300)).slice(0, 6),
    confirmation: clean(ordersInput.confirmation || DEFAULT_BUSINESS_SETTINGS.orders.confirmation, 800),
    notifyOwner: ordersInput.notifyOwner !== false
  };
  if (!orders.keywords.length) orders.keywords = [...DEFAULT_BUSINESS_SETTINGS.orders.keywords];
  if (!orders.questions.length) orders.questions = [...DEFAULT_BUSINESS_SETTINGS.orders.questions];
  const summaryInput = input.summary || {};
  const summary = { enabled: summaryInput.enabled !== false, time: clean(summaryInput.time || '21:00', 5) };
  if (!TIME_RE.test(summary.time)) throw new Error('صيغة وقت الملخص يجب أن تكون HH:MM');
  const ownerJids = [...new Set(list(input.ownerJids).map(normalizeOwnerJid))].slice(0, 5);
  return {
    enabled: input.enabled === true,
    businessName: clean(input.businessName, 80),
    ownerJids,
    timeZone,
    greeting: clean(input.greeting, 1500),
    awayMessage: clean(input.awayMessage, 1500),
    hours: { enabled: hours.enabled === true, start, end, days },
    faq,
    orders,
    summary
  };
}

// ---------- time helpers ----------
export function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  };
}
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export function isWithinHours(settings, date = new Date()) {
  const hours = settings.hours || {};
  if (!hours.enabled) return true;
  const { minutes, weekday } = zonedParts(date, settings.timeZone);
  const start = toMinutes(hours.start), end = toMinutes(hours.end);
  if (start === end) return hours.days.includes(weekday);
  if (start < end) return hours.days.includes(weekday) && minutes >= start && minutes < end;
  // Overnight shift (e.g. 18:00-02:00): the early-morning part belongs to the previous day.
  if (minutes >= start) return hours.days.includes(weekday);
  return minutes < end && hours.days.includes((weekday + 6) % 7);
}

// ---------- text matching ----------
export function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function containsWord(text, keyword) {
  if (!keyword) return false;
  if (keyword.includes(' ')) return ` ${text} `.includes(` ${keyword} `);
  // Allow the Arabic "ال"/"و"/"ب" prefixes a customer naturally adds (e.g. "الاسعار" for "اسعار").
  return text.split(' ').some(word => word === keyword || (keyword.length >= 3 && /^(وال|بال|لل|ال|و|ب|ل)/.test(word) && word.replace(/^(وال|بال|لل|ال|و|ب|ل)/, '') === keyword));
}
export function matchFaq(faq, text) {
  const normalized = normalizeText(text);
  let best = null, bestLength = 0;
  for (const item of faq || []) {
    if (item.enabled === false) continue;
    for (const keyword of item.keywords || []) {
      const key = normalizeText(keyword);
      if (key.length > bestLength && containsWord(normalized, key)) { best = item; bestLength = key.length; }
    }
  }
  return best;
}
export function isOrderRequest(settings, text) {
  if (!settings.orders?.enabled) return false;
  const normalized = normalizeText(text);
  // Only short messages start an order, so "كم سعر الطلب؟" still reaches the FAQ.
  if (normalized.split(' ').length > 4) return false;
  return (settings.orders.keywords || []).some(keyword => containsWord(normalized, normalizeText(keyword)));
}

export function fillTemplate(template, values) {
  return String(template || '').replace(/\{(name|business|hours|ref|label)\}/g, (_, key) => String(values[key] ?? ''));
}
function hoursText(settings) {
  const names = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const days = settings.hours.days.map(day => names[day]).join('، ');
  return `${settings.hours.start}-${settings.hours.end}${days ? ' | ' + days : ''}`;
}

// ---------- chat identity ----------
export function isPrivateChat(jid) {
  return /@(s\.whatsapp\.net|lid)$/.test(String(jid || ''));
}
const bare = jid => String(jid || '').split(':')[0].split('@')[0];
export function isBusinessOwner(settings, jid) {
  const id = bare(jid);
  return [...ownerJidsOf(settings), ...DEVELOPER_JIDS].some(owner => bare(owner) === id);
}
function customerPhone(msg) {
  const candidates = [msg.key?.remoteJid, msg.key?.remoteJidAlt, msg.key?.senderPn];
  const pn = candidates.find(jid => /@s\.whatsapp\.net$/.test(String(jid || '')));
  return pn ? bare(pn) : '';
}

// ---------- order sessions ----------
const sessions = new Map();
export function clearBusinessSessions() { sessions.clear(); }
function sweepSessions(now) { for (const [key, value] of sessions) if (value.expires < now) sessions.delete(key); }

async function notifyOwners(sock, settings, text) {
  for (const owner of ownerJidsOf(settings)) {
    try { await sock.sendMessage(owner, { text }); } catch (error) { console.warn('Business owner notice failed:', error.message); }
  }
}

export function formatOrderForOwner(order) {
  const lines = [`🧾 *${order.label} جديد #${order.ref}*`, `العميل: ${order.customerName || '—'}${order.customerPhone ? ` (+${order.customerPhone})` : ''}`];
  for (const { question, answer } of order.answers) lines.push(`• ${question}\n  ${answer}`);
  lines.push('', 'تابعه من لوحة التحكم ← الأعمال.');
  return lines.join('\n');
}

async function continueOrder(sock, jid, session, text, settings, now) {
  if (CANCEL_WORDS.includes(normalizeText(text))) {
    sessions.delete(jid);
    await sock.sendMessage(jid, { text: `تم إلغاء ${settings.orders.label}. اكتب "${settings.orders.keywords[0]}" متى ما حبيت تبدأ من جديد.` });
    return;
  }
  session.answers.push({ question: session.questions[session.step], answer: String(text).trim().slice(0, 1000) });
  session.step += 1;
  session.expires = now + SESSION_TTL_MS;
  if (session.step < session.questions.length) {
    await sock.sendMessage(jid, { text: session.questions[session.step] });
    return;
  }
  sessions.delete(jid);
  const ref = await store.nextOrderRef();
  const order = await store.createOrder({
    ref, label: settings.orders.label, customerJid: jid, customerPhone: session.phone, customerName: session.name,
    answers: session.answers, status: 'new', dateKey: zonedParts(new Date(now), settings.timeZone).dateKey
  });
  await store.bumpStat(order.dateKey, 'orders');
  await sock.sendMessage(jid, { text: fillTemplate(settings.orders.confirmation, { ref, label: settings.orders.label, name: session.name, business: settings.businessName }) });
  if (settings.orders.notifyOwner) await notifyOwners(sock, settings, formatOrderForOwner(order));
}

/**
 * Business-mode entry point for incoming messages. Returns true when the message was
 * answered here, false to let the rest of the bot handle it.
 * Only private chats from customers are touched; groups, slash commands and owners pass through.
 */
export async function handleBusinessMessage(sock, msg, text, now = Date.now()) {
  const jid = msg?.key?.remoteJid;
  if (msg?.key?.fromMe || !isPrivateChat(jid)) return false;
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.startsWith('/')) return false;
  if (!featureEnabled('business')) return false;
  const settings = await getBusinessSettings();
  if (!settings.enabled || isBusinessOwner(settings, jid)) return false;

  const { dateKey } = zonedParts(new Date(now), settings.timeZone);
  const name = String(msg.pushName || '').slice(0, 120);
  const phone = customerPhone(msg);
  let contact = { isNew: false, lastAutoReplyAt: null };
  try {
    contact = await store.touchContact(jid, { name, phone, dateKey, now: new Date(now) });
    await store.bumpStat(dateKey, 'messages');
    if (contact.isNew) await store.bumpStat(dateKey, 'newContacts');
  } catch (error) { console.warn('Business stats failed:', error.message); }

  sweepSessions(now);
  const session = sessions.get(jid);
  if (session) { await continueOrder(sock, jid, session, trimmed, settings, now); return true; }

  if (isOrderRequest(settings, trimmed)) {
    if (sessions.size >= 2000) sessions.delete(sessions.keys().next().value);
    sessions.set(jid, { step: 0, answers: [], questions: [...settings.orders.questions], name, phone, expires: now + SESSION_TTL_MS });
    await sock.sendMessage(jid, { text: `${settings.orders.questions[0]}\n\n(اكتب "إلغاء" للإلغاء)` });
    return true;
  }

  const faq = matchFaq(settings.faq, trimmed);
  if (faq) {
    await sock.sendMessage(jid, { text: fillTemplate(faq.answer, { name: name || 'صديقي', business: settings.businessName }) });
    try { await store.bumpStat(dateKey, 'faqHits'); } catch { /* counters are best-effort */ }
    return true;
  }

  const lastReply = contact.lastAutoReplyAt ? new Date(contact.lastAutoReplyAt).getTime() : 0;
  if (now - lastReply < AUTO_REPLY_COOLDOWN_MS) return false;
  const open = isWithinHours(settings, new Date(now));
  const template = open ? settings.greeting : (settings.awayMessage || settings.greeting);
  if (!template) return false;
  await sock.sendMessage(jid, { text: fillTemplate(template, { name: name || 'صديقي', business: settings.businessName || 'فريقنا', hours: hoursText(settings) }) });
  try { await store.markAutoReply(jid, new Date(now)); await store.bumpStat(dateKey, 'autoReplies'); } catch { /* best-effort */ }
  return true;
}

// هل هذه محادثة خاصة لعميل بينما وضع الأعمال شغال؟ (حتى لا تتدخل ميزات المساعد الشخصي)
export async function isBusinessCustomerChat(jid) {
  if (!isPrivateChat(jid) || !featureEnabled('business')) return false;
  try {
    const settings = await getBusinessSettings();
    return Boolean(settings.enabled) && !isBusinessOwner(settings, jid);
  } catch {
    return false;
  }
}
