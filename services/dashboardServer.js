import http from "http";
import crypto from "crypto";
import DashboardCommand from "../database/dashboardCommandModel.js";
import DashboardApi from "../database/dashboardApiModel.js";
import { encryptDashboardValue, isDashboardEncryptionConfigured } from "./dashboardCrypto.js";
import { DASHBOARD_THEME } from "./dashboardTheme.js";

const sessions = new Map();
const loginAttempts = new Map();
const MAX_BODY_BYTES = 120_000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 8;

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((item) => {
    const [key, ...value] = item.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }).filter(([key]) => key));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let content = "";
    request.on("data", (chunk) => {
      content += chunk;
      if (content.length > MAX_BODY_BYTES) reject(new Error("الطلب كبير جداً"));
    });
    request.on("end", () => {
      try { resolve(content ? JSON.parse(content) : {}); } catch { reject(new Error("صيغة البيانات غير صحيحة")); }
    });
    request.on("error", reject);
  });
}

function getClientIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function makeSession() {
  const id = crypto.randomBytes(32).toString("base64url");
  const csrf = crypto.randomBytes(24).toString("base64url");
  sessions.set(id, { csrf, expiresAt: Date.now() + SESSION_TTL_MS });
  return { id, csrf };
}

function getSession(request) {
  const id = parseCookies(request).sam_dashboard_session;
  const session = id && sessions.get(id);
  if (!session || session.expiresAt < Date.now()) {
    if (id) sessions.delete(id);
    return null;
  }
  return { id, ...session };
}

function authenticate(request, res) {
  const session = getSession(request);
  if (!session) { json(res, 401, { error: "يلزم تسجيل الدخول" }); return null; }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers["x-dashboard-csrf"] !== session.csrf) {
    json(res, 403, { error: "طلب غير صالح" });
    return null;
  }
  return session;
}

