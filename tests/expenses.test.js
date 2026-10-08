import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import Expense from '../database/expenseModel.js';
import { extractExpenses, handleExpenseCommand, handleNaturalExpense, matchNaturalExpense, parseAIExpenses, parseExpense } from '../utils/expenses.js';

const NO_AI = { extractOptions: { aiAvailable: () => false } };
import { sanitizeAssistantCommand } from '../utils/samCapabilities.js';
import { getRateToJOD, resetExchangeRateCache } from '../services/exchangeRates.js';
import { convertToJOD, migrateForeignExpenses } from '../utils/expenses.js';

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
  assert.match(sock.sent.at(-1).text, /14\.18 دينار \(20 دولار\) على كلود/);
  assert.match(sock.sent.at(-1).text, /مجموع هالشهر: 31\.18 دينار/);
  await handleExpenseCommand(sock, USER, USER, '/حذف_مصروف 1', { now: NOW, ...NO_AI });
  await handleExpenseCommand(sock, USER, USER, '/حذف_مصروف 1', { now: NOW, ...NO_AI });

  await handleExpenseCommand(sock, USER, USER, '/مصاريفي', { now: NOW, ...NO_AI });
  const list = sock.sent.at(-1).text;
  assert.match(list, /المجموع: \*15 دينار\*/);
  assert.match(list, /1\. 10 دينار · بنزين/);
  // كل سطر بيبلش بعلامة RLM عشان يطلع من اليمين لليسار
  assert.ok(list.split('\n').filter(Boolean).every((line) => line.startsWith('\u200F')));

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

test('several /مصروف in one command and "سجل مصروف" phrasing are split into separate expenses', async (t) => {
  const docs = fakeExpenses(t);
  const sock = fakeSock();
  const ai = async ({ parts }) => {
    assert.equal(parts[0].text, '20$ كلود و 22.5 انترنت');
    return '{"items":[{"amount":20,"currency":"USD","label":"كلود"},{"amount":22.5,"currency":"JOD","label":"انترنت"}]}';
  };
  const extractOptions = { ai, aiAvailable: () => true, quota: async () => ({ allowed: true }) };
  await handleExpenseCommand(sock, USER, USER, '/مصروف 20$ كلود /مصروف 22.5 انترنت', { now: NOW, extractOptions });
  assert.deepEqual(docs.map(d => [d.amount, d.currency, d.label, d.originalAmount, d.originalCurrency]), [[14.18, null, 'كلود', 20, 'دولار'], [22.5, null, 'انترنت', null, null]]);

  // بدون ذكاء اصطناعي الكود بيقسمها برضو
  assert.deepEqual(parseExpense('20$ كلود /مصروف 22.5 انترنت'), { amount: 20, label: 'كلود', currency: 'دولار' });
  assert.deepEqual(matchNaturalExpense('سجل مصروف 3 فطور و 2 قهوة').map(i => i.amount), [3, 2]);
});

test('foreign currencies are converted to dinar at the exchange rate', async (t) => {
  resetExchangeRateCache();
  t.mock.method(console, 'warn', () => {});
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => ({ result: 'success', rates: { JOD: 1, EUR: 1.25, SAR: 5.29 } }) }; };
  // الدولار ثابت بدون إنترنت
  assert.deepEqual(await getRateToJOD('USD', { fetchImpl }), { rate: 0.709, live: true });
  assert.equal(calls, 0);
  assert.equal((await getRateToJOD('EUR', { fetchImpl })).rate, 0.8);
  await getRateToJOD('SAR', { fetchImpl });
  assert.equal(calls, 1); // كاش

  const euro = await convertToJOD({ amount: 10, label: 'كتاب', currency: 'يورو' }, { fetchImpl });
  assert.deepEqual(euro, { amount: 8, label: 'كتاب', currency: null, originalAmount: 10, originalCurrency: 'يورو' });

  // المصدر واقف: سعر تقريبي، وعملة مش معروفة بتضل زي ما هي
  resetExchangeRateCache();
  const down = async () => { throw new Error('offline'); };
  assert.deepEqual(await getRateToJOD('AED', { fetchImpl: down }), { rate: 0.193, live: false });
  assert.deepEqual(await convertToJOD({ amount: 3, label: 'x', currency: 'XYZ' }, { fetchImpl: down }), { amount: 3, label: 'x', currency: 'XYZ' });
  resetExchangeRateCache();
});

