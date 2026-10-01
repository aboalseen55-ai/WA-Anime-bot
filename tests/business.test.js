import test from 'node:test';
import assert from 'node:assert/strict';
import { setControlSnapshot } from '../services/botControls.js';
import {
  handleBusinessMessage, setBusinessStore, setBusinessSettingsCache, clearBusinessSessions,
  validateBusinessSettings, matchFaq, isOrderRequest, isWithinHours, normalizeText, mergeBusinessSettings
} from '../services/businessMode.js';
import { formatBusinessSummary, nextSummaryDelayMs } from '../services/businessSummary.js';
import { handleBusinessRoute } from '../services/businessDashboard.js';

const CUSTOMER = '962700000001@s.whatsapp.net';
const OWNER = '962700000009@s.whatsapp.net';

function memoryStore() {
  const state = { contacts: new Map(), stats: {}, orders: [], seq: 1000 };
  return {
    state,
    async touchContact(jid, { now }) {
      const before = state.contacts.get(jid);
      state.contacts.set(jid, { ...(before || {}), lastSeenAt: now });
      return { isNew: !before, lastAutoReplyAt: before?.lastAutoReplyAt || null };
    },
    async markAutoReply(jid, now) { state.contacts.get(jid).lastAutoReplyAt = now; },
    async bumpStat(dateKey, field) { state.stats[field] = (state.stats[field] || 0) + 1; },
    async nextOrderRef() { return ++state.seq; },
    async createOrder(values) { state.orders.push(values); return values; }
  };
}
function fakeSock() {
  const sent = [];
  return { sent, sendMessage: async (jid, payload) => { sent.push({ jid, ...payload }); } };
}
const dm = (text, jid = CUSTOMER) => ({ key: { remoteJid: jid, fromMe: false }, pushName: 'Lina', message: { conversation: text } });
function setup(t, overrides = {}) {
  const store = memoryStore();
  setBusinessStore(store);
  setControlSnapshot([]);
  clearBusinessSessions();
  setBusinessSettingsCache({
    enabled: true, businessName: 'Sam Café', ownerJids: [OWNER],
    faq: [{ question: 'الأسعار', keywords: ['سعر', 'اسعار', 'price'], answer: 'قائمة الأسعار: قهوة 2 دينار', enabled: true },
      { question: 'الموقع', keywords: ['وين', 'موقع'], answer: 'نحن في عمّان يا {name}', enabled: true }],
    ...overrides
  });
  t.after(() => { setBusinessStore(null); setBusinessSettingsCache(null); clearBusinessSessions(); setControlSnapshot([]); });
  return store;
}

test('arabic text normalization and FAQ keyword matching', () => {
  assert.equal(normalizeText('الأسعارُ؟'), 'الاسعار');
  const faq = [{ keywords: ['سعر'], answer: 'a' }, { keywords: ['سعر القهوة'], answer: 'b' }, { keywords: ['موقع'], answer: 'c', enabled: false }];
  assert.equal(matchFaq(faq, 'كم السعر؟').answer, 'a');
  assert.equal(matchFaq(faq, 'كم سعر القهوة عندكم').answer, 'b');
  assert.equal(matchFaq(faq, 'وين الموقع'), null);
  assert.equal(matchFaq(faq, 'تسعيرة'), null);
});

test('order keywords only start an order in short messages', () => {
  const settings = mergeBusinessSettings({});
  assert.equal(isOrderRequest(settings, 'بدي أطلب'), true);
  assert.equal(isOrderRequest(settings, 'مرحبا'), false);
  assert.equal(isOrderRequest(settings, 'طلب'), true);
  assert.equal(isOrderRequest(settings, 'احجز لو سمحت'), true);
  assert.equal(isOrderRequest(settings, 'كم يستغرق توصيل الطلب عادة عندكم'), false);
});

test('working hours honour the time zone, days and overnight shifts', () => {
  const settings = mergeBusinessSettings({ timeZone: 'Asia/Amman', hours: { enabled: true, start: '09:00', end: '17:00', days: [0, 1, 2, 3, 4] } });
  assert.equal(isWithinHours(settings, new Date('2026-09-27T07:00:00Z')), true); // Sunday 10:00 Amman
  assert.equal(isWithinHours(settings, new Date('2026-09-27T15:30:00Z')), false); // Sunday 18:30
  assert.equal(isWithinHours(settings, new Date('2026-10-02T07:00:00Z')), false); // Friday
  const night = mergeBusinessSettings({ timeZone: 'UTC', hours: { enabled: true, start: '18:00', end: '02:00', days: [5] } });
  assert.equal(isWithinHours(night, new Date('2026-10-02T19:00:00Z')), true); // Friday evening
  assert.equal(isWithinHours(night, new Date('2026-10-03T01:00:00Z')), true); // Saturday early = Friday shift
  assert.equal(isWithinHours(night, new Date('2026-10-03T19:00:00Z')), false);
});

