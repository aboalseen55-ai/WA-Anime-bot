import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import axios from 'axios';
import Command from '../database/dashboardCommandModel.js';
import { validateCommand } from '../services/dashboardServer.js';
import { handleDashboardAutoLink, handleDashboardCommand, matchAutoLink, senderPhoneNumbers, clearAutoLinkCache, setHttpClient } from '../services/dashboardRuntime.js';

const insta = {
  trigger: '/انستا', permission: 'numbers', allowedNumbers: ['962700000001'], autoLinkDomains: ['instagram.com'], enabled: true,
  responseTemplate: 'تم', responsePath: 'data.medias.0.link',
  apiId: { _id: 'insta', enabled: true, type: 'api', method: 'GET', endpoint: 'https://insta.example.com/post-dl', queryTemplate: 'url={query}', responseType: 'video_url', timeoutMs: 1000 }
};
const reel = 'شوف هاد https://www.instagram.com/reel/ABC/?igsh=x';

function setup(t, commands = [insta]) {
  clearAutoLinkCache();
  t.after(() => { clearAutoLinkCache(); setHttpClient(axios); });
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  t.mock.method(Command, 'find', () => ({ populate: async () => commands }));
  const calls = [];
  setHttpClient(async options => { calls.push(options); return { data: { data: { medias: [{ link: 'https://cdn.example.com/v.mp4' }] } } }; });
  const sent = [];
  return { calls, sent, sock: { sendMessage: async (jid, payload) => sent.push({ jid, payload }) } };
}

test('matchAutoLink accepts subdomains and ignores other sites', () => {
  assert.equal(matchAutoLink(reel, ['instagram.com']), 'https://www.instagram.com/reel/ABC/?igsh=x');
  assert.equal(matchAutoLink('https://notinstagram.com/x', ['instagram.com']), null);
  assert.equal(matchAutoLink('بدون رابط', ['instagram.com']), null);
});

test('allowed number sharing a link gets the video without a command', async t => {
  const { calls, sent, sock } = setup(t);
  const handled = await handleDashboardAutoLink(sock, '962700000001@s.whatsapp.net', '962700000001@s.whatsapp.net', reel, {});
  assert.equal(handled, true);
  assert.equal(new URL(calls[0].url).searchParams.get('url'), 'https://www.instagram.com/reel/ABC/?igsh=x');
  assert.deepEqual(sent[0].payload.video, { url: 'https://cdn.example.com/v.mp4' });
});

test('a @lid sender is matched through its phone-number alternative', async t => {
  const { sent, sock } = setup(t);
  const msg = { key: { remoteJid: '1234@lid', remoteJidAlt: '962700000001@s.whatsapp.net' } };
  assert.deepEqual(senderPhoneNumbers('1234@lid', msg), ['962700000001']);
  assert.equal(await handleDashboardAutoLink(sock, '1234@lid', '1234@lid', reel, msg), true);
  assert.equal(sent.length, 1);
});

test('other numbers and groups fall through silently', async t => {
  const { calls, sent, sock } = setup(t);
  assert.equal(await handleDashboardAutoLink(sock, '962799999999@s.whatsapp.net', '962799999999@s.whatsapp.net', reel, {}), false);
  assert.equal(await handleDashboardAutoLink(sock, '1203@g.us', '962700000001@s.whatsapp.net', reel, {}), false);
  assert.equal(calls.length, 0);
  assert.equal(sent.length, 0);
});

test('typed command with numbers permission rejects other numbers', async t => {
  const { sent, sock } = setup(t);
  t.mock.method(Command, 'findOne', () => ({ populate: async () => insta }));
  await handleDashboardCommand(sock, '962799999999@s.whatsapp.net', '962799999999@s.whatsapp.net', '/انستا https://instagram.com/p/1', {});
  assert.deepEqual(sent, [{ jid: '962799999999@s.whatsapp.net', payload: { text: 'هذا الأمر غير متاح لك.' } }]);
});

test('validateCommand normalizes numbers and domains', () => {
  const base = { trigger: '/انستا', title: 'انستا', permission: 'numbers', apiId: 'a'.repeat(24) };
  const value = validateCommand({ ...base, allowedNumbers: '+962 7963 91944\n00962700000001', autoLinkDomains: 'https://www.Instagram.com/reel' });
  assert.deepEqual(value.allowedNumbers, ['962796391944', '962700000001']);
  assert.deepEqual(value.autoLinkDomains, ['instagram.com']);
  assert.throws(() => validateCommand({ ...base, allowedNumbers: '' }));
  assert.throws(() => validateCommand({ ...base, permission: 'everyone', apiId: '', autoLinkDomains: 'instagram.com' }));
});
