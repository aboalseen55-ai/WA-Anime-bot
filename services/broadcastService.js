// بوابة الرسائل الجماعية بلوحة التحكم: اختيار قروبات وأرقام، تحويل الصوت لنص، تحسين الرسالة بـ OpenAI، والإرسال.
// Env: OPENAI_API_KEY، OPENAI_MODEL (افتراضي gpt-4o-mini)، OPENAI_TRANSCRIBE_MODEL (افتراضي gpt-4o-mini-transcribe)
import Kingdom from '../database/kingdomModel.js';
import { audit } from './dashboardData.js';

const OPENAI_URL = 'https://api.openai.com/v1';
const MAX_TARGETS = 200;
const MAX_TEXT = 4000;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const SEND_DELAY_MS = Number(process.env.BROADCAST_DELAY_MS || 1500);
const GROUP_ROLES = { mainGroup: 'الرئيسي', receptionGroup: 'الاستقبال', workGroup: 'العمل', adminGroup: 'الإدارة' };

const TONES = {
  friendly: 'ودّي وقريب، بلهجة أردنية خفيفة',
  formal: 'رسمي ومحترم بالعربية الفصحى البسيطة',
  announcement: 'إعلان واضح ومرتب، بعنوان قصير بالبداية',
  hype: 'حماسي ومشجع، مع إيموجي مناسبة'
};

