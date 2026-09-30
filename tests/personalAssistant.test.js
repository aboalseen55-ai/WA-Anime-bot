import test from 'node:test';
import assert from 'node:assert/strict';
import PersonalItem from '../database/personalItemModel.js';
import { setControlSnapshot } from '../services/botControls.js';
import {
  parseReminderRequest, matchPersonalCommand, handlePersonalCommand, deliverDueReminders
} from '../utils/personalAssistant.js';

const TZ = 'Asia/Amman';
// 2026-10-01 14:00 in Amman (UTC+3)
const NOW = new Date('2026-10-01T11:00:00Z');

function matches(doc, query) {
  return Object.entries(query).every(([key, cond]) => {
    const value = doc[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$in' in cond) return cond.$in.includes(value);
      if ('$lte' in cond) return value <= cond.$lte;
    }
    return String(value) === String(cond);
  });
}

function fakeStore(t) {
  const docs = [];
  let nextId = 1;
  const query = (rows) => {
    let result = rows;
    const chain = {
      sort(spec) { const [[key, dir]] = Object.entries(spec); result = [...result].sort((a, b) => (a[key] - b[key]) * dir); return chain; },
      limit(n) { result = result.slice(0, n); return chain; },
      lean: async () => result.map(row => ({ ...row }))
    };
    return chain;
  };
  const apply = (doc, update) => Object.assign(doc, update.$set || {});
  t.mock.method(PersonalItem, 'find', q => query(docs.filter(d => matches(d, q))));
  t.mock.method(PersonalItem, 'countDocuments', async q => docs.filter(d => matches(d, q)).length);
  t.mock.method(PersonalItem, 'create', async data => {
    const doc = { _id: nextId++, status: 'pending', attempts: 0, done: false, createdAt: new Date(Date.now() + nextId), ...data };
    docs.push(doc);
    return { ...doc };
  });
  t.mock.method(PersonalItem, 'deleteOne', async q => { const i = docs.findIndex(d => matches(d, q)); if (i >= 0) docs.splice(i, 1); });
  t.mock.method(PersonalItem, 'updateOne', async (q, u) => { const d = docs.find(x => matches(x, q)); if (d) apply(d, u); });
  t.mock.method(PersonalItem, 'findOneAndUpdate', (q, u) => ({ lean: async () => { const d = docs.find(x => matches(x, q)); if (!d) return null; apply(d, u); return { ...d }; } }));
  return docs;
}

function fakeSock() {
  const sent = [];
  return { sent, sendMessage: async (jid, payload) => { sent.push({ jid, ...payload }); } };
}

test('relative reminders understand Arabic durations', () => {
  const r = parseReminderRequest('بعد 10 دقائق أطفئ الفرن', { now: NOW, timeZone: TZ });
  assert.equal(r.dueAt.getTime(), NOW.getTime() + 10 * 60000);
  assert.equal(r.message, 'أطفئ الفرن');

  assert.equal(parseReminderRequest('بعد ساعة ونص اتصل', { now: NOW, timeZone: TZ }).dueAt.getTime(), NOW.getTime() + 90 * 60000);
  assert.equal(parseReminderRequest('بعد ساعتين و 15 دقيقة اتصل', { now: NOW, timeZone: TZ }).dueAt.getTime(), NOW.getTime() + 135 * 60000);
  assert.equal(parseReminderRequest('بعد ٥ د شاي', { now: NOW, timeZone: TZ }).dueAt.getTime(), NOW.getTime() + 5 * 60000);
});

test('clock times resolve in the bot time zone', () => {
  const evening = parseReminderRequest('الساعة 6 مساءً اتصل بأحمد', { now: NOW, timeZone: TZ });
  assert.equal(evening.dueAt.toISOString(), '2026-10-01T15:00:00.000Z');
  assert.equal(evening.message, 'اتصل بأحمد');

  // 14:00 now, "الساعة 6" without a period means this evening
  assert.equal(parseReminderRequest('الساعة 6 اجتماع', { now: NOW, timeZone: TZ }).dueAt.toISOString(), '2026-10-01T15:00:00.000Z');
  // morning time already passed today rolls to tomorrow
  assert.equal(parseReminderRequest('الساعة 9 صباحا دواء', { now: NOW, timeZone: TZ }).dueAt.toISOString(), '2026-10-02T06:00:00.000Z');
  assert.equal(parseReminderRequest('بكرة الساعة 9:30 اجتماع', { now: NOW, timeZone: TZ }).dueAt.toISOString(), '2026-10-02T06:30:00.000Z');
  assert.equal(parseReminderRequest('6pm call mom', { now: NOW, timeZone: TZ }).dueAt.toISOString(), '2026-10-01T15:00:00.000Z');
  assert.equal(parseReminderRequest('بكرة موعد الطبيب', { now: NOW, timeZone: TZ }).dueAt.toISOString(), '2026-10-02T06:00:00.000Z');
});

