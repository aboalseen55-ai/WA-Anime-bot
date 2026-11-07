// Runs one Baileys socket per business account, next to the main Sam bot.
// Sessions live in MongoDB (see mongoAuthState.js), so they survive restarts without a volume.
import makeWASocket, { downloadMediaMessage, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { Tenant } from '../../database/tenantModels.js';
import { mongoAuthStore, useMongoAuthState } from './mongoAuthState.js';
import { createTenantMessageHandler } from './tenantMessages.js';
import { generateSamBotAIFromParts } from '../../utils/samBotAI.js';
import { createVoiceNote, isElevenLabsConfigured } from '../elevenLabsService.js';

const QR_TTL_MS = 60_000;
const BASE_RECONNECT_MS = 5000;
const MAX_RECONNECT_MS = 60000;
const LOGGED_OUT = 401;

const runtimes = new Map();
let versionPromise = null;

function getVersion() {
  if (!versionPromise) {
    versionPromise = Promise.race([
      fetchLatestBaileysVersion().then(result => result.version),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
    ]).catch(() => { versionPromise = null; return [2, 3000, 1043857760]; });
  }
  return versionPromise;
}

function runtimeFor(tenantId) {
  const id = String(tenantId);
  if (!runtimes.has(id)) runtimes.set(id, { id, sock: null, connection: 'idle', qr: null, starting: false, reconnectTimer: null, attempts: 0, tenant: null, handler: null, error: '' });
  return runtimes.get(id);
}

async function loadTenant(runtime) {
  const tenant = await Tenant.findById(runtime.id).lean();
  runtime.tenant = tenant;
  return tenant;
}

function statusCodeOf(error) {
  return error?.output?.statusCode || error?.statusCode || error?.data?.statusCode || null;
}

async function startSocket(runtime, { pairing = false } = {}) {
  if (runtime.starting || runtime.sock) return;
  runtime.starting = true;
  try {
    const tenant = await loadTenant(runtime);
    if (!tenant?.enabled) { runtime.connection = 'disabled'; return; }
    const auth = await useMongoAuthState(runtime.id);
    if (!auth.hasSession() && !pairing) { runtime.connection = 'idle'; return; }

    const sock = makeWASocket({
      version: await getVersion(),
      auth: auth.state,
      logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || 'warn' }),
      generateHighQualityLinkPreview: false,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });
    runtime.sock = sock;
    runtime.connection = 'connecting';
    runtime.error = '';

    if (!runtime.handler) {
      runtime.handler = createTenantMessageHandler({
        getTenant: () => runtime.tenant,
        getSock: () => (runtime.connection === 'open' ? runtime.sock : null),
        generate: ({ systemInstruction, parts }) => generateSamBotAIFromParts({ systemInstruction, parts, temperature: 0.7, maxOutputTokens: 700, json: true }),
        createVoice: isElevenLabsConfigured() ? (text, { voiceId }) => createVoiceNote(text, { voiceId }) : null,
        download: msg => downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: runtime.sock?.updateMediaMessage })
      });
    }

    sock.ev.on('creds.update', auth.saveCreds);
    sock.ev.on('messages.upsert', event => {
      runtime.handler.onMessages(event).catch(error => console.error(`Tenant ${runtime.tenant?.slug}: message handling failed:`, error.message));
    });
    sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
      if (qr) {
        try {
          const svg = await QRCode.toString(qr, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
          runtime.qr = { image: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), expiresAt: Date.now() + QR_TTL_MS };
        } catch { runtime.qr = null; }
      }
      if (connection === 'open') {
        runtime.connection = 'open';
        runtime.qr = null;
        runtime.attempts = 0;
        const phone = String(sock.user?.id || '').split(':')[0].split('@')[0];
        await Tenant.updateOne({ _id: runtime.id }, { $set: { phone, lastConnectedAt: new Date() } }).catch(() => {});
        console.log(`✅ Business account ${runtime.tenant?.slug} connected to WhatsApp`);
      }
      if (connection === 'close') {
        if (runtime.sock === sock) runtime.sock = null;
        runtime.qr = null;
        const code = statusCodeOf(lastDisconnect?.error);
        sock.ev.removeAllListeners('creds.update');
        if (code === LOGGED_OUT) {
          // the phone removed the linked device: the session is dead, wait for a new scan from the portal
          await auth.clear().catch(() => {});
          runtime.connection = 'logged_out';
          console.log(`🚪 Business account ${runtime.tenant?.slug} was logged out of WhatsApp.`);
          return;
        }
        if (!auth.hasSession()) {
          // QR was never scanned in time: stop instead of generating codes forever
          runtime.connection = 'idle';
          return;
        }
        runtime.connection = 'reconnecting';
        scheduleReconnect(runtime);
      }
    });
  } catch (error) {
    runtime.connection = 'error';
    runtime.error = error.message;
    console.error(`Tenant ${runtime.id}: start failed:`, error.message);
  } finally {
    runtime.starting = false;
  }
}

