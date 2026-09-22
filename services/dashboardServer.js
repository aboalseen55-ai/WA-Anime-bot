import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import DashboardCommand from '../database/dashboardCommandModel.js';
import DashboardApi from '../database/dashboardApiModel.js';
import DashboardTemplate from '../database/dashboardTemplateModel.js';
import { encryptDashboardValue, isDashboardEncryptionConfigured } from './dashboardCrypto.js';
import { dashboardRead, dashboardWrite, isReservedCommand, audit } from './dashboardData.js';
import { TEMPLATE_DEFINITIONS, validateTemplate, refreshDashboardTemplates } from './dashboardTemplates.js';
import { validateEndpoint } from './dashboardApiSafety.js';

const assets = new Map([
  ['/dashboard', ['../dashboard/index.html', 'text/html']],
  ['/dashboard/', ['../dashboard/index.html', 'text/html']],
  ['/dashboard/app.js', ['../dashboard/app.js', 'application/javascript']],
  ['/dashboard/style.css', ['../dashboard/style.css', 'text/css']],
  ['/dashboard/icons.js', ['../node_modules/lucide/dist/umd/lucide.min.js', 'application/javascript']]
]);
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
export function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, oversized = false; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > 120000) { oversized = true; chunks.length = 0; } else if (!oversized) chunks.push(chunk); });
    req.on('end', () => {
      if (oversized) return reject(new Error('الطلب أكبر من الحد المسموح'));
      try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); resolve(value); }
      catch { reject(new Error('صيغة البيانات غير صحيحة')); }
    }); req.on('error', reject); req.on('aborted', () => reject(new Error('انقطع الطلب')));
  });
}
export function validateCommand(input) {
  const trigger = String(input.trigger || '').trim().toLowerCase();
  if (!/^\/[\p{L}\p{N}_-]{1,48}$/u.test(trigger)) throw new Error('صيغة الأمر غير صالحة');
  if (isReservedCommand(trigger)) throw new Error('هذا أمر أصلي؛ عدّل نصه من قسم الردود');
  if (!String(input.title || '').trim() || String(input.title).length > 80) throw new Error('اسم الأمر مطلوب وبحد أقصى 80 حرف');
  if (!['everyone', 'moderator', 'developer'].includes(input.permission)) throw new Error('الصلاحية غير صالحة');
  if (input.apiId && !/^[a-f0-9]{24}$/i.test(input.apiId)) throw new Error('الخدمة غير صالحة');
  const responsePath = String(input.responsePath || '').trim();
  if (responsePath.split('.').some(key => ['__proto__','prototype','constructor'].includes(key))) throw new Error('مسار النتيجة غير صالح');
  return { trigger, title: String(input.title).trim(), responseTemplate: String(input.responseTemplate || ''), permission: input.permission, apiId: input.apiId || null, responsePath, enabled: input.enabled !== false };
}
export function validateApi(input) {
  const endpoint = validateEndpoint(String(input.endpoint || '')).toString();
  const name = String(input.name || '').trim();
  if (!name || name.length > 80) throw new Error('اسم الخدمة مطلوب وبحد أقصى 80 حرف');
  if (!['GET','POST'].includes(input.method)) throw new Error('طريقة الطلب غير صالحة');
  const result = { name, endpoint, method: input.method, timeoutMs: Math.max(1000, Math.min(30000, Number(input.timeoutMs) || 12000)), enabled: input.enabled !== false };
  for (const [field, destination] of [['headers','encryptedHeaders'],['body','encryptedBody']]) {
    if (Object.hasOwn(input, field)) {
      if (!input[field] || typeof input[field] !== 'object' || Array.isArray(input[field])) throw new Error('الحقول المتقدمة يجب أن تكون JSON object');
      result[destination] = encryptDashboardValue(input[field]);
    }
  }
  return result;
}

