import test from 'node:test';
import assert from 'node:assert/strict';
import Expense from '../database/expenseModel.js';
import { extractExpenses, handleExpenseCommand, handleNaturalExpense, matchNaturalExpense, parseAIExpenses, parseExpense } from '../utils/expenses.js';

const NO_AI = { extractOptions: { aiAvailable: () => false } };
import { sanitizeAssistantCommand } from '../utils/samCapabilities.js';

const USER = '962700000001@s.whatsapp.net';
const NOW = new Date('2026-10-06T09:00:00Z'); // الثلاثاء 12:00 بعمّان

function fakeSock() {
  const sent = [];
  return { sent, sendMessage: async (jid, payload) => { sent.push({ jid, ...payload }); } };
}

function fakeExpenses(t) {
  const docs = [];
  t.mock.method(Expense, 'create', async (doc) => { const d = { _id: String(docs.length + 1), ...doc }; docs.push(d); return d; });
  t.mock.method(Expense, 'aggregate', async ([{ $match }]) => {
    const total = docs.filter(d => d.userJid === $match.userJid && d.spentAt >= $match.spentAt.$gte).reduce((s, d) => s + d.amount, 0);
    return total ? [{ _id: null, total }] : [];
  });
  t.mock.method(Expense, 'find', (q) => {
    const rows = docs.filter(d => d.userJid === q.userJid && d.spentAt >= q.spentAt.$gte).sort((a, b) => b.spentAt - a.spentAt);
    const chain = { sort: () => chain, limit: (n) => { rows.splice(n); return chain; }, lean: async () => rows };
    return chain;
  });
  t.mock.method(Expense, 'deleteOne', async (q) => { const i = docs.findIndex(d => d._id === q._id); if (i >= 0) docs.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; });
  return docs;
}

test('parseExpense reads amount, Arabic digits and the label', () => {
  assert.deepEqual(parseExpense('5 دنانير على قهوة'), { amount: 5, label: 'قهوة', currency: null });
  assert.deepEqual(parseExpense('فاتورة الكهربا ٣٠'), { amount: 30, label: 'فاتورة الكهربا', currency: null });
  assert.deepEqual(parseExpense('2.5 JD بنزين'), { amount: 2.5, label: 'بنزين', currency: null });
  assert.deepEqual(parseExpense('وجبة 4'), { amount: 4, label: 'وجبة', currency: null });
  assert.equal(parseExpense('قهوة'), null);
});

test('natural spending messages are expenses, not notes', () => {
  assert.deepEqual(matchNaturalExpense('صرفت 5 دنانير على قهوة'), [{ amount: 5, label: 'قهوة', currency: null }]);
  assert.deepEqual(matchNaturalExpense('دفعت 30 فاتورة كهربا'), [{ amount: 30, label: 'فاتورة كهربا', currency: null }]);
  assert.deepEqual(matchNaturalExpense('صرفت 4 على وجبة'), [{ amount: 4, label: 'وجبة', currency: null }]);
  assert.equal(matchNaturalExpense('صرفت كثير اليوم'), null);
  assert.equal(matchNaturalExpense('شو صار معك'), null);
  assert.equal(sanitizeAssistantCommand('/مصروف 5 قهوة'), '/مصروف 5 قهوة');
});

test('one message with several amounts and currencies becomes several expenses', () => {
  assert.deepEqual(matchNaturalExpense('صرفت 5 ستيم و 20$ كلود لسيدرا ودفعت النت 22.5'), [
    { amount: 5, label: 'ستيم', currency: null },
    { amount: 20, label: 'كلود لسيدرا', currency: 'دولار' },
    { amount: 22.5, label: 'النت', currency: null }
  ]);
  assert.deepEqual(matchNaturalExpense('صرفت ستيم وكلود 25'), [{ amount: 25, label: 'ستيم وكلود', currency: null }]);
  assert.deepEqual(matchNaturalExpense('دفعت $15 نتفلكس و 3 قهوة'), [
    { amount: 15, label: 'نتفلكس', currency: 'دولار' },
    { amount: 3, label: 'قهوة', currency: null }
  ]);
});