test('reminder parsing rejects missing time or text', () => {
  assert.equal(parseReminderRequest('اشتري 3 أشياء', { now: NOW, timeZone: TZ }).error, 'no_time');
  assert.equal(parseReminderRequest('الساعة 6 مساء', { now: NOW, timeZone: TZ }).error, 'no_text');
  assert.equal(parseReminderRequest('الساعة 25:00 شيء', { now: NOW, timeZone: TZ }).error, 'bad_time');
});

test('command matching accepts Arabic spelling variants and leaves other commands alone', () => {
  assert.deepEqual(matchPersonalCommand('/ذكّرني بعد ساعة شاي'), { action: 'addReminder', args: 'بعد ساعة شاي' });
  assert.deepEqual(matchPersonalCommand('/الغاء_تذكير 2'), { action: 'cancelReminder', args: '2' });
  assert.deepEqual(matchPersonalCommand('/إلغاء تذكير 2'), { action: 'cancelReminder', args: '2' });
  assert.equal(matchPersonalCommand('/مهمه شراء خبز').action, 'addTodo');
  assert.equal(matchPersonalCommand('/حذف_ملاحظة 1').action, 'deleteNote');
  assert.equal(matchPersonalCommand('/تذكير'), null);
  assert.equal(matchPersonalCommand('/تمام'), null);
  assert.equal(matchPersonalCommand('ذكرني بعد ساعة'), null);
});

test('reminders are stored per user and delivered once by DM', async t => {
  t.after(() => setControlSnapshot([]));
  const docs = fakeStore(t);
  const sock = fakeSock();
  const group = '123@g.us';
  const user = '962700000000@s.whatsapp.net';

  assert.equal(await handlePersonalCommand(sock, group, user, '/ذكرني بعد 5 دقائق أطفئ الفرن', { now: NOW }), true);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].userJid, user);
  assert.match(sock.sent[0].text, /سأذكرك/);

  assert.equal(await deliverDueReminders(sock, NOW), 0);
  const later = new Date(NOW.getTime() + 6 * 60000);
  assert.equal(await deliverDueReminders(sock, later), 1);
  assert.equal(await deliverDueReminders(sock, later), 0);
  const dm = sock.sent.at(-1);
  assert.equal(dm.jid, user);
  assert.match(dm.text, /أطفئ الفرن/);
  assert.equal(docs[0].status, 'sent');
});

test('failed deliveries retry and then stop', async t => {
  const docs = fakeStore(t);
  const sock = { sendMessage: async () => { throw new Error('offline'); } };
  await PersonalItem.create({ kind: 'reminder', userJid: 'u', text: 'x', dueAt: new Date(0) });
  for (let i = 0; i < 3; i += 1) {
    docs[0].dueAt = new Date(0);
    await deliverDueReminders(sock, NOW);
  }
  assert.equal(docs[0].status, 'failed');
  assert.equal(docs[0].attempts, 3);
});

test('to-dos and notes: add, list privately, complete and delete', async t => {
  const docs = fakeStore(t);
  const sock = fakeSock();
  const group = '123@g.us';
  const user = 'u@s.whatsapp.net';

  await handlePersonalCommand(sock, group, user, '/مهمة شراء خبز');
  await handlePersonalCommand(sock, group, user, '/مهمة دفع الفاتورة');
  await handlePersonalCommand(sock, group, 'other@s.whatsapp.net', '/مهمة مهمة غيري');
  await handlePersonalCommand(sock, group, user, '/تم 2');
  assert.equal(docs.find(d => d.text === 'دفع الفاتورة').done, true);

  sock.sent.length = 0;
  await handlePersonalCommand(sock, group, user, '/مهامي');
  assert.equal(sock.sent[0].jid, user);
  assert.match(sock.sent[0].text, /1 متبقية من 2/);
  assert.doesNotMatch(sock.sent[0].text, /غيري/);
  assert.equal(sock.sent[1].jid, group);

  await handlePersonalCommand(sock, group, user, '/حذف_مهمة 1');
  assert.equal(docs.filter(d => d.userJid === user).length, 1);

  await handlePersonalCommand(sock, user, user, '/ملاحظة رقم الطلب 4521');
  sock.sent.length = 0;
  await handlePersonalCommand(sock, user, user, '/ملاحظاتي');
  assert.equal(sock.sent.length, 1);
  assert.match(sock.sent[0].text, /رقم الطلب 4521/);

  sock.sent.length = 0;
  await handlePersonalCommand(sock, user, user, '/حذف_ملاحظة 9');
  assert.match(sock.sent[0].text, /رقم غير صحيح/);
});
