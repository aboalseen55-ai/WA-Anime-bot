import test from 'node:test';
import assert from 'node:assert/strict';
import { ammanClock, formatDailySummary, planAlertMessages, REMINDER_MS, summaryDue } from '../services/animofolioWatch.js';

const alert = (over = {}) => ({ key: 'billing', title: 'أحداث دفع فشلت', urgent: true, acknowledged: false, value: 1, ...over });

test('an urgent alert is announced once, then only reminded after the quiet period', () => {
  const first = planAlertMessages({}, [alert()], 1000);
  assert.equal(first.messages.length, 1);
  assert.equal(planAlertMessages(first.next, [alert()], 2000).messages.length, 0);
  const reminder = planAlertMessages(first.next, [alert()], 1000 + REMINDER_MS);
  assert.equal(reminder.messages.length, 1);
  assert.equal(reminder.next.billing.lastSentAt, 1000 + REMINDER_MS);
});

test('an acknowledged alert stops reminding and a cleared one reports it was resolved', () => {
  const { next } = planAlertMessages({}, [alert()], 1000);
  assert.equal(planAlertMessages(next, [alert({ acknowledged: true })], 1000 + REMINDER_MS).messages.length, 0);
  const cleared = planAlertMessages(next, [], 2000);
  assert.equal(cleared.messages[0].resolved, true);
  assert.deepEqual(cleared.next, {});
});

test('non-urgent alerts stay silent until the daily summary', () => {
  const plan = planAlertMessages({}, [alert({ urgent: false, key: 'appeals', title: 'طعون' })], 1000);
  assert.deepEqual(plan.messages, []);
  assert.deepEqual(plan.next, {});
});

test('the summary lists what is waiting and leaves acknowledged items out', () => {
  const summary = { newUsers: 2, totalUsers: 40, newProjects: 1, newPaid: 0, cancellations: 0, paidSubscriptions: 3, aiRequests: 9 };
  const text = formatDailySummary(summary, [alert({ urgent: false, title: 'طعون', value: 2 }), alert({ title: 'قديم', acknowledged: true })]);
  assert.match(text, /طعون: 2/);
  assert.doesNotMatch(text, /قديم/);
  assert.match(formatDailySummary(summary, []), /ما في إشي/);
});

test('the summary goes once a day, in the morning, on Amman time', () => {
  const clock = ammanClock(Date.UTC(2026, 10, 3, 4, 20));
  assert.deepEqual(clock, { date: '2026-11-03', minutes: 7 * 60 + 20 });
  assert.equal(summaryDue(clock, '2026-11-02'), true);
  assert.equal(summaryDue(clock, '2026-11-03'), false);
  assert.equal(summaryDue({ date: '2026-11-03', minutes: 6 * 60 }, ''), false);
  assert.equal(summaryDue({ date: '2026-11-03', minutes: 13 * 60 }, ''), false);
});
