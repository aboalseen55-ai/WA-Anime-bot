import test from 'node:test';
import assert from 'node:assert/strict';
import { BotSentMessage, handleBotDeletion, DELETE_WINDOW_MS } from '../services/botMessageDeletion.js';

test('deletion revokes only recent own messages in the current chat', async t => {
  const jid = '123@s.whatsapp.net';
  const key = { id: 'recent', fromMe: true, remoteJid: jid };
  t.mock.method(BotSentMessage, 'find', filter => {
    assert.equal(filter.chat, jid);
    return { sort: () => ({ limit: () => ({ lean: async () => [
      { _id: '1', key, sentAt: new Date() },
      { _id: '2', key, sentAt: new Date(Date.now() - DELETE_WINDOW_MS - 1000) },
      { _id: '3', key: { ...key, fromMe: false }, sentAt: new Date() }
    ] }) }) };
  });
  t.mock.method(BotSentMessage, 'updateOne', async () => ({}));
  const sent = [];
  await handleBotDeletion({ sendMessage: async (_, payload) => sent.push(payload) }, jid, jid, '/حذف_رسائلي 3');
  assert.deepEqual(sent[0], { delete: key });
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /طلبات الحذف لدى الجميع: 1/);
});
