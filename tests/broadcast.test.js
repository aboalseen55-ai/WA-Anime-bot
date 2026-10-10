import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceMessage, listBroadcastTargets, normalizeNumbers, sendBroadcast, transcribeAudio, startBroadcastJob, getBroadcastJob } from '../services/broadcastService.js';

const GROUPS = [{ id: '111-1@g.us', name: 'الرئيسي' }, { id: '222-2@g.us', name: 'قروب العيلة' }];
const getGroups = async () => GROUPS;

function withKey(t) {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; });
}

test('numbers are normalized to WhatsApp ids (Jordanian 07 numbers included)', () => {
  assert.deepEqual(normalizeNumbers('0791234567\n+962 79 123 4567, 00447700900123'), ['962791234567@s.whatsapp.net', '447700900123@s.whatsapp.net']);
  assert.throws(() => normalizeNumbers('123'), /رقم غير صالح/);
});

test('targets list marks which kingdom each group belongs to', async () => {
  const kingdomModel = { find: () => ({ select: () => ({ sort: () => ({ lean: async () => [{ id: 'k1', name: 'مملكة النار', mainGroup: '111-1@g.us' }] }) }) }) };
  const { groups } = await listBroadcastTargets(getGroups, { kingdomModel });
  assert.deepEqual(groups[0], { id: '111-1@g.us', name: 'الرئيسي', kingdom: 'مملكة النار', kingdomId: 'k1', role: 'الرئيسي' });
  assert.equal(groups[1].kingdom, undefined);
});

test('enhance and transcribe call OpenAI with the key', async (t) => {
  withKey(t);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const body = url.endsWith('transcriptions') ? { text: 'مرحبا يا جماعة' } : { choices: [{ message: { content: '*مرحبا يا جماعة* 👋' } }] };
    return { ok: true, json: async () => body };
  };
  assert.equal(await transcribeAudio(Buffer.from('audio'), 'audio/webm', { fetchImpl }), 'مرحبا يا جماعة');
  assert.equal(await enhanceMessage('مرحبا يا جماعة', { tone: 'formal', fetchImpl }), '*مرحبا يا جماعة* 👋');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer test-key');
  const payload = JSON.parse(calls[1].init.body);
  assert.match(payload.messages[0].content, /رسمي/);
});

test('without a key the AI tools say so', async (t) => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => { if (previous !== undefined) process.env.OPENAI_API_KEY = previous; });
  await assert.rejects(enhanceMessage('x'), /OPENAI_API_KEY/);
});

test('broadcast sends to chosen groups and numbers, and rejects groups the bot is not in', async () => {
  const sent = [];
  const sock = { sendMessage: async (jid, payload) => { if (jid.startsWith('999')) throw new Error('nope'); sent.push([jid, payload.text]); } };
  const result = await sendBroadcast(sock, { groups: ['222-2@g.us'], numbers: '0791234567\n999999999', text: 'اجتماع الساعة 8' }, { getGroups, delay: 0 });
  assert.deepEqual(sent, [['222-2@g.us', 'اجتماع الساعة 8'], ['962791234567@s.whatsapp.net', 'اجتماع الساعة 8']]);
  assert.deepEqual([result.sent, result.failed], [2, 1]);
  await assert.rejects(sendBroadcast(sock, { groups: ['333-3@g.us'], text: 'x' }, { getGroups, delay: 0 }), /البوت مش فيه/);
  await assert.rejects(sendBroadcast(sock, { groups: [], text: 'x' }, { getGroups, delay: 0 }), /اختار قروب/);
});

test('broadcast job runs in the background and reports progress', async () => {
  const sock = { sendMessage: async () => {} };
  const job = await startBroadcastJob(sock, { groups: ['111-1@g.us', '222-2@g.us'], text: 'هلا' }, { getGroups, delay: 0 });
  assert.equal(job.total, 2);
  for (let i = 0; i < 20 && !getBroadcastJob(job.id).finished; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([getBroadcastJob(job.id).sent, getBroadcastJob(job.id).finished], [2, true]);
});

test('compose mode writes a new message from a description instead of polishing a draft', async (t) => {
  withKey(t);
  let payload;
  const fetchImpl = async (url, init) => {
    payload = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '*اجتماع المملكة* 📣' } }] }) };
  };
  const out = await enhanceMessage('اكتبلي رسالة اجتماع للمملكة يوم الجمعة', { mode: 'compose', fetchImpl });
  assert.equal(out, '*اجتماع المملكة* 📣');
  assert.match(payload.messages[0].content, /كاتب رسائل/);
  assert.match(payload.messages[0].content, /\[بين قوسين\]/);
  await assert.rejects(enhanceMessage('  ', { mode: 'compose', fetchImpl }), /احكيلي/);
});
