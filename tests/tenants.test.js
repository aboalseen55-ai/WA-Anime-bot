import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentInstruction, buildConversationText, firstNameCandidate, parseAgentReply, toSpokenText, buildOwnerAlert, isNewConversation } from '../services/tenants/agent.js';
import { validateTenantSettings, normalizeNumbers, TENANT_PRESETS, DEFAULT_TENANT_SETTINGS } from '../services/tenants/tenantSettings.js';
import { useMongoAuthState } from '../services/tenants/mongoAuthState.js';
import { createTenantMessageHandler, readIncoming, isCustomerChat } from '../services/tenants/tenantMessages.js';
import { hashPassword, verifyPassword, validateNewTenant } from '../services/tenants/portal.js';

function memoryContacts() {
  const rows = new Map();
  return {
    rows,
    async get(tenantId, jid) { return rows.get(`${tenantId}:${jid}`) || null; },
    async save(tenantId, jid, { set = {}, push = [] }) {
      const key = `${tenantId}:${jid}`;
      const row = rows.get(key) || { jid, history: [] };
      Object.assign(row, set);
      row.history = [...row.history, ...push];
      rows.set(key, row);
    },
    async dueSummaries(tenantId, quietSince) {
      return [...rows.entries()].filter(([key, row]) => key.startsWith(`${tenantId}:`) && row.conversationStartedAt && row.lastMessageAt <= quietSince && (!row.summarySentAt || row.summarySentAt < row.conversationStartedAt)).map(([, row]) => row);
    }
  };
}

function fakeSock() {
  const sent = [];
  let n = 0;
  return { sent, async sendMessage(jid, content) { sent.push({ jid, content }); return { key: { id: `BOT${++n}` } }; }, async sendPresenceUpdate() {} };
}

const tenant = { _id: 't1', slug: 'firestone', name: 'فايرستون', enabled: true, settings: { ...TENANT_PRESETS.firestone.settings } };