export function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function openai(path, init, fetchImpl = globalThis.fetch) {
  if (!isOpenAIConfigured()) throw new Error('مفتاح OpenAI غير مضبوط (OPENAI_API_KEY)');
  const response = await fetchImpl(`${OPENAI_URL}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...(init.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn('OpenAI request failed:', response.status, data?.error?.message);
    if (response.status === 401) throw new Error('مفتاح OpenAI غير صحيح');
    if (response.status === 429) throw new Error('رصيد OpenAI خلص أو في ضغط، جرب بعد شوي');
    throw new Error('فشل الطلب من OpenAI');
  }
  return data;
}

/** القروبات اللي البوت فيها، مع اسم المملكة لكل قروب تابع لمملكة. */
export async function listBroadcastTargets(getGroups, { kingdomModel = Kingdom } = {}) {
  const groups = getGroups ? await getGroups() : [];
  const kingdoms = await kingdomModel.find({}).select('id name mainGroup receptionGroup workGroup adminGroup groupIds').sort({ name: 1 }).lean();
  const owner = new Map();
  for (const kingdom of kingdoms) {
    for (const [field, role] of Object.entries(GROUP_ROLES)) {
      if (kingdom[field]) owner.set(kingdom[field], { kingdom: kingdom.name, kingdomId: kingdom.id, role });
    }
    for (const jid of kingdom.groupIds || []) if (!owner.has(jid)) owner.set(jid, { kingdom: kingdom.name, kingdomId: kingdom.id, role: '' });
  }
  return {
    openai: isOpenAIConfigured(),
    groups: groups
      .map((group) => ({ id: group.id, name: group.name, ...(owner.get(group.id) || {}) }))
      .sort((a, b) => String(a.kingdom || '￿').localeCompare(String(b.kingdom || '￿'), 'ar') || String(a.name).localeCompare(String(b.name), 'ar'))
  };
}

export async function transcribeAudio(buffer, mimetype = 'audio/webm', { fetchImpl } = {}) {
  if (!buffer?.length) throw new Error('التسجيل فاضي');
  if (buffer.length > MAX_AUDIO_BYTES) throw new Error('التسجيل طويل كثير');
  const extension = /ogg/.test(mimetype) ? 'ogg' : /mp4|m4a|aac/.test(mimetype) ? 'm4a' : /wav/.test(mimetype) ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }), `voice.${extension}`);
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');
  form.append('language', 'ar');
  const data = await openai('audio/transcriptions', { method: 'POST', body: form }, fetchImpl);
  return String(data.text || '').trim();
}

export async function enhanceMessage(text, { tone = 'friendly', instructions = '', fetchImpl } = {}) {
  const draft = String(text || '').trim().slice(0, MAX_TEXT);
  if (!draft) throw new Error('اكتب أو سجّل الرسالة أول');
  const system = [
    'أنت محرر رسائل واتساب. حوّل المسودة لرسالة واتساب جاهزة للإرسال لمجموعة أو شخص.',
    `الأسلوب: ${TONES[tone] || TONES.friendly}.`,
    'حافظ على المعنى وكل المعلومات (مواعيد، أرقام، روابط، أسماء) بدون ما تخترع اشي جديد.',
    'رتبها بفقرات قصيرة أو نقاط، واستخدم تنسيق واتساب (*عريض* و_مائل_) بدون مبالغة، وإيموجي قليلة ومناسبة.',
    'رجّع نص الرسالة فقط بدون أي شرح أو مقدمة أو علامات اقتباس.'
  ].join(' ');
  const user = instructions ? `ملاحظات إضافية: ${String(instructions).slice(0, 500)}\n\nالمسودة:\n${draft}` : draft;
  const data = await openai('chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.6,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  }, fetchImpl);
  const result = String(data.choices?.[0]?.message?.content || '').trim();
  if (!result) throw new Error('ما رجع نص من OpenAI');
  return result;
}

/** أرقام بالصيغة الدولية (مع أو بدون +، أو 07... للأردن) إلى JID. */
export function normalizeNumbers(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[\n,،;]+/);
  const jids = new Set();
  for (const raw of list) {
    let digits = String(raw).replace(/[^\d]/g, '');
    if (!digits) continue;
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (/^07\d{8}$/.test(digits)) digits = `962${digits.slice(1)}`;
    if (digits.length < 8 || digits.length > 15) throw new Error(`رقم غير صالح: ${raw}`);
    jids.add(`${digits}@s.whatsapp.net`);
  }
  return [...jids];
}

async function prepareTargets({ groups = [], numbers = '', text }, getGroups) {
  const message = String(text || '').trim();
  if (!message) throw new Error('الرسالة فاضية');
  if (message.length > MAX_TEXT) throw new Error('الرسالة طويلة كثير');
  const known = new Set((getGroups ? await getGroups() : []).map((group) => group.id));
  const groupIds = [...new Set((Array.isArray(groups) ? groups : []).map(String))];
  const unknown = groupIds.find((id) => !/^[0-9-]+@g\.us$/.test(id) || !known.has(id));
  if (unknown) throw new Error('في قروب مختار البوت مش فيه');
  const targets = [...groupIds, ...normalizeNumbers(numbers)];
  if (!targets.length) throw new Error('اختار قروب أو اكتب رقم');
  if (targets.length > MAX_TARGETS) throw new Error(`الحد الأقصى ${MAX_TARGETS} جهة بالمرة`);
  return { message, targets };
}

export async function sendBroadcast(sock, input, { getGroups, delay = SEND_DELAY_MS, onProgress } = {}) {
  if (!sock) throw new Error('البوت غير متصل بواتساب');
  const { message, targets } = await prepareTargets(input, getGroups);
  const results = [];
  for (const [index, jid] of targets.entries()) {
    // فاصل بين الرسائل حتى ما يعتبره واتساب سبام
    if (index && delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await sock.sendMessage(jid, { text: message });
      results.push({ jid, ok: true });
    } catch (error) {
      console.warn('Broadcast send failed:', jid, error.message);
      results.push({ jid, ok: false });
    }
    onProgress?.(results);
  }
  const sent = results.filter((result) => result.ok).length;
  audit('broadcast_sent', `${sent}/${targets.length}`).catch(() => {});
  return { sent, failed: targets.length - sent, results };
}

// الإرسال لعدد كبير بياخذ دقائق، فبيشتغل بالخلفية واللوحة بتسأل عن التقدم
const jobs = new Map();

export async function startBroadcastJob(sock, input, options = {}) {
  if (!sock) throw new Error('البوت غير متصل بواتساب');
  const { targets } = await prepareTargets(input, options.getGroups);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const job = { id, total: targets.length, done: 0, sent: 0, failed: 0, finished: false, failedTargets: [] };
  jobs.set(id, job);
  for (const [key, old] of jobs) if (old.finished && jobs.size > 20) jobs.delete(key);
  sendBroadcast(sock, input, {
    ...options,
    onProgress: (results) => {
      job.done = results.length;
      job.sent = results.filter((result) => result.ok).length;
      job.failed = job.done - job.sent;
    }
  }).then((result) => {
    job.failedTargets = result.results.filter((r) => !r.ok).map((r) => r.jid.split('@')[0]);
  }).catch((error) => {
    job.error = error.message;
  }).finally(() => {
    job.finished = true;
  });
  return job;
}

export function getBroadcastJob(id) {
  return jobs.get(id) || null;
}

function readRaw(req, limit = MAX_AUDIO_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('التسجيل طويل كثير')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** مسارات /dashboard/api/broadcast/*. ترجع null إذا المسار مش إلها. */
export async function handleBroadcastRoute(route, req, readJson, { getSock, getGroups }) {
  if (!route.startsWith('broadcast')) return null;
  if (route === 'broadcast/targets' && req.method === 'GET') return listBroadcastTargets(getGroups);
  if (route === 'broadcast/transcribe' && req.method === 'POST') {
    const audio = await readRaw(req);
    return { text: await transcribeAudio(audio, String(req.headers['content-type'] || 'audio/webm')) };
  }
  if (route === 'broadcast/enhance' && req.method === 'POST') {
    const body = await readJson(req);
    return { text: await enhanceMessage(body.text, { tone: body.tone, instructions: body.instructions }) };
  }
  if (route === 'broadcast/send' && req.method === 'POST') {
    const body = await readJson(req);
    return startBroadcastJob(getSock?.(), body, { getGroups });
  }
  const job = /^broadcast\/jobs\/([a-z0-9]+)$/.exec(route);
  if (job && req.method === 'GET') {
    const found = getBroadcastJob(job[1]);
    if (!found) throw new Error('عملية الإرسال غير موجودة');
    return found;
  }
  return null;
}
