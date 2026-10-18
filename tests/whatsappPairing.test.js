import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setPairingQr, clearPairingQr, invalidatePairingQr, pairingSnapshot } from '../services/whatsappPairing.js';
import { createDashboardHandler } from '../services/dashboardServer.js';

const QR = '2@fake-ref,fake-noise-key,fake-identity-key,fake-adv-secret';

test('only the latest QR is kept, rendered as an SVG image', async () => {
  clearPairingQr();
  await setPairingQr(QR + '-1', { now: 1000 });
  const first = pairingSnapshot({ connected: false }, 1000);
  await setPairingQr(QR + '-2', { now: 2000 });
  const second = pairingSnapshot({ connected: false }, 2000);
  assert.equal(second.status, 'qr');
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.image, first.image);
  assert.match(second.image, /^data:image\/svg\+xml;base64,/);
  assert.match(Buffer.from(second.image.split(',')[1], 'base64').toString(), /<svg/);
  assert.equal(JSON.stringify(second).includes('fake-noise-key'), false);
  clearPairingQr();
});

test('QR is wiped when it expires or the bot connects', async () => {
  await setPairingQr(QR, { now: 0, ttlMs: 5000 });
  assert.equal(pairingSnapshot({ connected: false }, 4000).status, 'qr');
  assert.equal(pairingSnapshot({ connected: false }, 5000).status, 'waiting');

  await setPairingQr(QR, { now: 0 });
  assert.deepEqual(pairingSnapshot({ connected: true, connection: 'open' }, 1), { status: 'connected', connection: 'open' });
  assert.equal(pairingSnapshot({ connected: false }, 2).status, 'waiting');

  const pending = setPairingQr(QR);
  invalidatePairingQr();
  await pending;
  assert.equal(pairingSnapshot({ connected: false }).status, 'waiting');
});

test('pairing page needs a dashboard login and works while disconnected', async t => {
  clearPairingQr();
  await setPairingQr(QR);
  t.after(clearPairingQr);
  const server = http.createServer(createDashboardHandler({ getBotStatus: () => ({ connected: false, connection: 'connecting' }), password: 'fixture-password' }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port + '/dashboard';

  const anonymous = await fetch(base + '/api/pairing');
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.text()).includes('svg'), false);
  assert.equal((await fetch(base + '/api/pairing', { headers: { cookie: 'sam_dashboard_session=' + 'a'.repeat(64) } })).status, 401);

  assert.equal((await fetch(base)).status, 200);
  const login = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ password: 'fixture-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const pairing = await fetch(base + '/api/pairing', { headers: { cookie } });
  assert.equal(pairing.status, 200);
  assert.equal(pairing.headers.get('cache-control'), 'no-store');
  const body = await pairing.json();
  assert.equal(body.status, 'qr');
  assert.match(body.image, /^data:image\/svg\+xml;base64,/);

  const state = await fetch(base + '/api/state', { headers: { cookie } });
  assert.equal(state.status, 503);
  assert.equal((await state.json()).code, 'not_connected');
});
