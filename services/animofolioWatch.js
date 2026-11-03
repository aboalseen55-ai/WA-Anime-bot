import OpsWatchState from '../database/opsWatchStateModel.js';
import { DEVELOPER_JID } from '../config.js';

const ORIGIN = (process.env.ANIMOFOLIO_ORIGIN || 'https://animofolio.com').replace(/\/$/, '');
const TIME_ZONE = 'Asia/Amman';
const TICK_MS = 60 * 1000;
const SITE_CHECK_MS = 5 * 60 * 1000;
const STATUS_CHECK_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20 * 1000;
export const REMINDER_MS = 6 * 60 * 60 * 1000;
export const SITE_FAILURES_TO_ALERT = 2;
export const STATUS_FAILURES_TO_ALERT = 3;
const SITE_KEY = 'site_down';
const STATUS_KEY = 'status_unreachable';

// Pure: decides what to say about the alerts now active, and what to remember.
export function planAlertMessages(remembered, active, now) {
  const messages = [];
  const next = {};
  const activeKeys = new Set(active.map((alert) => alert.key));

  for (const alert of active) {
    const previous = remembered[alert.key];
    if (!alert.urgent) {
      if (previous) next[alert.key] = previous;
      continue;
    }
    if (!previous) {
      messages.push({ key: alert.key, text: `🚨 AnimoFolio\n${alert.title}${alert.value > 1 ? `: ${alert.value}` : ''}` });
      next[alert.key] = { title: alert.title, lastSentAt: now };
    } else if (!alert.acknowledged && now - previous.lastSentAt >= REMINDER_MS) {
      messages.push({ key: alert.key, text: `⏰ لسا مفتوح\n${alert.title}${alert.value > 1 ? `: ${alert.value}` : ''}` });
      next[alert.key] = { ...previous, lastSentAt: now };
    } else {
      next[alert.key] = previous;
    }
  }

  for (const [key, previous] of Object.entries(remembered)) {
    if (!activeKeys.has(key)) messages.push({ key, resolved: true, text: `✅ انحلت\n${previous.title}` });
  }
  return { messages, next };
}

export function formatDailySummary(summary, alerts) {
  const waiting = alerts.filter((alert) => !alert.acknowledged);
  const lines = [
    '☀️ ملخص AnimoFolio',
    `مستخدمون جدد: ${summary.newUsers} (الإجمالي ${summary.totalUsers})`,
    `مشاريع منشورة جديدة: ${summary.newProjects}`,
    `اشتراكات جديدة: ${summary.newPaid}، إلغاءات: ${summary.cancellations}`,
    `المشتركون الآن: ${summary.paidSubscriptions}`,
    `طلبات الذكاء الاصطناعي: ${summary.aiRequests}`,
    '',
    waiting.length ? 'اليوم بدها منك:' : 'ما في إشي بينتظرك اليوم ✅',
    ...waiting.map((alert) => `- ${alert.title}: ${alert.value}`)
  ];
  return lines.join('\n');
}