function scheduleReconnect(runtime) {
  if (runtime.reconnectTimer) return;
  runtime.attempts += 1;
  const delay = Math.min(BASE_RECONNECT_MS * runtime.attempts, MAX_RECONNECT_MS);
  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null;
    startSocket(runtime);
  }, delay);
  runtime.reconnectTimer.unref?.();
}

/** Starts every enabled account that already has a WhatsApp session. */
export async function startAllTenants() {
  if (String(process.env.TENANTS_ENABLED || '').toLowerCase() === 'false') return;
  const tenants = await Tenant.find({ enabled: true }).select('_id slug').lean();
  for (const tenant of tenants) await startSocket(runtimeFor(tenant._id));
  if (tenants.length) console.log(`🏪 Business accounts loaded: ${tenants.length}`);
}

/** Opens a socket that shows a QR in the portal (or reconnects if a session exists). */
export async function connectTenant(tenantId) {
  const runtime = runtimeFor(tenantId);
  if (runtime.sock && runtime.connection === 'open') return tenantStatus(tenantId);
  if (runtime.sock && !runtime.qr) { try { runtime.sock.end?.(); } catch { /* ignore */ } runtime.sock = null; }
  await startSocket(runtime, { pairing: true });
  return tenantStatus(tenantId);
}

/** Logs the number out of WhatsApp and deletes its session. */
export async function disconnectTenant(tenantId) {
  const runtime = runtimeFor(tenantId);
  if (runtime.reconnectTimer) { clearTimeout(runtime.reconnectTimer); runtime.reconnectTimer = null; }
  const sock = runtime.sock;
  runtime.sock = null;
  if (sock) {
    sock.ev.removeAllListeners('connection.update');
    sock.ev.removeAllListeners('creds.update');
    try { await sock.logout(); } catch { try { sock.end?.(); } catch { /* ignore */ } }
  }
  await mongoAuthStore.clear(String(tenantId));
  runtime.connection = 'idle';
  runtime.qr = null;
  await Tenant.updateOne({ _id: tenantId }, { $set: { phone: '' } }).catch(() => {});
}

/** Reloads settings after the portal saves them, and stops a disabled account. */
export async function refreshTenant(tenantId) {
  const runtime = runtimeFor(tenantId);
  const tenant = await loadTenant(runtime);
  if (!tenant?.enabled && runtime.sock) {
    runtime.sock.ev.removeAllListeners('connection.update');
    try { runtime.sock.end?.(); } catch { /* ignore */ }
    runtime.sock = null;
    runtime.connection = 'disabled';
  }
}

export function tenantStatus(tenantId) {
  const runtime = runtimes.get(String(tenantId));
  if (!runtime) return { connection: 'idle' };
  if (runtime.qr && runtime.qr.expiresAt <= Date.now()) runtime.qr = null;
  return {
    connection: runtime.connection,
    phone: runtime.connection === 'open' ? String(runtime.sock?.user?.id || '').split(':')[0].split('@')[0] : '',
    qr: runtime.qr ? { image: runtime.qr.image, expiresIn: runtime.qr.expiresAt - Date.now() } : null,
    error: runtime.error || ''
  };
}

export async function removeTenantRuntime(tenantId) {
  await disconnectTenant(tenantId);
  runtimes.delete(String(tenantId));
}
