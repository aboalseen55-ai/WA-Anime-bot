import test from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardUrl, handleDashboardLinkCommand, isDashboardLinkRequest } from '../utils/dashboardLink.js';

const dev = '962790000000@s.whatsapp.net';
const fakeSock = () => { const sent = []; return { sent, sendMessage: async (to, content) => sent.push({ to, text: content.text }) }; };

test('dashboard link requests are recognised as a command or a short phrase', () => {
  for (const text of ['/داشبورد', '/dashboard', 'اعطيني الداشبورد', 'لينك لوحة التحكم']) assert.equal(isDashboardLinkRequest(text), true, text);
  for (const text of ['/حالة', 'مرحبا', 'x'.repeat(40) + ' داشبورد ' + 'y'.repeat(20)]) assert.equal(isDashboardLinkRequest(text), false, text);
});

test('dashboard url prefers DASHBOARD_URL, then the Railway domain', () => {
  assert.equal(getDashboardUrl({ DASHBOARD_URL: 'https://x.dev/dashboard/' }), 'https://x.dev/dashboard/');
  assert.equal(getDashboardUrl({ RAILWAY_PUBLIC_DOMAIN: 'fun.up.railway.app' }), 'https://fun.up.railway.app/dashboard/');
  assert.equal(getDashboardUrl({}), 'https://sambot.up.railway.app/dashboard/');
});

test('only the developer gets the link, and in a group it goes to their DM', async () => {
  const env = {};
  const sock = fakeSock();
  assert.equal(await handleDashboardLinkCommand(sock, 'other@s.whatsapp.net', 'other@s.whatsapp.net', '/داشبورد', { developers: [dev], env }), false);
  assert.equal(sock.sent.length, 0);

  assert.equal(await handleDashboardLinkCommand(sock, dev, dev, 'اعطيني الداشبورد', { developers: [dev], env }), true);
  assert.equal(sock.sent[0].to, dev);
  assert.match(sock.sent[0].text, /sambot\.up\.railway\.app\/dashboard\//);

  const group = fakeSock();
  await handleDashboardLinkCommand(group, '123@g.us', dev, '/داشبورد', { developers: [dev], env });
  assert.equal(group.sent[0].to, dev);
  assert.doesNotMatch(group.sent[1].text, /railway/);
});
