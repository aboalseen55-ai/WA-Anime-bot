// /portal: each business account logs in with its own username and password, scans its own QR,
// and edits its bot settings. The admin (dashboard password, username "admin") creates and manages accounts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Tenant, TenantContact } from '../../database/tenantModels.js';
import { DEFAULT_TENANT_SETTINGS, TENANT_PRESETS, tenantSettings, validateTenantSettings } from './tenantSettings.js';
import { connectTenant, disconnectTenant, refreshTenant, removeTenantRuntime, tenantStatus } from './tenantManager.js';

const SESSION_MS = 12 * 3600_000;
const COOKIE = 'sam_portal_session';
const assets = new Map([
  ['/portal', ['../../dashboard/portal.html', 'text/html']],
  ['/portal/', ['../../dashboard/portal.html', 'text/html']],
  ['/portal/portal.js', ['../../dashboard/portal.js', 'application/javascript']],
  ['/portal/portal.css', ['../../dashboard/portal.css', 'text/css']]
]);

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), 32);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function sameSecret(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

export function validateNewTenant(input) {
  const slug = String(input.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,31}$/.test(slug) || slug === 'admin') throw new Error('اسم المستخدم: 3-32 حرف إنجليزي صغير أو أرقام أو -');
  const password = String(input.password || '');
  if (password.length < 8 || password.length > 128) throw new Error('كلمة المرور لازم تكون 8 أحرف على الأقل');
  const preset = input.preset ? TENANT_PRESETS[input.preset] : null;
  if (input.preset && !preset) throw new Error('القالب غير موجود');
  const name = String(input.name || preset?.name || '').trim().slice(0, 80);
  if (!name) throw new Error('اسم الحساب مطلوب');
  return { slug, name, passwordHash: hashPassword(password), settings: validateTenantSettings(preset?.settings || {}, DEFAULT_TENANT_SETTINGS) };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function publicTenant(tenant) {
  return { id: String(tenant._id), slug: tenant.slug, name: tenant.name, enabled: tenant.enabled, phone: tenant.phone || '', settings: tenantSettings(tenant), status: tenantStatus(tenant._id) };
}

export function createPortalHandler({ readJson, adminPassword = process.env.DASHBOARD_ADMIN_PASSWORD || '' }) {
  const sessions = new Map();
  const attempts = new Map();

  return async function portal(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/portal' && !url.pathname.startsWith('/portal/')) return false;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");

    try {
      if (assets.has(url.pathname) && req.method === 'GET') {
        const [file, type] = assets.get(url.pathname);
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
        res.end(fs.readFileSync(new URL(file, import.meta.url)));
        return true;
      }
      if (!url.pathname.startsWith('/portal/api/')) { json(res, 404, { error: 'غير موجود' }); return true; }
      const route = url.pathname.slice('/portal/api/'.length);
      const now = Date.now();
      for (const [key, value] of sessions) if (value.expires < now) sessions.delete(key);
      for (const [key, value] of attempts) if (value.expires < now) attempts.delete(key);

      if (route === 'login' && req.method === 'POST') {
        const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',').at(-1).trim();
        const attempt = attempts.get(ip) || { count: 0, expires: now + 900_000 };
        if (attempt.count >= 8 || attempts.size > 10000) { json(res, 429, { error: 'محاولات كثيرة؛ حاول بعد 15 دقيقة' }); return true; }
        const body = await readJson(req);
        const username = String(body.username || '').trim().toLowerCase();
        let session = null;
        if (username === 'admin') {
          if (adminPassword && sameSecret(body.password || '', adminPassword)) session = { role: 'admin', tenantId: null };
        } else if (/^[a-z0-9-]{3,32}$/.test(username)) {
          const tenant = await Tenant.findOne({ slug: username }).lean();
          if (tenant?.enabled && verifyPassword(body.password || '', tenant.passwordHash)) session = { role: 'tenant', tenantId: String(tenant._id) };
        }
        if (!session) { attempt.count += 1; attempts.set(ip, attempt); json(res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }); return true; }
        attempts.delete(ip);
        const id = crypto.randomBytes(32).toString('hex');
        const csrf = crypto.randomBytes(24).toString('hex');
        sessions.set(id, { ...session, csrf, expires: now + SESSION_MS });
        res.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/portal; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`);
        json(res, 200, { csrf, role: session.role });
        return true;
      }

      const sid = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})(?:;|$)`).exec(req.headers.cookie || '')?.[1];
      const session = sessions.get(sid);
      if (!session) { json(res, 401, { error: 'يلزم تسجيل الدخول' }); return true; }
      if (req.method !== 'GET' && req.headers['x-portal-csrf'] !== session.csrf) { json(res, 403, { error: 'انتهت صلاحية الطلب؛ حدّث الصفحة' }); return true; }
      const input = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : {};

      if (route === 'logout' && req.method === 'POST') {
        sessions.delete(sid);
        res.setHeader('Set-Cookie', `${COOKIE}=; Path=/portal; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
        json(res, 200, { ok: true });
        return true;
      }

      // ----- admin: manage accounts -----
      if (route.startsWith('admin/')) {
        if (session.role !== 'admin') { json(res, 403, { error: 'للمسؤول فقط' }); return true; }
        if (route === 'admin/tenants' && req.method === 'GET') {
          const tenants = await Tenant.find({}).sort({ createdAt: 1 }).lean();
          json(res, 200, { tenants: tenants.map(publicTenant), presets: Object.entries(TENANT_PRESETS).map(([key, value]) => ({ key, name: value.name })) });
          return true;
        }
        if (route === 'admin/tenants' && req.method === 'POST') {
          const created = await Tenant.create(validateNewTenant(input));
          json(res, 200, { ok: true, tenant: publicTenant(created.toObject()) });
          return true;
        }
        const match = /^admin\/tenants\/([a-f0-9]{24})(\/open)?$/.exec(route);
        if (match) {
          const tenant = await Tenant.findById(match[1]).lean();
          if (!tenant) { json(res, 404, { error: 'الحساب غير موجود' }); return true; }
          if (match[2] && req.method === 'POST') { session.tenantId = String(tenant._id); json(res, 200, { ok: true }); return true; }
          if (!match[2] && req.method === 'PUT') {
            const set = {};
            if (Object.hasOwn(input, 'enabled')) set.enabled = input.enabled !== false;
            if (input.password) set.passwordHash = validateNewTenant({ slug: tenant.slug, name: tenant.name, password: input.password }).passwordHash;
            if (input.name) set.name = String(input.name).trim().slice(0, 80);
            await Tenant.updateOne({ _id: tenant._id }, { $set: set });
            await refreshTenant(tenant._id);
            json(res, 200, { ok: true });
            return true;
          }
          if (!match[2] && req.method === 'DELETE') {
            await removeTenantRuntime(tenant._id);
            await Promise.all([Tenant.deleteOne({ _id: tenant._id }), TenantContact.deleteMany({ tenantId: tenant._id })]);
            if (session.tenantId === String(tenant._id)) session.tenantId = null;
            json(res, 200, { ok: true });
            return true;
          }
        }
        json(res, 404, { error: 'غير موجود' });
        return true;
      }

      if (route === 'me' && req.method === 'GET') {
        const tenant = session.tenantId ? await Tenant.findById(session.tenantId).lean() : null;
        json(res, 200, { role: session.role, csrf: session.csrf, tenant: tenant ? publicTenant(tenant) : null });
        return true;
      }

      // ----- the signed-in account (or the account the admin opened) -----
      if (!session.tenantId) { json(res, 400, { error: 'اختر حساب أولاً' }); return true; }
      const tenantId = session.tenantId;
      if (route === 'status' && req.method === 'GET') { json(res, 200, tenantStatus(tenantId)); return true; }
      if (route === 'connect' && req.method === 'POST') { json(res, 200, await connectTenant(tenantId)); return true; }
      if (route === 'disconnect' && req.method === 'POST') { await disconnectTenant(tenantId); json(res, 200, { ok: true }); return true; }
      if (route === 'settings' && req.method === 'PUT') {
        const tenant = await Tenant.findById(tenantId).lean();
        if (!tenant) { json(res, 404, { error: 'الحساب غير موجود' }); return true; }
        const settings = validateTenantSettings(input, tenantSettings(tenant));
        await Tenant.updateOne({ _id: tenantId }, { $set: { settings } });
        await refreshTenant(tenantId);
        json(res, 200, { ok: true, settings });
        return true;
      }
      if (route === 'chats' && req.method === 'GET') {
        const chats = await TenantContact.find({ tenantId }).sort({ lastMessageAt: -1 }).limit(50).lean();
        json(res, 200, {
          chats: chats.map(chat => ({
            jid: chat.jid, name: chat.arabicName || chat.pushName || chat.phone || 'زبون', phone: chat.phone,
            lastMessageAt: chat.lastMessageAt, pausedUntil: chat.pausedUntil, handoffAt: chat.handoffAt, handoffSummary: chat.handoffSummary,
            messageCount: chat.messageCount, last: chat.history?.slice(-4) || []
          }))
        });
        return true;
      }
      if (route === 'chats/resume' && req.method === 'POST') {
        await TenantContact.updateOne({ tenantId, jid: String(input.jid || '') }, { $set: { pausedUntil: null } });
        json(res, 200, { ok: true });
        return true;
      }
      json(res, 404, { error: 'غير موجود' });
      return true;
    } catch (error) {
      json(res, 400, { error: error.code === 11000 ? 'اسم المستخدم مستخدم من قبل' : error.name === 'Error' ? error.message : 'تعذر تنفيذ الطلب' });
      return true;
    }
  };
}
