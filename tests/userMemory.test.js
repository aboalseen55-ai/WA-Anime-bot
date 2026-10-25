import test from 'node:test';
import assert from 'node:assert/strict';
import UserMemory from '../database/userMemoryModel.js';
import {
  extractMemoryNotes, mergeFacts, buildUserMemoryContext, queueTurnsForSummary, formatUserMemory
} from '../utils/userMemory.js';
import { handlePersonalCommand } from '../utils/personalAssistant.js';

const USER = '962700000000@s.whatsapp.net';

function fakeMemoryStore(t) {
  const docs = new Map();
  let nextId = 1;
  t.mock.method(UserMemory, 'findOne', q => ({ lean: async () => {
    const d = docs.get(q.userJid);
    return d ? structuredClone(d) : null;
  } }));
  t.mock.method(UserMemory, 'updateOne', async (q, u) => {
    const d = docs.get(q.userJid) || { userJid: q.userJid, facts: [], summary: '', pendingTurns: [] };
    Object.assign(d, structuredClone(u.$set || {}));
    if (u.$push?.pendingTurns) {
      const added = u.$push.pendingTurns.$each.map(turn => ({ _id: nextId++, ...turn }));
      d.pendingTurns = [...d.pendingTurns, ...added].slice(u.$push.pendingTurns.$slice);
    }
    if (u.$pull?.pendingTurns) {
      const ids = u.$pull.pendingTurns._id.$in;
      d.pendingTurns = d.pendingTurns.filter(turn => !ids.includes(turn._id));
    }
    docs.set(q.userJid, d);
  });
  t.mock.method(UserMemory, 'deleteOne', async q => { docs.delete(q.userJid); });
  return docs;
}

function fakeSock() {
  const sent = [];
  return { sent, sendMessage: async (jid, payload) => { sent.push({ jid, ...payload }); } };
}

test('memory notes are pulled out of the reply and never reach the user', () => {
  const { reply, notes } = extractMemoryNotes('أكيد، بالتوفيق بالشغل الجديد!\n[[MEM: بشتغل محاسب بشركة بعمان]]\n[[ mem : اسمه سامر ]]');
  assert.equal(reply, 'أكيد، بالتوفيق بالشغل الجديد!');
  assert.deepEqual(notes, ['بشتغل محاسب بشركة بعمان', 'اسمه سامر']);
  assert.deepEqual(extractMemoryNotes('رد عادي').notes, []);
});

test('facts are deduplicated, newer wins, and capped', () => {
  const now = new Date('2026-10-25T00:00:00Z');
  let facts = mergeFacts([], ['ساكن بإربد', 'بحب القهوة سادة'], now);
  facts = mergeFacts(facts, ['بحب القهوة سادة'], now);
  assert.equal(facts.length, 2);
  facts = mergeFacts(facts, ['ساكن بإربد هلأ بعمان'], now);
  assert.deepEqual(facts.map(f => f.text), ['بحب القهوة سادة', 'ساكن بإربد هلأ بعمان']);

  const many = mergeFacts([], Array.from({ length: 30 }, (_, i) => `معلومة رقم ${i + 100}`), now);
  assert.equal(many.length, 15);
  assert.equal(many.at(-1).text, 'معلومة رقم 129');
});

test('context sent to the AI is just facts and a short summary', () => {
  assert.equal(buildUserMemoryContext(null), '');
  const ctx = buildUserMemoryContext({ facts: [{ text: 'اسمه سامر' }], summary: 'كان بجهز عرض للبنك' });
  assert.equal(ctx, 'facts:\n- اسمه سامر\nearlier: كان بجهز عرض للبنك');
});

test('small talk is dropped and old turns are compacted in one small call per batch', async t => {
  const docs = fakeMemoryStore(t);
  const calls = [];
  const ai = async (req) => {
    calls.push(req);
    return JSON.stringify({ summary: 'بحضر لمقابلة شغل يوم الخميس', facts: ['اسمه سامر', 'مهندس برمجيات'] });
  };
  const options = { ai, aiAvailable: () => true };

  // السلامات ما بتنحسب
  await queueTurnsForSummary(USER, [
    { role: 'user', text: 'مرحبا', intent: 'greeting' },
    { role: 'bot', text: 'هلا فيك', intent: 'greeting' }
  ], options);
  assert.equal(docs.get(USER), undefined);

  const turn = (role, text) => ({ role, text, intent: 'conversation' });
  await queueTurnsForSummary(USER, [turn('user', 'عندي مقابلة شغل الخميس'), turn('bot', 'بالتوفيق! بدك نتمرن؟')], options);
  await queueTurnsForSummary(USER, [turn('user', 'اه بس بعدين'), turn('bot', 'تمام وقت ما بدك')], options);
  assert.equal(calls.length, 0);
  assert.equal(docs.get(USER).pendingTurns.length, 4);

  await queueTurnsForSummary(USER, [turn('user', 'شو أهم اسئلة بتنسأل'), turn('bot', 'عن مشاريعك وخبرتك')], options);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].json, true);
  assert.ok(calls[0].maxOutputTokens <= 300);
  const doc = docs.get(USER);
  assert.equal(doc.pendingTurns.length, 0);
  assert.equal(doc.summary, 'بحضر لمقابلة شغل يوم الخميس');
  assert.deepEqual(doc.facts.map(f => f.text), ['اسمه سامر', 'مهندس برمجيات']);
});

test('compaction waits when AI is unavailable or returns junk', async t => {
  const docs = fakeMemoryStore(t);
  const turns = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'bot' : 'user', text: `رسالة مهمة ${i}`, intent: 'conversation' }));
  await queueTurnsForSummary(USER, turns, { ai: async () => 'not json', aiAvailable: () => true });
  assert.equal(docs.get(USER).pendingTurns.length, 6);
  await queueTurnsForSummary(USER, [], { ai: async () => { throw new Error('should not run'); }, aiAvailable: () => false });
  assert.equal(docs.get(USER).pendingTurns.length, 6);
});

test('memory commands: remember, show, forget one, forget all', async t => {
  const docs = fakeMemoryStore(t);
  const sock = fakeSock();
  const dm = USER;

  assert.equal(await handlePersonalCommand(sock, dm, USER, '/تذكر بشتغل محاسب'), true);
  await handlePersonalCommand(sock, dm, USER, '/تذكر عيد ميلادي 3 آذار');
  assert.deepEqual(docs.get(USER).facts.map(f => f.text), ['بشتغل محاسب', 'عيد ميلادي 3 آذار']);

  await handlePersonalCommand(sock, dm, USER, '/ذاكرتي');
  assert.match(sock.sent.at(-1).text, /1\. بشتغل محاسب/);

  await handlePersonalCommand(sock, dm, USER, '/انسى 1');
  assert.match(sock.sent.at(-1).text, /نسيت: بشتغل محاسب/);
  assert.equal(docs.get(USER).facts.length, 1);

  await handlePersonalCommand(sock, dm, USER, '/انسى');
  assert.match(sock.sent.at(-1).text, /رقم غير صحيح/);
  assert.equal(docs.get(USER).facts.length, 1);

  await handlePersonalCommand(sock, dm, USER, '/انسى الكل');
  assert.equal(docs.has(USER), false);
  assert.match(formatUserMemory(null), /لسا ما بعرف عنك/);
});
