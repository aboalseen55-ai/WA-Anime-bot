import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTasksToPlan, handleDailyPlanCommand, handleDailyPlanReply, handleNaturalDailyPlan, matchDailyPlanCommand,
  nextPlanMessage, parseAIPlan, parsePlanText, planDateKey, runDailyPlanTick
} from '../utils/dailyPlan.js';

const USER = '962700000001@s.whatsapp.net';
const at = (iso) => new Date(iso);
// عمّان UTC+3: 06:00Z = 9 الصبح
const MORNING = at('2026-10-20T06:00:00Z');
const NO_AI = { aiAvailable: () => false };

function fakeModel() {
  const docs = [];
  const setPath = (doc, path, value) => {
    const keys = path.split('.');
    let target = doc;
    while (keys.length > 1) target = target[keys.shift()];
    target[keys[0]] = value;
  };
  const clone = (doc) => structuredClone(doc);
  return {
    docs,
    findOne: (q) => ({ lean: async () => { const d = docs.find((x) => x.userJid === q.userJid && x.dateKey === q.dateKey); return d ? clone(d) : null; } }),
    find: (q) => { const chain = { limit: () => chain, lean: async () => docs.filter((x) => x.dateKey === q.dateKey).map(clone) }; return chain; },
    create: async (data) => { const doc = { _id: String(docs.length + 1), awaiting: { kind: null, index: null, at: null }, ...clone(data) }; docs.push(doc); return clone(doc); },
    updateOne: async ({ _id }, { $set }) => { const doc = docs.find((x) => x._id === _id); for (const [k, v] of Object.entries($set)) setPath(doc, k, clone(v)); return { modifiedCount: 1 }; },
    deleteOne: async ({ _id }) => { const i = docs.findIndex((x) => x._id === _id); if (i >= 0) docs.splice(i, 1); }
  };
}

function fakeSock() {
  const sent = [];
  return { sent, sendMessage: async (jid, payload) => { sent.push({ jid, ...payload }); } };
}

test('plan text without AI splits tasks and reads their times', () => {
  const parsed = parsePlanText('بكرة بدي اروح عالبنك الساعة 10 الصبح، اخلص التقرير، اتصل باحمد الساعة 4');
  assert.equal(parsed.dayOffset, 1);
  assert.deepEqual(parsed.tasks, [
    { text: 'اروح عالبنك', clock: { hour: 10, minute: 0 } },
    { text: 'اخلص التقرير', clock: null },
    { text: 'اتصل باحمد', clock: { hour: 16, minute: 0 } }
  ]);
  assert.deepEqual(parseAIPlan('{"is_plan":true,"day":"tomorrow","tasks":[{"text":"بنك","time":"10:30"},{"text":"تقرير","time":null}]}'), {
    isPlan: true, dayOffset: 1, tasks: [{ text: 'بنك', clock: { hour: 10, minute: 30 } }, { text: 'تقرير', clock: null }]
  });
  assert.equal(matchDailyPlanCommand('/خطة_بكرة بنك').action, 'addTomorrow');
  assert.equal(matchDailyPlanCommand('/خطتي').action, 'show');
});

test('/خطة saves a sorted plan and the tick reminds at the task time, then follows up', async () => {
  const model = fakeModel();
  const sock = fakeSock();
  await handleDailyPlanCommand(sock, USER, USER, '/خطة اخلص التقرير، اروح عالبنك الساعة 10 الصبح', { now: MORNING, model, extractOptions: NO_AI });
  assert.match(sock.sent[0].text, /خطتك اليوم/);
  const plan = model.docs[0];
  assert.equal(plan.dateKey, '2026-10-20');
  assert.equal(plan.tasks[0].text, 'اروح عالبنك');
  assert.equal(plan.tasks[1].time, null);

  assert.equal(await runDailyPlanTick(sock, at('2026-10-20T06:30:00Z'), { model }), 0);
  assert.equal(await runDailyPlanTick(sock, at('2026-10-20T07:00:30Z'), { model }), 1);
  assert.match(sock.sent.at(-1).text, /هلأ وقت: \*اروح عالبنك\*/);
  assert.equal(model.docs[0].awaiting.kind, 'task');
  assert.equal(await runDailyPlanTick(sock, at('2026-10-20T07:01:00Z'), { model }), 0);
  assert.equal(await runDailyPlanTick(sock, at('2026-10-20T08:01:00Z'), { model }), 1);
  assert.match(sock.sent.at(-1).text, /شو صار مع/);
});

