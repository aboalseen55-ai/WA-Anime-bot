import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clearWhatsAppAuth, isLoggedOutDisconnect } from '../services/whatsappAuth.js';

test('401 (logged out / device removed) is treated as a logout, other codes are not', () => {
  assert.equal(isLoggedOutDisconnect(401), true);
  for (const code of [403, 405, 408, 428, 440, 500, 503, null]) assert.equal(isLoggedOutDisconnect(code), false);
});

test('clearing auth removes session files but keeps the reset marker', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-auth-'));
  await fs.writeFile(path.join(dir, 'creds.json'), '{}');
  await fs.writeFile(path.join(dir, 'pre-key-1.json'), '{}');
  await fs.mkdir(path.join(dir, 'sub'));
  await fs.writeFile(path.join(dir, '.auth-reset-token'), 'abc');
  const removed = await clearWhatsAppAuth(dir, { keep: ['.auth-reset-token'] });
  assert.equal(removed, 3);
  assert.deepEqual(await fs.readdir(dir), ['.auth-reset-token']);
  await fs.rm(dir, { recursive: true, force: true });
});

test('clearing a missing auth dir is a no-op', async () => {
  assert.equal(await clearWhatsAppAuth(path.join(os.tmpdir(), 'wa-auth-missing-' + Date.now())), 0);
});