export function createDashboardHandler({ getBotStatus, getGroups, onKingdomChange, password = process.env.DASHBOARD_ADMIN_PASSWORD || '' }) {
  const sessions = new Map(), attempts = new Map();
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/dashboard')) return json(res,404,{error:'غير موجود'});
      if (!getBotStatus().connected) return json(res,503,{error:'البوت غير متصل بواتساب؛ اللوحة غير متاحة حاليًا'});
      if (!password) return json(res,503,{error:'كلمة مرور اللوحة غير مضبوطة'});
      const now = Date.now();
      for (const [id,s] of sessions) if (s.expires < now) sessions.delete(id);
      for (const [id,s] of attempts) if (s.expires < now) attempts.delete(id);
      if (assets.has(url.pathname) && req.method === 'GET') {
        const [file,type] = assets.get(url.pathname);
        const content=fs.readFileSync(new URL(file, import.meta.url));
        res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(content); return;
      }
      const route = url.pathname.replace('/dashboard/api/','');
      if (route === 'login' && req.method === 'POST') {
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').at(-1).trim();
        const attempt = attempts.get(ip) || { count: 0, expires: now + 900000 };
        if (attempt.count >= 8 || attempts.size > 10000) return json(res,429,{error:'محاولات كثيرة؛ حاول بعد 15 دقيقة'});
        const body = await readJson(req);
        const a = crypto.createHash('sha256').update(String(body.password || '')).digest(), b = crypto.createHash('sha256').update(password).digest();
        if (!crypto.timingSafeEqual(a,b)) { attempt.count++; attempts.set(ip,attempt); return json(res,401,{error:'كلمة المرور غير صحيحة'}); }
        attempts.delete(ip); const id = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(24).toString('hex');
        sessions.set(id,{csrf,expires:now+28800000});
        res.setHeader('Set-Cookie',`sam_dashboard_session=${id}; Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);
        return json(res,200,{csrf});
      }
      const id = /(?:^|;\s*)sam_dashboard_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1], session = sessions.get(id);
      if (!session) return json(res,401,{error:'يلزم تسجيل الدخول'});
      if (req.method !== 'GET' && req.headers['x-dashboard-csrf'] !== session.csrf) return json(res,403,{error:'انتهت صلاحية الطلب؛ حدّث الصفحة'});
      if (route === 'logout' && req.method === 'POST') { sessions.delete(id); res.setHeader('Set-Cookie','sam_dashboard_session=; Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=0'); return json(res,200,{ok:true}); }
      if (req.method === 'GET') {
        if (route === 'groups') return json(res,200,{groups:getGroups?await getGroups():[]});
        if (route === 'state') {
          const [commands,apis] = await Promise.all([DashboardCommand.find({}).sort({trigger:1}).limit(1000).lean(),DashboardApi.find({}).sort({name:1}).limit(1000).lean()]);
          return json(res,200,{csrf:session.csrf,status:getBotStatus(),commands,apis:apis.map(({encryptedHeaders,encryptedBody,...api})=>({...api,hasHeaders:Boolean(encryptedHeaders),hasBody:Boolean(encryptedBody)})),encryptionReady:isDashboardEncryptionConfigured()});
        }
        if (route === 'templates') {
          const rows = await DashboardTemplate.find({}).lean(), edits = new Map(rows.map(r=>[r.key,r]));
          return json(res,200,{templates:Object.entries(TEMPLATE_DEFINITIONS).map(([key,value])=>({key,...value,text:edits.get(key)?.text || value.sample,customized:edits.has(key)}))});
        }
        const data = await dashboardRead(url); if (data) return json(res,200,data);
      }
      const input = ['POST','PUT','DELETE'].includes(req.method) ? await readJson(req) : {};
      const data = await dashboardWrite(route,req.method,input,onKingdomChange,getGroups); if(data) return json(res,200,data);
      const template = /^templates\/([a-zA-Z0-9_]+)$/.exec(route);
      if (template && ['PUT','DELETE'].includes(req.method)) {
        const key = template[1]; if(!TEMPLATE_DEFINITIONS[key]) throw new Error('القالب غير موجود');
        if(req.method==='PUT') await DashboardTemplate.updateOne({key},{$set:{text:validateTemplate(key,input.text)}},{upsert:true,runValidators:true}); else await DashboardTemplate.deleteOne({key});
        await refreshDashboardTemplates(); await audit('template_'+(req.method==='PUT'?'updated':'restored'),key); return json(res,200,{ok:true});
      }
      const entity = /^(commands|apis)(?:\/([a-f0-9]{24}))?$/.exec(route);
      if(entity && ['POST','PUT','DELETE'].includes(req.method)) {
        const [,kind,target] = entity, Model=kind==='commands'?DashboardCommand:DashboardApi;
        if((req.method==='POST' && target)||(req.method!=='POST'&&!target)) throw new Error('طلب غير صالح');
        if(target && !await Model.exists({_id:target})) return json(res,404,{error:'العنصر غير موجود'});
        if(req.method==='DELETE') {
          if(kind==='apis' && await DashboardCommand.exists({apiId:target})) throw new Error('الخدمة مرتبطة بأمر؛ أزل الربط قبل حذفها');
          await Model.deleteOne({_id:target});
        } else {
          if(kind==='apis'&&!isDashboardEncryptionConfigured()) throw new Error('مفتاح تشفير الخدمات غير مضبوط');
          const values=kind==='commands'?validateCommand(input):validateApi(input);
          if(kind==='commands'&&values.apiId&&!await DashboardApi.exists({_id:values.apiId})) throw new Error('الخدمة غير موجودة');
          if(target) await Model.updateOne({_id:target},{$set:values},{runValidators:true}); else await Model.create(values);
        }
        await audit(kind+'_'+req.method.toLowerCase(),target||input.trigger||input.name); return json(res,200,{ok:true});
      }
      return json(res,404,{error:'غير موجود'});
    } catch(error) {
      if(error.name!=='Error') console.warn('Dashboard request failed:',error.name);
      json(res,400,{error:error.code===11000?'الاسم أو الأمر مستخدم بالفعل':error.name==='Error'?error.message:'تعذر حفظ البيانات؛ تحقق من الحقول وحاول مجددًا'});
    }
  };
}
export function startDashboardServer(options) {
  const server = http.createServer(createDashboardHandler(options)); server.requestTimeout = 30000; server.headersTimeout = 15000;
  server.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log('Dashboard server ready')); return server;
}