function dashboardHtml() {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sam Bot Control</title><style>
  :root{color-scheme:dark;--bg:#111317;--panel:#1b1f25;--line:#303742;--text:#f4f6f8;--muted:#9aa6b5;--green:#22c55e;--red:#ef4444;--blue:#38bdf8}*{box-sizing:border-box}body{margin:0;font:15px system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}header{height:64px;padding:0 5vw;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:#15181d;position:sticky;top:0}main{max-width:1180px;margin:36px auto;padding:0 20px}.brand{font-weight:800;font-size:19px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--red);margin-left:8px}.dot.online{background:var(--green)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:20px}.wide{grid-column:1/-1}h1,h2{margin:0 0 8px}h1{font-size:25px}h2{font-size:18px}.muted{color:var(--muted);line-height:1.65}input,select,textarea,button{font:inherit}input,select,textarea{width:100%;padding:11px;border:1px solid var(--line);border-radius:6px;background:#11151a;color:var(--text)}textarea{min-height:92px;resize:vertical}label{display:block;margin:12px 0 6px;color:var(--muted);font-size:13px}.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.row3{display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px}button{border:0;border-radius:6px;background:var(--green);color:#06250f;font-weight:800;padding:11px 15px;cursor:pointer}button.secondary{background:#26303b;color:var(--text)}button.danger{background:#4b2024;color:#ffd8d8}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.item{border-top:1px solid var(--line);padding:14px 0;display:flex;align-items:center;justify-content:space-between;gap:12px}.item:first-child{border-top:0}.tag{font-size:12px;color:#b9dffa;background:#12334a;padding:4px 8px;border-radius:99px}#login{max-width:420px;margin:12vh auto}.hidden{display:none!important}.notice{min-height:22px;color:#ffd283;margin:12px 0}.status{padding:10px 12px;border:1px solid var(--line);border-radius:6px;color:var(--muted)}@media(max-width:760px){.grid,.row,.row3{grid-template-columns:1fr}main{margin:22px auto}.wide{grid-column:auto}}
  </style></head><body><section id="login" class="card"><h1>Sam Bot Control</h1><p class="muted">لوحة المطور الخاصة</p><label>كلمة مرور اللوحة</label><input id="password" type="password" autocomplete="current-password"><div id="loginNotice" class="notice"></div><button onclick="login()">دخول</button></section><div id="app" class="hidden"><header><div class="brand"><i id="dot" class="dot"></i>Sam Bot Control</div><button class="secondary" onclick="logout()">خروج</button></header><main><div class="grid"><section class="card wide"><h1>لوحة التحكم</h1><div id="status" class="status">جارٍ التحقق من حالة البوت...</div></section><section class="card"><h2>إضافة أمر</h2><label>الأمر</label><input id="cmdTrigger" placeholder="/مثال"><label>الاسم الظاهر</label><input id="cmdTitle" placeholder="رد سريع"><label>الرد</label><textarea id="cmdReply" placeholder="أهلًا {name}"></textarea><div class="row"><div><label>الصلاحية</label><select id="cmdPermission"><option value="everyone">الجميع</option><option value="moderator">المشرفون</option><option value="developer">المطور فقط</option></select></div><div><label>واجهة API اختيارية</label><select id="cmdApi"><option value="">بدون API</option></select></div></div><label>مسار النتيجة من API</label><input id="cmdPath" placeholder="data.message"><div class="actions"><button onclick="saveCommand()">حفظ الأمر</button><button class="secondary" onclick="clearCommand()">جديد</button></div></section><section class="card"><h2>إضافة API</h2><label>الاسم</label><input id="apiName" placeholder="اسم الخدمة"><div class="row"><div><label>الطريقة</label><select id="apiMethod"><option>GET</option><option>POST</option></select></div><div><label>المهلة بالمللي ثانية</label><input id="apiTimeout" type="number" value="12000" min="1000" max="30000"></div></div><label>رابط HTTPS</label><input id="apiEndpoint" placeholder="https://api.example.com/v1/data"><label>Headers بصيغة JSON</label><textarea id="apiHeaders" placeholder='{"Authorization":"Bearer SECRET"}'></textarea><label>Body بصيغة JSON (اختياري)</label><textarea id="apiBody" placeholder='{"query":"hello"}'></textarea><div class="actions"><button onclick="saveApi()">حفظ API</button><button class="secondary" onclick="clearApi()">جديد</button></div></section><section class="card wide"><h2>الأوامر المضافة</h2><div id="commands"></div></section><section class="card wide"><h2>واجهات API</h2><p class="muted">المفاتيح لا تُعرض بعد الحفظ.</p><div id="apis"></div></section></div></main></div><script>
let csrf='',editingCommand='',editingApi='',state={commands:[],apis:[]};const $=id=>document.getElementById(id);async function request(path,opt={}){const r=await fetch('/dashboard/api/'+path,{headers:{'Content-Type':'application/json','X-Dashboard-CSRF':csrf,...(opt.headers||{})},...opt});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'تعذر إكمال الطلب');return data}function notice(id,text){$(id).textContent=text}async function login(){try{const d=await request('login',{method:'POST',body:JSON.stringify({password:$('password').value})});csrf=d.csrf;$('login').classList.add('hidden');$('app').classList.remove('hidden');await load()}catch(e){notice('loginNotice',e.message)}}async function logout(){await request('logout',{method:'POST'}).catch(()=>{});location.reload()}function render(){const online=state.status?.connected;$('dot').className='dot '+(online?'online':'');$('status').textContent=online?'البوت متصل بواتساب واللوحة مفعّلة.':'البوت غير متصل؛ التحكم معطّل.';$('commands').innerHTML=state.commands.length?state.commands.map(x=>'<div class="item"><div><b>'+escapeHtml(x.trigger)+'</b> <span class="tag">'+escapeHtml(x.permission)+'</span><div class="muted">'+escapeHtml(x.description||x.title)+'</div></div><div class="actions"><button class="secondary" onclick="editCommand(\''+x._id+'\')">تعديل</button><button class="danger" onclick="deleteCommand(\''+x._id+'\')">حذف</button></div></div>').join(''):'<p class="muted">لا توجد أوامر مضافة.</p>';$('apis').innerHTML=state.apis.length?state.apis.map(x=>'<div class="item"><div><b>'+escapeHtml(x.name)+'</b> <span class="tag">'+escapeHtml(x.method)+'</span><div class="muted">'+escapeHtml(x.endpoint)+'</div></div><div class="actions"><button class="secondary" onclick="editApi(\''+x._id+'\')">تعديل</button><button class="danger" onclick="deleteApi(\''+x._id+'\')">حذف</button></div></div>').join(''):'<p class="muted">لا توجد واجهات API محفوظة.</p>';$('cmdApi').innerHTML='<option value="">بدون API</option>'+state.apis.map(x=>'<option value="'+x._id+'">'+escapeHtml(x.name)+'</option>').join('')}function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}async function load(){state=await request('state');render()}function clearCommand(){editingCommand='';['cmdTrigger','cmdTitle','cmdReply','cmdPath'].forEach(id=>$(id).value='');$('cmdPermission').value='everyone';$('cmdApi').value=''}function clearApi(){editingApi='';['apiName','apiEndpoint','apiHeaders','apiBody'].forEach(id=>$(id).value='');$('apiMethod').value='GET';$('apiTimeout').value='12000'}async function saveCommand(){const body={trigger:$('cmdTrigger').value,title:$('cmdTitle').value,responseTemplate:$('cmdReply').value,permission:$('cmdPermission').value,apiId:$('cmdApi').value||null,responsePath:$('cmdPath').value};try{await request('commands'+(editingCommand?'/'+editingCommand:''),{method:editingCommand?'PUT':'POST',body:JSON.stringify(body)});clearCommand();await load()}catch(e){alert(e.message)}}async function saveApi(){let headers={},body={};try{headers=$('apiHeaders').value?JSON.parse($('apiHeaders').value):{};body=$('apiBody').value?JSON.parse($('apiBody').value):{}}catch{alert('تحقق من صيغة JSON');return}try{await request('apis'+(editingApi?'/'+editingApi:''),{method:editingApi?'PUT':'POST',body:JSON.stringify({name:$('apiName').value,endpoint:$('apiEndpoint').value,method:$('apiMethod').value,timeoutMs:Number($('apiTimeout').value),headers,body})});clearApi();await load()}catch(e){alert(e.message)}}function editCommand(id){const x=state.commands.find(a=>a._id===id);editingCommand=id;$('cmdTrigger').value=x.trigger;$('cmdTitle').value=x.title;$('cmdReply').value=x.responseTemplate;$('cmdPermission').value=x.permission;$('cmdApi').value=x.apiId||'';$('cmdPath').value=x.responsePath||'';scrollTo({top:0,behavior:'smooth'})}function editApi(id){const x=state.apis.find(a=>a._id===id);editingApi=id;$('apiName').value=x.name;$('apiEndpoint').value=x.endpoint;$('apiMethod').value=x.method;$('apiTimeout').value=x.timeoutMs;alert('لأمان المفاتيح، أعد إدخال Headers وBody فقط عند تغييرهما.');scrollTo({top:0,behavior:'smooth'})}async function deleteCommand(id){if(confirm('حذف الأمر؟')){await request('commands/'+id,{method:'DELETE'});await load()}}async function deleteApi(id){if(confirm('حذف API؟')){await request('apis/'+id,{method:'DELETE'});await load()}}(async()=>{try{const d=await request('state');csrf=d.csrf;state=d;$('login').classList.add('hidden');$('app').classList.remove('hidden');render()}catch{}})();
  </script></body></html>`;
}

function validateCommand(input) {
  const trigger = String(input.trigger || "").trim().toLowerCase();
  if (!/^\/[\p{L}\p{N}_-]{1,48}$/u.test(trigger)) throw new Error("صيغة الأمر غير صالحة");
  if (!String(input.title || "").trim()) throw new Error("اسم الأمر مطلوب");
  if (!["everyone", "moderator", "developer"].includes(input.permission)) throw new Error("الصلاحية غير صالحة");
  return { trigger, title: String(input.title).trim(), description: String(input.description || "").trim(), responseTemplate: String(input.responseTemplate || "").trim(), permission: input.permission, apiId: input.apiId || null, responsePath: String(input.responsePath || "").trim() };
}

function validateApi(input) {
  const endpoint = new URL(String(input.endpoint || ""));
  if (endpoint.protocol !== "https:") throw new Error("يسمح فقط بروابط HTTPS");
  if (!String(input.name || "").trim()) throw new Error("اسم API مطلوب");
  if (!["GET", "POST"].includes(input.method)) throw new Error("الطريقة غير صالحة");
  if (input.headers && (typeof input.headers !== "object" || Array.isArray(input.headers))) throw new Error("Headers يجب أن تكون JSON object");
  if (input.body && (typeof input.body !== "object" || Array.isArray(input.body))) throw new Error("Body يجب أن تكون JSON object");
  return { name: String(input.name).trim(), endpoint: endpoint.toString(), method: input.method, timeoutMs: Math.max(1000, Math.min(30000, Number(input.timeoutMs) || 12000)), headers: input.headers || {}, body: input.body || {} };
}

export function startDashboardServer({ getBotStatus }) {
  const port = Number(process.env.PORT || 3000);
  const password = String(process.env.DASHBOARD_ADMIN_PASSWORD || "").trim();
  const server = http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (!url.pathname.startsWith("/dashboard")) { response.writeHead(404); response.end(); return; }
    if (!getBotStatus().connected) { json(response, 503, { error: "البوت غير متصل بواتساب، اللوحة غير متاحة حالياً." }); return; }
    if (!password) { json(response, 503, { error: "DASHBOARD_ADMIN_PASSWORD غير مضبوط." }); return; }
    try {
      if (url.pathname === "/dashboard" && request.method === "GET") {
        const bootstrap = "document.getElementById('loginButton').addEventListener('click', login); document.getElementById('password').addEventListener('keydown', event => { if (event.key === 'Enter') login(); });";
        const page = dashboardHtml()
          .replace('<button onclick="login()">', '<button id="loginButton" type="button">')
          .replace("</style>", `${DASHBOARD_THEME}</style>`)
          .replace("</script>", `${bootstrap}</script>`);
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(page);
        return;
      }
      if (url.pathname === "/dashboard/api/login" && request.method === "POST") {
        const ip = getClientIp(request); const attempts = loginAttempts.get(ip) || { count: 0, startedAt: Date.now() };
        if (Date.now() - attempts.startedAt > LOGIN_WINDOW_MS) { attempts.count = 0; attempts.startedAt = Date.now(); }
        if (attempts.count >= MAX_LOGIN_ATTEMPTS) { json(response, 429, { error: "حاول لاحقاً." }); return; }
        const body = await readJson(request);
        if (!safeEqual(body.password, password)) { attempts.count += 1; loginAttempts.set(ip, attempts); json(response, 401, { error: "كلمة المرور غير صحيحة." }); return; }
        loginAttempts.delete(ip); const session = makeSession();
        response.setHeader("Set-Cookie", `sam_dashboard_session=${session.id}; Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`);
        json(response, 200, { csrf: session.csrf }); return;
      }
      if (url.pathname === "/dashboard/api/logout" && request.method === "POST") { const session = authenticate(request, response); if (!session) return; sessions.delete(session.id); response.setHeader("Set-Cookie", "sam_dashboard_session=; Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=0"); json(response, 200, { ok: true }); return; }
      const session = authenticate(request, response); if (!session) return;
      if (url.pathname === "/dashboard/api/state" && request.method === "GET") { const [commands, apis] = await Promise.all([DashboardCommand.find().sort({ updatedAt: -1 }).lean(), DashboardApi.find().sort({ updatedAt: -1 }).lean()]); json(response, 200, { csrf: session.csrf, status: getBotStatus(), encryptionReady: isDashboardEncryptionConfigured(), commands, apis: apis.map(({ encryptedHeaders, encryptedBody, ...api }) => api) }); return; }
      if (url.pathname === "/dashboard/api/commands" && request.method === "POST") { const command = await DashboardCommand.create(validateCommand(await readJson(request))); json(response, 201, command); return; }
      if (url.pathname.startsWith("/dashboard/api/commands/") && request.method === "PUT") { const id = url.pathname.split("/").at(-1); const command = await DashboardCommand.findByIdAndUpdate(id, validateCommand(await readJson(request)), { new: true, runValidators: true }); if (!command) { json(response, 404, { error: "الأمر غير موجود" }); return; } json(response, 200, command); return; }
      if (url.pathname.startsWith("/dashboard/api/commands/") && request.method === "DELETE") { await DashboardCommand.findByIdAndDelete(url.pathname.split("/").at(-1)); json(response, 200, { ok: true }); return; }
      if (url.pathname === "/dashboard/api/apis" && request.method === "POST") { if (!isDashboardEncryptionConfigured()) throw new Error("DASHBOARD_ENCRYPTION_KEY غير مضبوط"); const api = validateApi(await readJson(request)); const created = await DashboardApi.create({ ...api, encryptedHeaders: encryptDashboardValue(api.headers), encryptedBody: encryptDashboardValue(api.body) }); json(response, 201, { ...created.toObject(), encryptedHeaders: undefined, encryptedBody: undefined }); return; }
      if (url.pathname.startsWith("/dashboard/api/apis/") && request.method === "PUT") { if (!isDashboardEncryptionConfigured()) throw new Error("DASHBOARD_ENCRYPTION_KEY غير مضبوط"); const id = url.pathname.split("/").at(-1); const api = validateApi(await readJson(request)); const updated = await DashboardApi.findByIdAndUpdate(id, { ...api, encryptedHeaders: encryptDashboardValue(api.headers), encryptedBody: encryptDashboardValue(api.body) }, { new: true, runValidators: true }); if (!updated) { json(response, 404, { error: "API غير موجود" }); return; } json(response, 200, { ...updated.toObject(), encryptedHeaders: undefined, encryptedBody: undefined }); return; }
      if (url.pathname.startsWith("/dashboard/api/apis/") && request.method === "DELETE") { await DashboardApi.findByIdAndDelete(url.pathname.split("/").at(-1)); json(response, 200, { ok: true }); return; }
      json(response, 404, { error: "المسار غير موجود" });
    } catch (error) { console.warn(`⚠️ Dashboard request failed: ${error.message}`); json(response, 400, { error: error.message || "تعذر إكمال الطلب" }); }
  });
  server.listen(port, "0.0.0.0", () => console.log(`✅ Dashboard server ready on port ${port}`));
  return server;
}