function handler(overrides = {}) {
  const sock = fakeSock();
  const store = memoryContacts();
  const calls = [];
  const h = createTenantMessageHandler({
    getTenant: () => overrides.tenant || tenant,
    getSock: () => sock,
    now: overrides.now,
    generate: async args => { calls.push(args); if (args.json === false) return 'بدها فاير بليس بعمّان\nالمطلوب منك: اتصل فيها'; return overrides.raw ?? JSON.stringify({ reply: 'أهلين شذا، كيفك؟ 🌹', customerArabicName: 'شذا', handoff: false }); },
    createVoice: overrides.createVoice ?? (async () => ({ audio: Buffer.from('ogg'), mimetype: 'audio/ogg; codecs=opus' })),
    download: async () => Buffer.from('media'),
    store,
    batchDelayMs: 5,
    typingDelay: async () => {},
    log: { warn() {}, error() {} }
  });
  return { h, sock, store, calls };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const customerMsg = (message, extra = {}) => ({ key: { remoteJid: '962790000001@s.whatsapp.net', id: `C${Math.random()}`, fromMe: false }, pushName: 'Shatha 🌸', message, ...extra });

test('first name candidate strips emojis and symbols', () => {
  assert.equal(firstNameCandidate('Shatha 🌸 Ali'), 'Shatha');
  assert.equal(firstNameCandidate('🌸🌸'), '');
  assert.equal(firstNameCandidate('محمد احمد'), 'محمد');
});

test('agent instruction carries the shop info and the Arabic name rule', () => {
  const text = buildAgentInstruction({ ...DEFAULT_TENANT_SETTINGS, ...TENANT_PRESETS.firestone.settings });
  assert.match(text, /فاير بليس/);
  assert.match(text, /Shatha → شذا/);
  assert.match(text, /ممنوع تخترع أسعار/);
  assert.match(buildAgentInstruction(DEFAULT_TENANT_SETTINGS, { voice: true }), /رسالة صوتية/);
});

test('conversation text asks for a welcome only at the start', () => {
  const now = Date.now();
  assert.match(buildConversationText({ contact: { pushName: 'Shatha', history: [] }, incomingTexts: ['مرحبا'], now }), /رحّب فيه باسمه/);
  const ongoing = { pushName: 'Shatha', arabicName: 'شذا', lastMessageAt: new Date(now - 60000), history: [{ role: 'customer', text: 'مرحبا' }, { role: 'agent', text: 'أهلين' }] };
  assert.equal(isNewConversation(ongoing, now), false);
  assert.match(buildConversationText({ contact: ongoing, incomingTexts: ['كم السعر؟'], now }), /لا تعيد الترحيب/);
});

test('agent reply parsing accepts JSON, fenced JSON and plain text', () => {
  assert.deepEqual(parseAgentReply('{"reply":"أهلين","customerArabicName":"شذا","handoff":true,"handoffSummary":"بدها معاينة"}'), { reply: 'أهلين', customerArabicName: 'شذا', handoff: true, handoffSummary: 'بدها معاينة', heard: '' });
  assert.equal(parseAgentReply('```json\n{"reply":"هلا"}\n```').reply, 'هلا');
  assert.equal(parseAgentReply('{"reply":"هلا","customerArabicName":"Shatha"}').customerArabicName, '');
  assert.equal(parseAgentReply('مرحبا فيك').reply, 'مرحبا فيك');
  assert.equal(parseAgentReply(''), null);
  assert.equal(parseAgentReply('{"reply":""}'), null);
});

test('spoken text drops emojis, links and formatting', () => {
  assert.equal(toSpokenText('أهلين *شذا* 🌹 شوفي https://x.com'), 'أهلين شذا شوفي');
});

test('settings validation normalizes Jordanian numbers and bounds values', () => {
  assert.deepEqual(normalizeNumbers('0798202604\n962791111111'), ['962798202604', '962791111111']);
  assert.throws(() => normalizeNumbers('12'), /رقم غير صالح/);
  const settings = validateTenantSettings({ pauseHours: 2, voiceReplies: false, ownerNumbers: '0798202604' });
  assert.equal(settings.pauseHours, 2);
  assert.equal(settings.voiceReplies, false);
  assert.throws(() => validateTenantSettings({ pauseHours: 99 }), /0 و 48/);
  assert.throws(() => validateTenantSettings({ voiceId: 'bad id!' }), /الصوت/);
});

test('passwords are hashed with scrypt and verified', () => {
  const stored = hashPassword('secret-pass');
  assert.ok(verifyPassword('secret-pass', stored));
  assert.ok(!verifyPassword('wrong-pass', stored));
  assert.throws(() => validateNewTenant({ slug: 'admin', password: '12345678', name: 'x' }), /اسم المستخدم/);
  const created = validateNewTenant({ slug: 'firestone', password: '12345678', preset: 'firestone' });
  assert.equal(created.name, 'فايرستون للديكور');
  assert.deepEqual(created.settings.ownerNumbers, ['962796391944']);
});

test('mongo auth state round-trips creds and keys with buffers', async () => {
  const rows = new Map();
  const store = {
    async read(id, key) { return rows.get(`${id}/${key}`) ?? null; },
    async write(id, key, value) { rows.set(`${id}/${key}`, value); },
    async remove(id, key) { rows.delete(`${id}/${key}`); },
    async clear(id) { let n = 0; for (const key of rows.keys()) if (key.startsWith(`${id}/`)) { rows.delete(key); n++; } return n; }
  };
  const first = await useMongoAuthState('t1', store);
  assert.equal(first.hasSession(), false);
  await first.saveCreds();
  await first.state.keys.set({ 'pre-key': { 1: { public: Buffer.from([1, 2, 3]), private: Buffer.from([4]) } } });
  const second = await useMongoAuthState('t1', store);
  assert.deepEqual(second.state.creds.noiseKey.public, first.state.creds.noiseKey.public);
  const keys = await second.state.keys.get('pre-key', ['1', '2']);
  assert.ok(Buffer.isBuffer(keys['1'].public));
  assert.deepEqual([...keys['1'].public], [1, 2, 3]);
  assert.equal(keys['2'], null);
  await second.state.keys.set({ 'pre-key': { 1: null } });
  assert.equal((await second.state.keys.get('pre-key', ['1']))['1'], null);
  assert.ok(await second.clear() >= 1);
});

test('incoming parsing and chat filtering', () => {
  assert.equal(readIncoming({ conversation: 'مرحبا' }).text, 'مرحبا');
  assert.equal(readIncoming({ audioMessage: { seconds: 4 } }).kind, 'audio');
  assert.equal(readIncoming({ ephemeralMessage: { message: { imageMessage: { caption: 'هيك بدي' } } } }).text, 'هيك بدي');
  assert.ok(isCustomerChat('962790000001@s.whatsapp.net'));
  assert.ok(isCustomerChat('1234@lid'));
  assert.ok(!isCustomerChat('1203@g.us'));
  assert.ok(!isCustomerChat('status@broadcast'));
});

test('customer text gets one batched text reply and the Arabic name is saved', async () => {
  const { h, sock, store, calls } = handler();
  await h.onMessages({ type: 'notify', messages: [customerMsg({ conversation: 'مرحبا' }), customerMsg({ conversation: 'بدي فاير بليس' })] });
  await wait(30);
  assert.equal(calls.length, 1);
  assert.match(calls[0].parts.at(-1).text, /مرحبا\nبدي فاير بليس/);
  assert.equal(sock.sent.length, 1);
  assert.equal(sock.sent[0].content.text, 'أهلين شذا، كيفك؟ 🌹');
  const row = store.rows.get('t1:962790000001@s.whatsapp.net');
  assert.equal(row.arabicName, 'شذا');
  assert.equal(row.history.length, 2);
});

test('a voice note is answered with a voice note', async () => {
  const { h, sock, calls } = handler();
  await h.onMessages({ type: 'notify', messages: [customerMsg({ audioMessage: { seconds: 5, mimetype: 'audio/ogg; codecs=opus' } })] });
  await wait(30);
  assert.ok(calls[0].parts.some(part => part.inlineData?.mimeType === 'audio/ogg'));
  assert.match(calls[0].systemInstruction, /رسالة صوتية/);
  assert.equal(sock.sent[0].content.ptt, true);
});

test('voice falls back to text when ElevenLabs fails', async () => {
  const { h, sock } = handler({ createVoice: async () => null });
  await h.onMessages({ type: 'notify', messages: [customerMsg({ audioMessage: { seconds: 5 } })] });
  await wait(30);
  assert.equal(typeof sock.sent[0].content.text, 'string');
});

test('hand-off alerts the owner number', async () => {
  const { h, sock, store } = handler({ raw: JSON.stringify({ reply: 'تمام، رح يتواصل معك المسؤول', handoff: true, handoffSummary: 'بدها معاينة بعمّان' }) });
  await h.onMessages({ type: 'notify', messages: [customerMsg({ conversation: 'بدي احجز معاينة' })] });
  await wait(30);
  const alert = sock.sent.find(item => item.jid === '962796391944@s.whatsapp.net');
  assert.ok(alert);
  assert.match(alert.content.text, /بدها معاينة بعمّان/);
  assert.match(alert.content.text, /wa\.me\/962790000001/);
  assert.equal(store.rows.get('t1:962790000001@s.whatsapp.net').handoffSummary, 'بدها معاينة بعمّان');
});

test('the owner replying by hand pauses the bot in that chat', async () => {
  const { h, sock, calls } = handler();
  await h.onMessages({ type: 'notify', messages: [customerMsg({ conversation: 'مرحبا' })] });
  await h.onMessages({ type: 'notify', messages: [{ key: { remoteJid: '962790000001@s.whatsapp.net', id: 'OWNER1', fromMe: true }, message: { conversation: 'أهلين، معك أبو سامر' } }] });
  await wait(30);
  assert.equal(calls.length, 0);
  await h.onMessages({ type: 'notify', messages: [customerMsg({ conversation: 'تمام' })] });
  await wait(30);
  assert.equal(calls.length, 0);
  assert.equal(sock.sent.length, 0);
});

test('groups, history sync, owner numbers and the bot\'s own messages are ignored', async () => {
  const { h, calls } = handler();
  await h.onMessages({ type: 'notify', messages: [{ key: { remoteJid: '1203@g.us', id: 'G', fromMe: false }, message: { conversation: 'hi' } }] });
  await h.onMessages({ type: 'append', messages: [customerMsg({ conversation: 'old' })] });
  await h.onMessages({ type: 'notify', messages: [{ key: { remoteJid: '962796391944@s.whatsapp.net', id: 'O', fromMe: false }, message: { conversation: 'انا الوالد' } }] });
  await wait(30);
  assert.equal(calls.length, 0);
});

test('a disabled bot stays quiet', async () => {
  const { h, calls } = handler({ tenant: { ...tenant, settings: { ...tenant.settings, botEnabled: false } } });
  await h.onMessages({ type: 'notify', messages: [customerMsg({ conversation: 'مرحبا' })] });
  await wait(30);
  assert.equal(calls.length, 0);
});

test('owner alert text', () => {
  assert.match(buildOwnerAlert({ businessName: 'فايرستون', contact: { arabicName: 'شذا', phone: '9627' }, summary: 'معاينة' }), /شذا[\s\S]*معاينة/);
});

test('a quiet conversation sends the owner one summary', async () => {
  let clock = Date.parse('2026-11-14T10:00:00Z');
  const { h, sock } = handler({ now: () => clock });
  await h.onMessages({ type: 'notify', messages: [customerMsg({ conversation: 'بدي فاير بليس بعمّان' })] });
  await wait(30);
  assert.equal(await h.sweepSummaries(), 0);
  clock += 16 * 60_000;
  assert.equal(await h.sweepSummaries(), 1);
  const summary = sock.sent.at(-1);
  assert.equal(summary.jid, '962796391944@s.whatsapp.net');
  assert.match(summary.content.text, /ملخص محادثة/);
  assert.match(summary.content.text, /شذا/);
  assert.match(summary.content.text, /المطلوب منك/);
  clock += 16 * 60_000;
  assert.equal(await h.sweepSummaries(), 0);
});

test('summary validation bounds', () => {
  assert.equal(validateTenantSettings({ summaryAfterMinutes: 0 }).summaryAfterMinutes, 0);
  assert.throws(() => validateTenantSettings({ summaryAfterMinutes: 500 }), /240/);
});
