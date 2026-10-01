import test from 'node:test';
import assert from 'node:assert/strict';
import AssistantProfile from '../database/assistantProfileModel.js';
import PersonalItem from '../database/personalItemModel.js';
import { setControlSnapshot } from '../services/botControls.js';
import { consumeAssistantQuota } from '../utils/assistantQuota.js';
import { buildMorningBrief, deliverMorningBriefs, handleAssistantHomeCommand, handleFirstContact, fetchPrayerTimes } from '../utils/assistantHome.js';
import { describeMedia, formatTranscription, handleMediaAssistant, parseMediaCommand } from '../utils/mediaAssistant.js';

const NOW = new Date('2026-10-01T05:00:00Z'); // 08:00 in Amman

function fakeProfiles(t) {
  const docs = [];
  const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
  const matches = (doc, q) => Object.entries(q).every(([key, cond]) => {
    const value = get(doc, key);
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$ne' in cond) return value !== cond.$ne;
      if ('$lt' in cond) return value < cond.$lt;
    }
    if (cond === null) return value == null;
    return value === cond;
  });
  const set = (doc, path, value) => { const keys = path.split('.'); let o = doc; keys.slice(0, -1).forEach(k => { o[k] ??= {}; o = o[k]; }); o[keys.at(-1)] = value; };
  const apply = (doc, u) => {
    Object.entries(u.$set || {}).forEach(([k, v]) => set(doc, k, v));
    Object.entries(u.$inc || {}).forEach(([k, v]) => set(doc, k, (get(doc, k) || 0) + v));
  };
  t.mock.method(AssistantProfile, 'updateOne', async (q, u, opts = {}) => {
    const d = docs.find(x => matches(x, q));
    if (d) { apply(d, u); return { modifiedCount: 1, upsertedCount: 0 }; }
    if (opts.upsert) {
      if (docs.some(x => x.jid === q.jid)) { const e = new Error('dup'); e.code = 11000; throw e; }
      const doc = { _id: q.jid, jid: q.jid, introducedAt: null, usageCount: 0 };
      apply(doc, u); docs.push(doc);
      return { modifiedCount: 0, upsertedCount: 1 };
    }
    return { modifiedCount: 0, upsertedCount: 0 };
  });
  t.mock.method(AssistantProfile, 'findOneAndUpdate', (q, u) => {
    const run = async () => { const d = docs.find(x => matches(x, q)); if (!d) return null; apply(d, u); return { ...d }; };
    const p = run();
    return { lean: () => p, then: (a, b) => p.then(a, b), catch: f => p.catch(f) };
  });
  t.mock.method(AssistantProfile, 'findOne', q => ({ lean: async () => docs.find(x => matches(x, q)) || null }));
  t.mock.method(AssistantProfile, 'create', async data => { docs.push({ _id: data.jid, ...data }); return data; });
  t.mock.method(AssistantProfile, 'find', q => ({ limit: () => ({ lean: async () => docs.filter(x => matches(x, q)).map(d => ({ ...d })) }) }));
  return docs;
}

function fakeSock() {
  const sent = [];
  return { sent, user: { id: 'bot@s.whatsapp.net' }, sendMessage: async (jid, payload) => { sent.push({ jid, ...payload }); } };
}

test('daily quota counts per user and notifies once', async t => {
  process.env.ASSISTANT_DAILY_LIMIT = '2';
  t.after(() => { delete process.env.ASSISTANT_DAILY_LIMIT; });
  fakeProfiles(t);
  const jid = '962700000001@s.whatsapp.net';
  assert.equal((await consumeAssistantQuota(jid, NOW)).allowed, true);
  assert.equal((await consumeAssistantQuota(jid, NOW)).allowed, true);
  const third = await consumeAssistantQuota(jid, NOW);
  assert.equal(third.allowed, false);
  assert.equal(third.notify, true);
  assert.equal((await consumeAssistantQuota(jid, NOW)).notify, false);
  // next day resets
  assert.equal((await consumeAssistantQuota(jid, new Date('2026-10-02T05:00:00Z'))).allowed, true);
});

