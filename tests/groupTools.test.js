import test from 'node:test';
import assert from 'node:assert/strict';
import GroupSettings from '../database/groupSettingsModel.js';
import PersonalItem from '../database/personalItemModel.js';
import { setControlSnapshot } from '../services/botControls.js';
import { deliverDueReminders } from '../utils/personalAssistant.js';
import {
  clearGroupHistory, clearGroupSettingsCache, enforceGroupProtection, getGroupHistory,
  handleGroupCommand, matchGroupCommand, recordGroupMessage
} from '../utils/groupTools.js';

const GROUP = '120363000000000000@g.us';
const ADMIN = '111@s.whatsapp.net';
const MEMBER = '222@s.whatsapp.net';

function fakeSock({ botAdmin = true } = {}) {
  const sent = [];
  return {
    sent,
    user: { id: '999:28@s.whatsapp.net', lid: '888:28@lid' },
    groupMetadata: async () => ({
      participants: [
        { id: ADMIN, admin: 'admin' },
        { id: MEMBER, admin: null },
        { id: '888@lid', admin: botAdmin ? 'admin' : null }
      ]
    }),
    sendMessage: async (jid, payload) => { sent.push({ jid, ...payload }); }
  };
}

function settingsStore(t, initial = {}) {
  const rows = new Map(Object.entries(initial));
  t.mock.method(GroupSettings, 'findOne', q => ({ lean: () => Promise.resolve(rows.get(q.jid) || null) }));
  t.mock.method(GroupSettings, 'updateOne', async (q, u) => { rows.set(q.jid, { ...(rows.get(q.jid) || {}), ...u.$set }); });
  return rows;
}

const groupMsg = (sender, text) => ({ key: { remoteJid: GROUP, participant: sender, id: String(Math.random()) }, pushName: 'x', message: { conversation: text } });

test('group history keeps recent non-command messages only', () => {
  clearGroupHistory();
  recordGroupMessage(GROUP, 'سامر', 'مرحبا');
  recordGroupMessage(GROUP, 'سامر', '/ملخص');
  recordGroupMessage('u@s.whatsapp.net', 'x', 'خاص');
  for (let i = 0; i < 320; i += 1) recordGroupMessage(GROUP, 'a', `رسالة ${i}`);
  assert.equal(getGroupHistory(GROUP).length, 300);
  assert.equal(getGroupHistory(GROUP).at(-1).text, 'رسالة 319');
  assert.equal(getGroupHistory('u@s.whatsapp.net').length, 0);
});

test('group commands match Arabic variants', () => {
  assert.ok(matchGroupCommand('/ملخص 50'));
  assert.equal(matchGroupCommand('/ذكر_القروب بكرة الساعة 8 الاجتماع').args, 'بكرة الساعة 8 الاجتماع');
  assert.ok(matchGroupCommand('/حماية روابط تشغيل'));
  assert.equal(matchGroupCommand('/ملفي'), null);
});

test('summary needs enough messages', async () => {
  clearGroupHistory();
  setControlSnapshot([]);
  const sock = fakeSock();
  await handleGroupCommand(sock, GROUP, MEMBER, '/ملخص', groupMsg(MEMBER, '/ملخص'));
  assert.match(sock.sent[0].text, /ما في رسائل كفاية/);
});

test('only WhatsApp group admins can change protection; links from members are deleted', async t => {
  clearGroupSettingsCache();
  const rows = settingsStore(t);
  const sock = fakeSock();

  await handleGroupCommand(sock, GROUP, MEMBER, '/حماية روابط تشغيل', groupMsg(MEMBER, ''));
  assert.match(sock.sent.at(-1).text, /بس لمشرفين/);
  assert.equal(rows.get(GROUP), undefined);

  await handleGroupCommand(sock, GROUP, ADMIN, '/حماية روابط تشغيل', groupMsg(ADMIN, ''));
  assert.equal(rows.get(GROUP).antiLink, true);

  sock.sent.length = 0;
  assert.equal(await enforceGroupProtection(sock, groupMsg(MEMBER, 'شوفوا https://example.com')), true);
  assert.ok(sock.sent.some(m => m.delete));
  assert.ok(sock.sent.some(m => /الروابط ممنوعة/.test(m.text || '')));

  sock.sent.length = 0;
  assert.equal(await enforceGroupProtection(sock, groupMsg(ADMIN, 'https://example.com')), false);
  assert.equal(await enforceGroupProtection(sock, groupMsg(MEMBER, 'كلام عادي')), false);
  assert.equal(sock.sent.length, 0);
});

test('spam protection kicks in after a burst and warns once', async t => {
  clearGroupSettingsCache();
  settingsStore(t, { [GROUP]: { antiSpam: true } });
  const sock = fakeSock({ botAdmin: false });
  const start = Date.now();
  const results = [];
  for (let i = 0; i < 10; i += 1) results.push(await enforceGroupProtection(sock, groupMsg(MEMBER, `hi ${i}`), start + i * 100));
  assert.deepEqual(results.slice(0, 7), Array(7).fill(false));
  assert.equal(results[7], true);
  assert.equal(sock.sent.filter(m => /سبام/.test(m.text || '')).length, 1);
  assert.equal(sock.sent.filter(m => m.delete).length, 0);
});

test('/نداء mentions everyone for admins only', async () => {
  clearGroupSettingsCache();
  const sock = fakeSock();
  await handleGroupCommand(sock, GROUP, MEMBER, '/نداء اجتماع', groupMsg(MEMBER, ''));
  assert.match(sock.sent.at(-1).text, /بس لمشرفين/);
  await handleGroupCommand(sock, GROUP, ADMIN, '/نداء اجتماع الساعة 8', groupMsg(ADMIN, ''));
  assert.equal(sock.sent.at(-1).mentions.length, 3);
  assert.match(sock.sent.at(-1).text, /اجتماع الساعة 8/);
});

test('group reminders are delivered to the group', async t => {
  clearGroupSettingsCache();
  setControlSnapshot([]);
  const docs = [];
  t.mock.method(PersonalItem, 'countDocuments', async () => 0);
  t.mock.method(PersonalItem, 'create', async data => { docs.push({ _id: docs.length + 1, status: 'pending', attempts: 0, ...data }); });
  t.mock.method(PersonalItem, 'find', q => ({ sort: () => ({ limit: () => ({ lean: async () => docs.filter(d => q.kind.$in.includes(d.kind) && d.status === q.status && d.dueAt <= q.dueAt.$lte) }) }) }));
  t.mock.method(PersonalItem, 'findOneAndUpdate', (q, u) => ({ lean: async () => { const d = docs.find(x => x._id === q._id && x.status === q.status); if (!d) return null; Object.assign(d, u.$set); return d; } }));
  t.mock.method(PersonalItem, 'updateOne', async (q, u) => { Object.assign(docs.find(x => x._id === q._id), u.$set); });

  const sock = fakeSock();
  await handleGroupCommand(sock, GROUP, ADMIN, '/ذكر_القروب بعد 10 دقائق الاجتماع', groupMsg(ADMIN, ''));
  assert.equal(docs[0].kind, 'groupReminder');
  assert.equal(docs[0].chatJid, GROUP);

  await deliverDueReminders(sock, new Date(Date.now() + 11 * 60000));
  const delivered = sock.sent.at(-1);
  assert.equal(delivered.jid, GROUP);
  assert.match(delivered.text, /تذكير للمجموعة/);
  assert.equal(docs[0].status, 'sent');
});