test('"خلصت" marks the asked task and says what is next; "لسا" snoozes it', async () => {
  const model = fakeModel();
  const sock = fakeSock();
  await addTasksToPlan(USER, 0, [{ text: 'بنك', clock: { hour: 10, minute: 0 } }, { text: 'تقرير', clock: { hour: 11, minute: 0 } }, { text: 'رياضة', clock: null }], { now: MORNING, model });
  await runDailyPlanTick(sock, at('2026-10-20T07:00:00Z'), { model });

  assert.equal(await handleDailyPlanReply(sock, USER, USER, 'لسا ساعة', { now: at('2026-10-20T07:05:00Z'), model }), true);
  assert.match(sock.sent.at(-1).text, /برجع بذكرك/);
  assert.equal(await runDailyPlanTick(sock, at('2026-10-20T07:30:00Z'), { model }), 0);
  assert.equal(await runDailyPlanTick(sock, at('2026-10-20T08:06:00Z'), { model }), 1);
  assert.match(sock.sent.at(-1).text, /بنك/);

  assert.equal(await handleDailyPlanReply(sock, USER, USER, 'خلصت', { now: at('2026-10-20T08:10:00Z'), model }), true);
  assert.match(sock.sent.at(-1).text, /خلصت: بنك/);
  assert.match(sock.sent.at(-1).text, /الجاي: .*تقرير/);
  assert.equal(model.docs[0].tasks[0].done, true);

  assert.equal(await handleDailyPlanReply(sock, USER, USER, 'خلصت 3', { now: at('2026-10-20T08:20:00Z'), model }), true);
  assert.equal(model.docs[0].tasks[2].done, true);
  // "خلص" بدون أي سؤال مفتوح أو مهمة فات وقتها: مش للخطة
  const other = fakeModel();
  await addTasksToPlan(USER, 0, [{ text: 'تقرير', clock: null }, { text: 'بنك', clock: null }], { now: MORNING, model: other });
  assert.equal(await handleDailyPlanReply(sock, USER, USER, 'خلص', { now: MORNING, model: other }), false);
});

test('midday nudge lists what is left, evening wrap offers to move it to tomorrow', async () => {
  const model = fakeModel();
  const sock = fakeSock();
  await addTasksToPlan(USER, 0, [{ text: 'تقرير', clock: null }, { text: 'رياضة', clock: null }], { now: MORNING, model });
  assert.equal(await runDailyPlanTick(sock, at('2026-10-20T10:00:30Z'), { model }), 1); // 13:00
  assert.match(sock.sent.at(-1).text, /صرنا بنص اليوم/);
  assert.equal(await runDailyPlanTick(sock, at('2026-10-20T10:01:00Z'), { model }), 0);
  await handleDailyPlanReply(sock, USER, USER, 'خلصت 1', { now: at('2026-10-20T12:00:00Z'), model });
  assert.equal(await runDailyPlanTick(sock, at('2026-10-20T18:00:30Z'), { model }), 1); // 21:00
  assert.match(sock.sent.at(-1).text, /انقل/);
  assert.equal(await handleDailyPlanReply(sock, USER, USER, 'انقل', { now: at('2026-10-20T18:05:00Z'), model }), true);
  const tomorrow = model.docs.find((d) => d.dateKey === '2026-10-21');
  assert.deepEqual(tomorrow.tasks.map((t) => t.text), ['رياضة']);
  assert.deepEqual(model.docs.find((d) => d.dateKey === '2026-10-20').tasks.map((t) => t.text), ['تقرير']);
  // صباح بكرة بتوصله خطته
  assert.equal(await runDailyPlanTick(sock, at('2026-10-21T05:00:30Z'), { model }), 1);
  assert.match(sock.sent.at(-1).text, /صباح الخير/);
});

test('natural "بكرة بدي..." becomes a plan; casual chat does not', async () => {
  const model = fakeModel();
  const sock = fakeSock();
  const ai = async () => JSON.stringify({ is_plan: true, day: 'tomorrow', tasks: [{ text: 'أروح عالبنك', time: '10:00' }, { text: 'أخلص التقرير', time: null }] });
  const options = { now: MORNING, model, extractOptions: { ai, aiAvailable: () => true, quota: async () => ({ allowed: true }) } };
  assert.equal(await handleNaturalDailyPlan(sock, USER, USER, 'بكرة بدي اروح عالبنك الساعة 10 واخلص التقرير', options), true);
  assert.equal(model.docs[0].dateKey, planDateKey(MORNING, 1));
  assert.match(sock.sent[0].text, /خطتك بكرة/);
  assert.equal(await handleNaturalDailyPlan(sock, USER, USER, 'بدي اسألك سؤال', { now: MORNING, model, extractOptions: NO_AI }), false);
  assert.equal(await handleNaturalDailyPlan(sock, USER, USER, 'اليوم بدي انام', { now: MORNING, model, extractOptions: NO_AI }), false);
  assert.equal(nextPlanMessage({ tasks: [], morningSentAt: null }, MORNING), null);
});