test('first private message gets the intro once; groups never do', async t => {
  setControlSnapshot([]);
  fakeProfiles(t);
  const sock = fakeSock();
  const msg = { key: { remoteJid: 'u@s.whatsapp.net' }, pushName: 'سامر', message: { conversation: 'مرحبا' } };
  assert.equal(await handleFirstContact(sock, msg), false);
  await handleFirstContact(sock, msg);
  assert.equal(sock.sent.length, 1);
  assert.match(sock.sent[0].text, /أهلًا سامر/);
  await handleFirstContact(sock, { key: { remoteJid: 'g@g.us', participant: 'x@s.whatsapp.net' }, message: {} });
  assert.equal(sock.sent.length, 1);
});

test('media detection and commands', () => {
  const voice = describeMedia({ ephemeralMessage: { message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 42, ptt: true } } } });
  assert.equal(voice.type, 'audio');
  assert.equal(voice.seconds, 42);
  assert.equal(describeMedia({ documentMessage: { mimetype: 'application/pdf', fileName: 'a.pdf' } }).type, 'pdf');
  assert.equal(describeMedia({ documentMessage: { mimetype: 'application/msword', fileName: 'a.doc' } }).type, 'document');
  assert.equal(describeMedia({ conversation: 'hi' }), null);

  assert.deepEqual(parseMediaCommand('/فرغ'), { mode: 'transcribe', question: '' });
  assert.deepEqual(parseMediaCommand('/اقرأ شو تاريخ الفاتورة؟'), { mode: 'read', question: 'شو تاريخ الفاتورة؟' });
  assert.equal(parseMediaCommand('/فيديو قطط'), null);
  assert.equal(parseMediaCommand('فرغ'), null);
});

test('transcription formatting adds a summary only for long notes', () => {
  assert.match(formatTranscription({ transcript: 'مرحبا', summary: 'تحية' }, 5), /^📝/);
  assert.doesNotMatch(formatTranscription({ transcript: 'مرحبا', summary: 'تحية' }, 5), /الخلاصة/);
  assert.match(formatTranscription({ transcript: 'نص طويل', summary: 'المطلوب اتصال' }, 60), /الخلاصة:\* المطلوب اتصال/);
  assert.match(formatTranscription({ transcript: '' }, 60), /ما قدرت/);
});

test('media assistant ignores group media without a command and hints on a bare command', async () => {
  setControlSnapshot([]);
  const sock = fakeSock();
  const groupVoice = { key: { remoteJid: 'g@g.us', participant: 'u@s.whatsapp.net' }, message: { audioMessage: { seconds: 3 } } };
  assert.equal(await handleMediaAssistant(sock, groupVoice, ''), false);

  const bare = { key: { remoteJid: 'g@g.us', participant: 'u@s.whatsapp.net' }, message: { conversation: '/فرغ' } };
  assert.equal(await handleMediaAssistant(sock, bare, '/فرغ'), true);
  assert.match(sock.sent[0].text, /رد على رسالة صوتية/);


  const captionCommand = { key: { remoteJid: 'u@s.whatsapp.net' }, message: { imageMessage: { caption: '/ملصق' } } };
  assert.equal(await handleMediaAssistant(sock, captionCommand, ''), false);
});