test('settings validation normalizes owners and rejects bad input', () => {
  const values = validateBusinessSettings({ enabled: true, ownerJids: '+962 79 000 0000، 123456789@lid', faq: [{ keywords: 'سعر, price', answer: 'x' }], orders: { keywords: 'طلب', questions: ['ماذا تريد؟', ' '] }, summary: { time: '08:30' } });
  assert.deepEqual(values.ownerJids, ['962790000000@s.whatsapp.net', '123456789@lid']);
  assert.deepEqual(values.faq[0].keywords, ['سعر', 'price']);
  assert.deepEqual(values.orders.questions, ['ماذا تريد؟']);
  assert.throws(() => validateBusinessSettings({ ownerJids: 'abc' }), /المالك/);
  assert.throws(() => validateBusinessSettings({ summary: { time: '25:00' } }), /الملخص/);
  assert.throws(() => validateBusinessSettings({ timeZone: 'Mars/Base' }), /الزمنية/);
  assert.throws(() => validateBusinessSettings({ faq: [{ keywords: 'x' }] }), /جوابًا/);
});

test('groups, commands, owners and disabled mode pass through untouched', async t => {
  setup(t);
  const sock = fakeSock();
  assert.equal(await handleBusinessMessage(sock, dm('سعر', '1203630@g.us'), 'سعر'), false);
  assert.equal(await handleBusinessMessage(sock, dm('/اوامر'), '/اوامر'), false);
  assert.equal(await handleBusinessMessage(sock, dm('سعر', OWNER), 'سعر'), false);
  setControlSnapshot([{ key: 'business', enabled: false }]);
  assert.equal(await handleBusinessMessage(sock, dm('سعر'), 'سعر'), false);
  setControlSnapshot([]);
  setBusinessSettingsCache({ enabled: false });
  assert.equal(await handleBusinessMessage(sock, dm('سعر'), 'سعر'), false);
  assert.equal(sock.sent.length, 0);
});

test('FAQ answers and a single greeting per cooldown', async t => {
  const store = setup(t);
  const sock = fakeSock();
  const now = Date.parse('2026-09-30T10:00:00Z');
  assert.equal(await handleBusinessMessage(sock, dm('مرحبا'), 'مرحبا', now), true);
  assert.match(sock.sent[0].text, /Sam Café/);
  assert.equal(await handleBusinessMessage(sock, dm('كيفك'), 'كيفك', now + 60000), false);
  assert.equal(await handleBusinessMessage(sock, dm('وين موقعكم؟'), 'وين موقعكم؟', now + 120000), true);
  assert.equal(sock.sent.at(-1).text, 'نحن في عمّان يا Lina');
  assert.equal(store.state.stats.faqHits, 1);
  assert.equal(store.state.stats.newContacts, 1);
  assert.equal(store.state.stats.messages, 3);
});

test('order flow asks each question, saves the order and notifies the owner', async t => {
  const store = setup(t, { orders: { questions: ['ماذا تطلب؟', 'متى؟'] } });
  const sock = fakeSock();
  await handleBusinessMessage(sock, dm('طلب'), 'طلب');
  assert.match(sock.sent[0].text, /ماذا تطلب/);
  await handleBusinessMessage(sock, dm('كيكة شوكولاتة'), 'كيكة شوكولاتة');
  assert.equal(sock.sent[1].text, 'متى؟');
  await handleBusinessMessage(sock, dm('الخميس 5 مساء'), 'الخميس 5 مساء');
  assert.equal(store.state.orders.length, 1);
  const order = store.state.orders[0];
  assert.equal(order.ref, 1001);
  assert.deepEqual(order.answers.map(a => a.answer), ['كيكة شوكولاتة', 'الخميس 5 مساء']);
  assert.equal(order.customerPhone, '962700000001');
  assert.match(sock.sent[2].text, /#1001/);
  assert.equal(sock.sent[3].jid, OWNER);
  assert.match(sock.sent[3].text, /كيكة شوكولاتة/);
});

test('customers can cancel an order in progress', async t => {
  const store = setup(t);
  const sock = fakeSock();
  await handleBusinessMessage(sock, dm('حجز'), 'حجز');
  await handleBusinessMessage(sock, dm('إلغاء'), 'إلغاء');
  assert.match(sock.sent[1].text, /إلغاء/);
  assert.equal(store.state.orders.length, 0);
  assert.equal(await handleBusinessMessage(sock, dm('سعر'), 'سعر'), true);
  assert.match(sock.sent[2].text, /قائمة الأسعار/);
});

test('daily summary text and schedule delay', () => {
  const settings = mergeBusinessSettings({ businessName: 'Sam Café', timeZone: 'UTC', summary: { enabled: true, time: '21:00' } });
  const text = formatBusinessSummary(settings, { dateKey: '2026-09-30', stat: { messages: 12, newContacts: 3, faqHits: 5 }, orders: [{ ref: 1001, customerName: 'Lina', status: 'new', answers: [{ answer: 'كيكة' }] }], openCount: 1 });
  assert.match(text, /Sam Café/);
  assert.match(text, /رسائل العملاء: 12/);
  assert.match(text, /#1001 • Lina • جديد/);
  assert.match(text, /بانتظار المتابعة: 1/);
  assert.equal(nextSummaryDelayMs(settings, new Date('2026-09-30T20:00:00Z')), 3605000);
  assert.equal(nextSummaryDelayMs(settings, new Date('2026-09-30T21:00:00Z')), 24 * 3600000 + 5000);
});

test('dashboard business routes ignore other routes and validate order status', async () => {
  assert.equal(await handleBusinessRoute('commands', 'GET', {}, null), null);
  await assert.rejects(handleBusinessRoute('business/orders/0123456789abcdef01234567', 'PUT', { status: 'lost' }, null), /حالة الطلب/);
  await assert.rejects(handleBusinessRoute('business/summary', 'POST', {}, null, { getSock: () => null }), /غير متصل/);
});