test('old foreign-currency expenses are converted once at startup', async () => {
  resetExchangeRateCache();
  const fetchImpl = async () => ({ ok: true, json: async () => ({ result: 'success', rates: { JOD: 1 } }) });
  const docs = [
    { _id: '1', amount: 20, currency: 'دولار', originalAmount: null },
    { _id: '2', amount: 5, currency: 'XYZ', originalAmount: null }
  ];
  const updates = [];
  const model = {
    find: () => ({ lean: async () => docs }),
    updateOne: async (filter, update) => { updates.push([filter._id, update.$set]); }
  };
  const first = await migrateForeignExpenses({ model, rateOptions: { fetchImpl } });
  assert.deepEqual(first, { converted: 1, skipped: 1 });
  assert.deepEqual(updates, [['1', { amount: 14.18, currency: null, originalAmount: 20, originalCurrency: 'دولار' }]]);

  // بعد التحويل ما بترجع تتحول
  const done = { find: () => ({ lean: async () => [] }), updateOne: async () => { throw new Error('should not run'); } };
  assert.deepEqual(await migrateForeignExpenses({ model: done, rateOptions: { fetchImpl } }), { converted: 0, skipped: 0 });
  resetExchangeRateCache();
});

test('/تصدير_مصاريف sends a formatted Excel file with a total row', async (t) => {
  const items = [
    { amount: 14.18, currency: null, label: 'كلود', originalAmount: 20, originalCurrency: 'دولار', spentAt: new Date('2026-10-02T09:30:00Z') },
    { amount: 3, currency: null, label: 'قهوة', originalAmount: null, originalCurrency: null, spentAt: new Date('2026-10-01T06:00:00Z') },
    { amount: 2, currency: null, label: 'قهوة', originalAmount: null, originalCurrency: null, spentAt: new Date('2026-10-03T06:00:00Z') }
  ];
  let query;
  t.mock.method(Expense, 'find', (q) => { query = q; return { sort: () => ({ lean: async () => items }) }; });
  const sock = fakeSock();
  await handleExpenseCommand(sock, USER, USER, '/تصدير_مصاريف الكل', { now: NOW });
  assert.equal(query.spentAt.$gte.getTime(), 0);
  const sent = sock.sent.at(-1);
  assert.match(sent.mimetype, /spreadsheetml/);
  assert.match(sent.fileName, /^مصاريف-\d{4}-\d{2}-\d{2}\.xlsx$/);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(sent.document);
  const sheet = workbook.getWorksheet('المصاريف');
  assert.equal(sheet.views[0].rightToLeft, true);
  assert.equal(sheet.getCell('A2').value, 'التاريخ');
  // الأقدم أول، والوقت بتوقيت عمّان
  assert.equal(sheet.getCell('C3').value, 'قهوة');
  assert.equal(sheet.getCell('B3').value.toISOString(), '2026-10-01T09:00:00.000Z');
  assert.equal(sheet.getCell('D4').value, 14.18);
  assert.equal(sheet.getCell('F4').value, 20);
  assert.equal(sheet.getCell('A6').value, 'المجموع');
  assert.equal(sheet.getCell('D6').value.formula, 'SUM(D3:D5)');
  assert.equal(sheet.getCell('D6').value.result, 19.18);

  const summary = workbook.getWorksheet('حسب التصنيف');
  assert.deepEqual([summary.getCell('A3').value, summary.getCell('B3').value, summary.getCell('C3').value], ['كلود', 14.18, 1]);
  assert.deepEqual([summary.getCell('A4').value, summary.getCell('B4').value, summary.getCell('C4').value], ['قهوة', 5, 2]);
  assert.equal(sanitizeAssistantCommand('/تصدير_مصاريف'), '/تصدير_مصاريف');
});
