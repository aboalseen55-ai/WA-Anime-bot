import test from 'node:test';
import assert from 'node:assert/strict';
import { funEnabled, getBotMode, personalEnabled } from '../services/botMode.js';
import { handleSlashCommand } from '../handlers/commandRouting.js';

function withMode(t, mode) {
  const previous = process.env.BOT_MODE;
  if (mode === undefined) delete process.env.BOT_MODE; else process.env.BOT_MODE = mode;
  t.after(() => { if (previous === undefined) delete process.env.BOT_MODE; else process.env.BOT_MODE = previous; });
}

test('BOT_MODE picks which half of the bot runs', (t) => {
  withMode(t, undefined);
  assert.deepEqual([getBotMode(), personalEnabled(), funEnabled()], ['all', true, true]);
  withMode(t, 'personal');
  assert.deepEqual([getBotMode(), personalEnabled(), funEnabled()], ['personal', true, false]);
  withMode(t, ' FUN ');
  assert.deepEqual([getBotMode(), personalEnabled(), funEnabled()], ['fun', false, true]);
  withMode(t, 'غلط');
  assert.equal(getBotMode(), 'all');
});

test('personal bot answers /أوامر with the assistant menu and hides kingdom commands', async (t) => {
  withMode(t, 'personal');
  const sent = [];
  const sock = { sendMessage: async (jid, payload) => { sent.push(payload); } };
  const user = 'u@s.whatsapp.net';
  await handleSlashCommand(sock, user, user, '/أوامر', {});
  assert.match(sent.at(-1).text, /المصاريف/);
  assert.doesNotMatch(sent.at(-1).text, /الممالك|البنك/);
  await handleSlashCommand(sock, user, user, '/ملفي', {});
  assert.match(sent.at(-1).text, /الأمر غير معروف: \/ملفي/);
});

test('personal bot stays silent in a kingdom reception group', async (t) => {
  withMode(t, 'personal');
  const { replaceKingdoms } = await import('../config.js');
  const { messageHandler } = await import('../handlers/messageHandler.js');
  const reception = 'reception@g.us';
  replaceKingdoms({ k1: { id: 'k1', name: 'مملكة', groupIds: [], mainGroup: 'main@g.us', receptionGroup: reception } });
  t.after(() => replaceKingdoms({}));
  const sent = [];
  const sock = { sendMessage: async (jid, payload) => { sent.push(payload); } };
  const msg = { key: { remoteJid: reception, participant: 'new@s.whatsapp.net' }, pushName: 'جديد', message: { conversation: 'السلام عليكم' } };
  await messageHandler(sock, msg);
  assert.equal(sent.length, 0);
});