test('/مصروف adds, /مصاريفي totals and /حذف_مصروف removes', async (t) => {
  const docs = fakeExpenses(t);
  const sock = fakeSock();
  assert.equal(await handleExpenseCommand(sock, USER, USER, '/مصروف 5 قهوة', { now: NOW, ...NO_AI }), true);
  assert.equal(await handleNaturalExpense(sock, USER, USER, 'صرفت 10 على بنزين', { now: new Date(NOW.getTime() + 1000), ...NO_AI }), true);
  assert.equal(docs.length, 2);
  assert.match(sock.sent[1].text, /مجموع هالشهر: 15 دينار/);
  await handleNaturalExpense(sock, USER, USER, 'دفعت 20$ كلود و 2 قهوة', { now: new Date(NOW.getTime() + 2000), ...NO_AI });
  assert.match(sock.sent.at(-1).text, /سجلت 2 مصاريف/);
  assert.match(sock.sent.at(-1).text, /17 دينار \+ 20 دولار/);
  await handleExpenseCommand(sock, USER, USER, '/حذف_مصروف 1', { now: NOW, ...NO_AI });
  await handleExpenseCommand(sock, USER, USER, '/حذف_مصروف 1', { now: NOW, ...NO_AI });

  await handleExpenseCommand(sock, USER, USER, '/مصاريفي', { now: NOW, ...NO_AI });
  const list = sock.sent.at(-1).text;
  assert.match(list, /المجموع: \*15 دينار\*/);
  assert.match(list, /1\. 10 دينار · بنزين/);

  await handleExpenseCommand(sock, USER, USER, '/حذف_مصروف 1', { now: NOW, ...NO_AI });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].label, 'قهوة');
});

test('expense commands in a group answer privately and natural text is ignored there', async (t) => {
  fakeExpenses(t);
  const sock = fakeSock();
  assert.equal(await handleNaturalExpense(sock, 'g@g.us', USER, 'صرفت 5 على قهوة', { now: NOW, ...NO_AI }), false);
  await handleExpenseCommand(sock, 'g@g.us', USER, '/مصاريفي', { now: NOW, ...NO_AI });
  assert.equal(sock.sent[0].jid, USER);
  assert.equal(sock.sent[1].jid, 'g@g.us');
});

test('the AI splits the message and the code validates what it returns', async () => {
  const raw = JSON.stringify({ items: [
    { amount: 5, currency: 'JOD', label: 'ستيم' },
    { amount: 20, currency: 'USD', label: 'كلود لسيدرا' },
    { amount: '22.5', currency: 'JOD', label: 'النت' },
    { amount: -3, currency: 'JOD', label: 'غلط' }
  ] });
  assert.deepEqual(parseAIExpenses(raw), [
    { amount: 5, label: 'ستيم', currency: null },
    { amount: 20, label: 'كلود لسيدرا', currency: 'دولار' },
    { amount: 22.5, label: 'النت', currency: null }
  ]);
  assert.equal(parseAIExpenses('not json'), null);

  let prompt = null;
  const ai = async ({ parts }) => { prompt = parts[0].text; return '{"items":[{"amount":5,"currency":"JOD","label":"قهوة"}]}'; };
  const quota = async () => ({ allowed: true });
  const fromAI = await extractExpenses('صرفت خمسة دنانير على قهوة', USER, { ai, aiAvailable: () => true, quota });
  assert.equal(fromAI.source, 'ai');
  assert.equal(prompt, 'صرفت خمسة دنانير على قهوة');
  assert.deepEqual(fromAI.items, [{ amount: 5, label: 'قهوة', currency: null }]);

  // الذكاء الاصطناعي فشل أو الحد خلص: الكود بيقسم لحاله
  const broken = await extractExpenses('صرفت 5 ستيم و 20$ كلود', USER, { ai: async () => '', aiAvailable: () => true, quota });
  assert.equal(broken.source, 'code');
  assert.equal(broken.items.length, 2);
  const noQuota = await extractExpenses('صرفت 5 قهوة', USER, { ai, aiAvailable: () => true, quota: async () => ({ allowed: false }) });
  assert.equal(noQuota.source, 'code');
});
