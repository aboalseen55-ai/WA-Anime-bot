import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerExpenseQuestion, computeExpenseAnswer, fallbackQueryPlan, handleExpenseQuestionCommand,
  handleNaturalExpenseQuestion, looksLikeExpenseQuestion, matchExpenseQuestionCommand, normalizeQueryPlan
} from '../utils/expenseInsights.js';

const USER = '962700000001@s.whatsapp.net';
const NOW = new Date('2026-10-20T09:00:00Z'); // 20 أكتوبر 12:00 بعمّان
const day = (d, label, amount) => ({ userJid: USER, label, amount, spentAt: new Date(`2026-${d}T10:00:00Z`) });
const ROWS = [
  day('10-02', 'بنزين', 20), day('10-09', 'بنزين', 15), day('10-15', 'قهوة', 2), day('10-16', 'قهوة', 2.5),
  day('10-17', 'قهوة', 2), day('10-18', 'بنزينه', 10), day('10-19', 'سوبرماركت', 40), day('09-12', 'بنزين', 25)
];

function fakeModel(rows = ROWS) {
  return {
    find: (q) => {
      const result = rows.filter((r) => r.userJid === q.userJid && (!q.spentAt || r.spentAt >= q.spentAt.$gte));
      const chain = { sort: () => chain, limit: () => chain, lean: async () => result };
      return chain;
    }
  };
}

const allow = async () => ({ allowed: true });

test('questions about expenses are told apart from logging one', () => {
  assert.equal(looksLikeExpenseQuestion('كم مجموع البنزين هذا الشهر', ['بنزين']), true);
  assert.equal(looksLikeExpenseQuestion('قديش صرفت هالاسبوع؟'), true);
  assert.equal(looksLikeExpenseQuestion('حلل مصاريفي ووين بقدر اوفر'), true);
  assert.equal(looksLikeExpenseQuestion('صرفت 5 على قهوة'), false);
  assert.equal(looksLikeExpenseQuestion('كم الساعة هلأ', ['بنزين']), false);
  assert.deepEqual(matchExpenseQuestionCommand('/حلل_مصاريف كم البنزين'), { question: 'كم البنزين' });
  assert.match(matchExpenseQuestionCommand('/حلل_مصاريف').question, /حلل/);
});

test('the AI query plan only keeps real labels and valid dates', () => {
  const plan = normalizeQueryPlan({ from: '2026-10-01', to: '2026-12-31', labels: ['بنزين', 'بنزينه', 'طيارة'], groupBy: 'x', analysis: false }, { todayKey: '2026-10-20', knownLabels: ['بنزين', 'بنزينه', 'قهوة'] });
  assert.deepEqual(plan, { aboutExpenses: true, from: '2026-10-01', to: '2026-10-20', labels: ['بنزين', 'بنزينه'], groupBy: 'none', compare: null, analysis: false });
  assert.deepEqual(normalizeQueryPlan({ about_expenses: false }, { todayKey: '2026-10-20', knownLabels: [] }), { aboutExpenses: false });
});

test('totals for one category are computed in code, not the whole month', () => {
  const data = computeExpenseAnswer(ROWS, { from: '2026-10-01', to: '2026-10-20', labels: ['بنزين', 'بنزينه'], groupBy: 'none', compare: { from: '2026-09-01', to: '2026-09-30' }, analysis: false });
  assert.equal(data.total, 45);
  assert.equal(data.count, 3);
  assert.equal(data.compare.total, 25);
  assert.equal(data.compare.difference, 20);
  const analysis = computeExpenseAnswer(ROWS, { from: '2026-10-01', to: '2026-10-20', labels: [], groupBy: 'label', compare: null, analysis: true });
  assert.equal(analysis.total, 91.5);
  assert.equal(analysis.byLabel[0].key, 'سوبرماركت');
  assert.deepEqual(analysis.frequent.map((e) => e.label), ['قهوة']);
});

test('the AI picks the labels, the code sums them, and the AI writes the answer from those numbers', async () => {
  const calls = [];
  const ai = async ({ systemInstruction, parts }) => {
    calls.push({ systemInstruction, text: parts[0].text });
    if (calls.length === 1) return JSON.stringify({ about_expenses: true, from: '2026-10-01', to: '2026-10-20', labels: ['بنزين', 'بنزينه'], groupBy: 'none', compare: null, analysis: false });
    return 'صرفت على البنزين هالشهر *45 دينار* (3 مرات).';
  };
  const result = await answerExpenseQuestion('كم مجموع البنزين هذا الشهر', USER, { now: NOW, model: fakeModel(), ai, aiAvailable: () => true, quota: allow });
  assert.equal(result.handled, true);
  assert.equal(result.data.total, 45);
  assert.match(calls[1].text, /"total":45/);
  assert.doesNotMatch(calls[1].systemInstruction, /financial analyst/);
  assert.match(result.text, /45 دينار/);
});

test('analysis requests get the financial analyst prompt', async () => {
  const calls = [];
  const ai = async ({ systemInstruction }) => {
    calls.push(systemInstruction);
    return calls.length === 1 ? JSON.stringify({ from: '2026-10-01', to: '2026-10-20', labels: [], groupBy: 'label', analysis: true }) : 'تحليل';
  };
  const result = await answerExpenseQuestion('حلل مصاريفي هالشهر ووين بقدر اوفر', USER, { now: NOW, model: fakeModel(), ai, aiAvailable: () => true, quota: allow });
  assert.equal(result.plan.analysis, true);
  assert.match(calls[1], /financial analyst/);
  assert.ok(result.data.previousPeriod);
});

test('without AI the answer still uses the matching label and period', async () => {
  const plan = fallbackQueryPlan('قديش صرفت على القهوة هالاسبوع', { todayKey: '2026-10-20', knownLabels: ['بنزين', 'قهوة'] });
  assert.deepEqual([plan.from, plan.to, plan.labels], ['2026-10-17', '2026-10-20', ['قهوة']]);
  const result = await answerExpenseQuestion('كم البنزين هالشهر', USER, { now: NOW, model: fakeModel(), aiAvailable: () => false });
  assert.match(result.text, /35 دينار/);
});

test('natural DM questions are answered, other chat falls through', async () => {
  const sent = [];
  const sock = { sendMessage: async (jid, payload) => sent.push({ jid, ...payload }) };
  const options = { now: NOW, model: fakeModel(), aiAvailable: () => false };
  assert.equal(await handleNaturalExpenseQuestion(sock, USER, USER, 'كم مجموع البنزين هذا الشهر', options), true);
  assert.match(sent[0].text, /بنزين/);
  assert.equal(await handleNaturalExpenseQuestion(sock, USER, USER, 'كم عمرك؟', options), false);
  assert.equal(await handleNaturalExpenseQuestion(sock, '123@g.us', USER, 'كم صرفت هالشهر', options), false);
  assert.equal(await handleExpenseQuestionCommand(sock, '123@g.us', USER, '/حلل_مصاريف كم البنزين', options), true);
  assert.equal(sent.at(-2).jid, USER);
  assert.match(sent.at(-1).text, /الخاص/);
});