test('a group voice note that replies to Sam is answered, other group voices are ignored', async () => {
  setControlSnapshot([]);
  const sock = fakeSock();
  const toSam = {
    key: { remoteJid: 'g@g.us', participant: 'u@s.whatsapp.net' },
    message: { audioMessage: { seconds: 3, contextInfo: { participant: 'bot@s.whatsapp.net', stanzaId: 'x', quotedMessage: { conversation: 'أهلين' } } } }
  };
  const toSomeoneElse = {
    key: { remoteJid: 'g@g.us', participant: 'u@s.whatsapp.net' },
    message: { audioMessage: { seconds: 3, contextInfo: { participant: 'other@s.whatsapp.net', stanzaId: 'y', quotedMessage: { conversation: 'هاي' } } } }
  };
  assert.equal(await handleMediaAssistant(sock, toSomeoneElse, ''), false);
  assert.equal(sock.sent.length, 0);
  // بدون مفتاح Gemini بالاختبار، بيوصل لمرحلة الرد وبيعتذر إنه الخدمة متوقفة
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (/GEMINI|GOOGLE_API/.test(key)) delete process.env[key];
  try {
    assert.equal(await handleMediaAssistant(sock, toSam, ''), true);
  } finally {
    Object.assign(process.env, saved);
  }
  assert.equal(sock.sent[0].jid, 'g@g.us');
});

test('prayer times are parsed and cached', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => ({ data: { timings: { Fajr: '04:51 (EEST)', Dhuhr: '11:39', Asr: '15:01', Maghrib: '17:37', Isha: '18:56' } } }) }; };
  const times = await fetchPrayerTimes('Test City', NOW, fetchImpl);
  assert.equal(times['الفجر'], '04:51');
  await fetchPrayerTimes('Test City', NOW, fetchImpl);
  assert.equal(calls, 1);
  assert.equal(await fetchPrayerTimes('Broken', NOW, async () => { throw new Error('down'); }), null);
});

test('morning brief lists today and is sent once per day at the chosen time', async t => {
  setControlSnapshot([]);
  const docs = fakeProfiles(t);
  const items = [
    { kind: 'reminder', userJid: 'u@s.whatsapp.net', status: 'pending', text: 'اجتماع', dueAt: new Date('2026-10-01T07:00:00Z') },
    { kind: 'todo', userJid: 'u@s.whatsapp.net', done: false, text: 'شراء خبز', createdAt: new Date(1) }
  ];
  t.mock.method(PersonalItem, 'find', q => ({ sort: () => ({ limit: () => ({ lean: async () => items.filter(i => i.kind === q.kind) }) }) }));
  const fetchImpl = async () => ({ ok: false });

  const sock = fakeSock();
  // التفعيل الساعة 6 الصبح بعمّان، قبل موعد 7:30، فأول ملخص بيطلع اليوم
  await handleAssistantHomeCommand(sock, 'u@s.whatsapp.net', 'u@s.whatsapp.net', '/صباحي تشغيل 7:30', {}, { now: new Date('2026-10-01T03:00:00Z') });
  assert.equal(docs[0].brief.enabled, true);
  assert.equal(docs[0].brief.hour, 7);
  assert.equal(docs[0].brief.minute, 30);

  const brief = await buildMorningBrief(docs[0], { now: NOW, fetchImpl });
  assert.match(brief, /اجتماع/);
  assert.match(brief, /شراء خبز/);

  // 08:00 Amman: due (07:30) and inside the late window
  assert.equal(await deliverMorningBriefs(sock, NOW, { fetchImpl }), 1);
  assert.equal(await deliverMorningBriefs(sock, NOW, { fetchImpl }), 0);
  assert.equal(sock.sent.at(-1).jid, 'u@s.whatsapp.net');

  await handleAssistantHomeCommand(sock, 'u@s.whatsapp.net', 'u@s.whatsapp.net', '/صباحي ايقاف', {});
  assert.equal(docs[0].brief.enabled, false);
});

test('/مساعدة shows the main help', async () => {
  const sock = fakeSock();
  assert.equal(await handleAssistantHomeCommand(sock, 'g@g.us', 'u@s.whatsapp.net', '/مساعدة', {}), true);
  assert.match(sock.sent[0].text, /فرغ/);
  assert.equal(await handleAssistantHomeCommand(sock, 'g@g.us', 'u@s.whatsapp.net', '/ملفي', {}), false);
});