export function ammanClock(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const summaryDue = (clock, lastDate) => clock.date !== lastDate && clock.minutes >= 7 * 60 + 15 && clock.minutes < 12 * 60;

async function fetchWithTimeout(url, options) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

export function startAnimofolioWatch({ getSock }) {
  const secret = (process.env.OPERATIONS_BOT_SECRET || '').trim();
  const recipient = (process.env.OPS_ALERT_JID || DEVELOPER_JID).trim();
  let state = null;
  let running = false;
  let lastSiteCheck = 0;
  let lastStatusCheck = 0;
  let siteFailures = 0;
  let statusFailures = 0;

  async function loadState() {
    state ||= await OpsWatchState.findOneAndUpdate({ key: 'animofolio' }, { $setOnInsert: { key: 'animofolio' } }, { upsert: true, returnDocument: 'after' }).lean();
    state.alerts ||= {};
    return state;
  }

  async function saveState() {
    await OpsWatchState.updateOne({ key: 'animofolio' }, { $set: { alerts: state.alerts, lastSummaryDate: state.lastSummaryDate } });
  }

  // Returns false when nothing could be delivered, so the same alert is tried next time.
  async function send(text) {
    const sock = getSock();
    if (!sock) return false;
    try {
      await sock.sendMessage(recipient, { text });
      return true;
    } catch (error) {
      console.warn('AnimoFolio alert not delivered:', error.message);
      return false;
    }
  }

  async function deliver(active, now) {
    const { messages, next } = planAlertMessages(state.alerts, active, now);
    for (const message of messages) {
      if (await send(message.text)) continue;
      // Undelivered news stays unsent: a new alert is forgotten, a resolved one is kept.
      if (message.resolved) next[message.key] = state.alerts[message.key];
      else if (state.alerts[message.key]) next[message.key] = state.alerts[message.key];
      else delete next[message.key];
    }
    state.alerts = next;
    await saveState();
  }

  async function checkSite(now) {
    lastSiteCheck = now;
    const healthy = await fetchWithTimeout(`${ORIGIN}/api/health`, { headers: { 'Cache-Control': 'no-store' } }).then((response) => response.ok).catch(() => false);
    siteFailures = healthy ? 0 : siteFailures + 1;
  }

  async function checkStatus(now, wantSummary) {
    lastStatusCheck = now;
    const whatsapp = getSock() ? 'open' : 'closed';
    const response = await fetchWithTimeout(`${ORIGIN}/api/ops/status?whatsapp=${whatsapp}${wantSummary ? '&summary=1' : ''}`, {
      headers: { Authorization: `Bearer ${secret}` }
    }).catch(() => null);
    if (!response?.ok) {
      statusFailures += 1;
      return null;
    }
    statusFailures = 0;
    return response.json().catch(() => null);
  }

  function watcherAlerts() {
    const alerts = [];
    // One failed check cannot clear an alert that is already open.
    const failing = (count, needed, key) => count >= needed || (count > 0 && state.alerts[key]);
    if (failing(siteFailures, SITE_FAILURES_TO_ALERT, SITE_KEY)) alerts.push({ key: SITE_KEY, title: 'الموقع لا يستجيب', urgent: true, value: 1 });
    if (secret && failing(statusFailures, STATUS_FAILURES_TO_ALERT, STATUS_KEY)) alerts.push({ key: STATUS_KEY, title: 'تعذر فحص حالة المنصة', urgent: true, value: 1 });
    return alerts;
  }

  // Stays null until the first answer, so a restart cannot read silence as resolved.
  let platformAlerts = secret ? null : [];

  async function tick() {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      await loadState();
      const clock = ammanClock(now);
      const wantSummary = Boolean(secret) && summaryDue(clock, state.lastSummaryDate);
      if (now - lastSiteCheck >= SITE_CHECK_MS) await checkSite(now);
      if (secret && (wantSummary || now - lastStatusCheck >= STATUS_CHECK_MS)) {
        const status = await checkStatus(now, wantSummary);
        if (status?.alerts) platformAlerts = status.alerts;
        if (status?.summary && await send(formatDailySummary(status.summary, platformAlerts || []))) {
          state.lastSummaryDate = clock.date;
          await saveState();
        }
      }
      const known = platformAlerts ?? Object.entries(state.alerts)
        .filter(([key]) => key !== SITE_KEY && key !== STATUS_KEY)
        .map(([key, value]) => ({ key, title: value.title, urgent: true, acknowledged: true, value: 1 }));
      await deliver([...known, ...watcherAlerts()], now);
    } catch (error) {
      console.warn('AnimoFolio watch failed:', error.message);
    } finally {
      running = false;
    }
  }

  setInterval(tick, TICK_MS);
  console.log(`AnimoFolio watch started${secret ? '' : ' (site check only)'}`);
}
