import test from 'node:test';
import assert from 'node:assert/strict';
import Expense from '../database/expenseModel.js';
import { handleExpenseCommand, handleNaturalExpense, matchNaturalExpense, parseExpense } from '../utils/expenses.js';
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
  assert.deepEqual(parseExpense('5 دنانير على قهوة'), { amount: 5, label: 'قهوة' });
  assert.deepEqual(parseExpense('فاتورة الكهربا ٣٠'), { amount: 30, label: 'فاتورة الكهربا' });
  assert.deepEqual(parseExpense('2.5 JD بنزين'), { amount: 2.5, label: 'بنزين' });
  assert.equal(parseExpense('قهوة'), null);
});

test('natural spending messages are expenses, not notes', () => {
  assert.deepEqual(matchNaturalExpense('صرفت 5 دنانير على قهوة'), { amount: 5, label: 'قهوة' });
  assert.deepEqual(matchNaturalExpense('دفعت 30 فاتورة كهربا'), { amount: 30, label: 'فاتورة كهربا' });
  assert.equal(matchNaturalExpense('صرفت كثير اليوم'), null);
  assert.equal(matchNaturalExpense('شو صار معك'), null);
  assert.equal(sanitizeAssistantCommand('/مصروف 5 قهوة'), '/مصروف 5 قهوة');
});

test('/مصروف adds, /مصاريفي totals and /حذف_مصروف removes', async (t) => {
  const docs = fakeExpenses(t);
  const sock = fakeSock();
  assert.equal(await handleExpenseCommand(sock, USER, USER, '/مصروف 5 قهوة', { now: NOW }), true);
  assert.equal(await handleNaturalExpense(sock, USER, USER, 'صرفت 10 على بنزين', { now: new Date(NOW.getTime() + 1000) }), true);
  assert.equal(docs.length, 2);
  assert.match(sock.sent[1].text, /مجموع هالشهر: 15 دينار/);

  await handleExpenseCommand(sock, USER, USER, '/مصاريفي', { now: NOW });
  const list = sock.sent.at(-1).text;
  assert.match(list, /المجموع: \*15 دينار\*/);
  assert.match(list, /1\. 10 دينار · بنزين/);

  await handleExpenseCommand(sock, USER, USER, '/حذف_مصروف 1', { now: NOW });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].label, 'قهوة');
});

test('expense commands in a group answer privately and natural text is ignored there', async (t) => {
  fakeExpenses(t);
  const sock = fakeSock();
  assert.equal(await handleNaturalExpense(sock, 'g@g.us', USER, 'صرفت 5 على قهوة', { now: NOW }), false);
  await handleExpenseCommand(sock, 'g@g.us', USER, '/مصاريفي', { now: NOW });
  assert.equal(sock.sent[0].jid, USER);
  assert.equal(sock.sent[1].jid, 'g@g.us');
});
