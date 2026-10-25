import test from 'node:test';
import assert from 'node:assert/strict';
import AssistantProfile from '../database/assistantProfileModel.js';
import { createVoiceNote, isElevenLabsConfigured } from '../services/elevenLabsService.js';
import { canUseVoiceReplies, handleVoiceCommand, sendVoiceOrText, toSpeakableText } from '../utils/voiceReplies.js';

const USER = '962700000001@s.whatsapp.net';

function withEnv(t, values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

function fakeSock() {
  const sent = [];
  return { sent, sendMessage: async (jid, content, opts) => { sent.push({ jid, content, opts }); }, sendPresenceUpdate: async () => {} };
}

test('toSpeakableText strips markdown, emojis and links', () => {
  assert.equal(toSpeakableText('🎙️ *أهلين* يا سامر! شوف https://x.com\n\n▪️ اشي'), 'أهلين يا سامر! شوف\nاشي');
});

test('createVoiceNote returns null when ElevenLabs is not configured', async (t) => {
  withEnv(t, { ELEVENLABS_API_KEY: undefined, ELEVENLABS_VOICE_ID: undefined });
  assert.equal(isElevenLabsConfigured(), false);
  assert.equal(await createVoiceNote('مرحبا', { http: { post: async () => { throw new Error('should not call'); } } }), null);
});

test('createVoiceNote calls the TTS endpoint with the voice id and returns opus audio', async (t) => {
  withEnv(t, { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'voice1', ELEVENLABS_MODEL_ID: undefined });
  let call;
  const http = { post: async (url, body, opts) => { call = { url, body, opts }; return { data: new Uint8Array([1, 2, 3]).buffer }; } };
  const voice = await createVoiceNote('مرحبا', { http });
  assert.equal(call.url, 'https://api.elevenlabs.io/v1/text-to-speech/voice1');
  assert.equal(call.body.model_id, 'eleven_multilingual_v2');
  assert.equal(call.opts.headers['xi-api-key'], 'k');
  assert.equal(voice.audio.length, 3);
  assert.equal(voice.mimetype, 'audio/ogg; codecs=opus');
});

test('sendVoiceOrText falls back to text when TTS is unavailable', async (t) => {
  withEnv(t, { ELEVENLABS_API_KEY: undefined, ELEVENLABS_VOICE_ID: undefined });
  const sock = fakeSock();
  assert.equal(await sendVoiceOrText(sock, USER, 'أهلين'), 'text');
  assert.equal(sock.sent[0].content.text, 'أهلين');
});

test('voice replies are owner-only unless opened to everyone', (t) => {
  withEnv(t, { ELEVENLABS_VOICE_PUBLIC: undefined });
  assert.equal(canUseVoiceReplies(USER), false);
  process.env.ELEVENLABS_VOICE_PUBLIC = 'true';
  assert.equal(canUseVoiceReplies(USER), true);
});

test('/فويس تشغيل and ايقاف toggle the profile flag', async (t) => {
  withEnv(t, { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v', ELEVENLABS_VOICE_PUBLIC: 'true' });
  const updates = [];
  t.mock.method(AssistantProfile, 'updateOne', async (q, u) => { updates.push({ q, u }); return { modifiedCount: 1 }; });
  const sock = fakeSock();

  assert.equal(await handleVoiceCommand(sock, USER, USER, '/فويس تشغيل'), true);
  assert.deepEqual(updates[0], { q: { jid: USER }, u: { $set: { voiceReplies: true } } });
  assert.equal(await handleVoiceCommand(sock, USER, USER, '/فويس ايقاف'), true);
  assert.equal(updates[1].u.$set.voiceReplies, false);
  assert.equal(await handleVoiceCommand(sock, USER, USER, '/فيديو'), false);
});

test('/فويس explains when the server has no ElevenLabs key', async (t) => {
  withEnv(t, { ELEVENLABS_API_KEY: undefined, ELEVENLABS_VOICE_ID: undefined });
  const sock = fakeSock();
  assert.equal(await handleVoiceCommand(sock, USER, USER, '/فويس تشغيل'), true);
  assert.match(sock.sent[0].content.text, /ElevenLabs/);
});

test('createVoiceNote logs the ElevenLabs reason on failure', async (t) => {
  withEnv(t, { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v' });
  const logged = [];
  t.mock.method(console, 'warn', (...args) => logged.push(args.join(' ')));
  const body = Buffer.from(JSON.stringify({ detail: { status: 'payment_required', message: 'Free users cannot use library voices via the API.' } }));
  const http = { post: async () => { const e = new Error('Request failed with status code 402'); e.response = { status: 402, data: body }; throw e; } };
  assert.equal(await createVoiceNote('مرحبا', { http }), null);
  assert.match(logged[0], /\(402\).*library voices/);
});

test('parseVoiceStyle maps Arabic words and keeps bracket tags', async () => {
  const { parseVoiceStyle } = await import('../utils/voiceReplies.js');
  assert.equal(parseVoiceStyle('ناعم وهادئ وأنثوي ورومانسي'), '[softly] [calm] [soft feminine tone] [romantic]');
  assert.equal(parseVoiceStyle('[whispers] hello [warmly]'), '[whispers] [warmly]');
  assert.equal(parseVoiceStyle('شي غريب'), '');
});

test('style tags are prepended only for v3 and v4 models', async (t) => {
  const { applyStyleTags } = await import('../services/elevenLabsService.js');
  assert.equal(applyStyleTags('أهلين', '[softly]', 'eleven_v4'), '[softly] أهلين');
  assert.equal(applyStyleTags('أهلين', '[softly]', 'eleven_v3'), '[softly] أهلين');
  assert.equal(applyStyleTags('أهلين', '[softly]', 'eleven_multilingual_v2'), 'أهلين');
});

test('/فويس اسلوب saves the parsed style and the voice note uses it', async (t) => {
  withEnv(t, { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v', ELEVENLABS_VOICE_PUBLIC: 'true', ELEVENLABS_MODEL_ID: 'eleven_v4' });
  let saved = null;
  t.mock.method(AssistantProfile, 'updateOne', async (q, u) => { saved = u.$set.voiceStyle; return { modifiedCount: 1 }; });
  const sock = fakeSock();
  assert.equal(await handleVoiceCommand(sock, USER, USER, '/فويس اسلوب ناعم هادي رومانسي'), true);
  assert.equal(saved, '[softly] [calm] [romantic]');
  assert.match(sock.sent[0].content.text, /\[softly\]/);
  assert.doesNotMatch(sock.sent[0].content.text, /⚠️/);
});

test('/فويس رصيد reports remaining ElevenLabs characters', async (t) => {
  const { getElevenLabsUsage } = await import('../services/elevenLabsService.js');
  const { formatUsage } = await import('../utils/voiceReplies.js');
  withEnv(t, { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v' });
  const http = { get: async () => ({ data: { character_count: 2500, character_limit: 10000, next_character_count_reset_unix: 1790000000 } }) };
  const usage = await getElevenLabsUsage({ http });
  assert.equal(usage.remaining, 7500);
  assert.match(formatUsage(usage), /7,500/);
  assert.match(formatUsage(usage), /25%/);
  t.mock.method(console, 'warn', () => {});
  const denied = await getElevenLabsUsage({ http: { get: async () => { const e = new Error('401'); e.response = { status: 401 }; throw e; } } });
  assert.equal(denied.error, 'permission');
  assert.match(formatUsage(denied), /User = Read/);
});

test('voice catalog: pinned env choices, else 2 Arabic female + 2 male voices', async (t) => {
  const { getVoiceCatalog, parseVoiceChoices, resetVoiceCatalogCache } = await import('../services/elevenLabsService.js');
  withEnv(t, { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v', ELEVENLABS_VOICE_CHOICES: 'ليلى|female|f1; سامي|male|m1;غلط|x|z' });
  assert.deepEqual(parseVoiceChoices().map(v => [v.name, v.gender, v.id]), [['ليلى', 'female', 'f1'], ['سامي', 'male', 'm1']]);

  delete process.env.ELEVENLABS_VOICE_CHOICES;
  resetVoiceCatalogCache();
  const calls = [];
  const http = {
    get: async (url, opts) => {
      calls.push({ url, params: opts.params });
      if (url.endsWith('/v1/voices')) {
        return { data: { voices: [
          { voice_id: 'acc-f', name: 'Rana - warm', labels: { gender: 'female', language: 'ar' } },
          { voice_id: 'en-m', name: 'Adam', labels: { gender: 'male', language: 'en' } }
        ] } };
      }
      const g = opts.params.gender;
      return { data: { voices: [
        { voice_id: `${g}-ad`, name: `${g} ad`, gender: g, use_case: 'advertisement', public_owner_id: 'o' },
        { voice_id: `${g}-chat`, name: `${g} chat`, gender: g, use_case: 'conversational', public_owner_id: 'o', preview_url: 'https://p/1.mp3' },
        { voice_id: `${g}-story`, name: `${g} story`, gender: g, use_case: 'narrative_story', public_owner_id: 'o' }
      ] } };
    }
  };
  const voices = await getVoiceCatalog({ http });
  assert.deepEqual(voices.map(v => v.id), ['acc-f', 'female-chat', 'male-chat', 'male-story']);
  assert.equal(voices[0].name, 'Rana');
  assert.equal(voices[0].source, 'account');
  assert.equal(voices[1].source, 'library');
  assert.ok(calls.some(c => c.params?.language === 'ar' && c.params?.gender === 'male'));
  // من الكاش بدون طلبات جديدة
  const before = calls.length;
  await getVoiceCatalog({ http });
  assert.equal(calls.length, before);
});

test('/فويس صوت lists numbered voices and a number reply picks and saves one', async (t) => {
  const axios = (await import('axios')).default;
  const { handleVoicePickReply } = await import('../utils/voiceReplies.js');
  withEnv(t, { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v', ELEVENLABS_VOICE_PUBLIC: 'true', ELEVENLABS_VOICE_CHOICES: 'ليلى|female|f1;نور|female|f2;سامي|male|m1;كريم|male|m2' });
  t.mock.method(AssistantProfile, 'findOne', () => ({ lean: async () => null }));
  const updates = [];
  t.mock.method(AssistantProfile, 'updateOne', async (q, u) => { updates.push(u.$set); return { modifiedCount: 1 }; });
  const ttsCalls = [];
  t.mock.method(axios, 'post', async (url) => { ttsCalls.push(url); return { data: new Uint8Array([1, 2]) }; });
  const sock = fakeSock();

  await handleVoiceCommand(sock, USER, USER, '/فويس صوت');
  const list = sock.sent.at(-1).content.text;
  assert.match(list, /1\. 👩 بنت: ليلى/);
  assert.match(list, /4\. 👨 شب: كريم/);
  assert.match(list, /5\. 🔁 الصوت الافتراضي/);

  assert.equal(await handleVoicePickReply(sock, USER, USER, '٣'), true);
  assert.match(ttsCalls[0], /text-to-speech\/m1$/);
  assert.deepEqual(updates.at(-1), { voiceId: 'm1', voiceName: 'سامي' });
  assert.ok(sock.sent.some(m => m.content.ptt));
  // الاختيار تسكر بعد النجاح
  assert.equal(await handleVoicePickReply(sock, USER, USER, '1'), false);

  // رقم مباشر مع الأمر، و5 = الافتراضي
  await handleVoiceCommand(sock, USER, USER, '/فويس صوت 5');
  assert.deepEqual(updates.at(-1), { voiceId: null, voiceName: null });
});

test('a voice that fails the TTS check is not saved', async (t) => {
  const axios = (await import('axios')).default;
  withEnv(t, { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v', ELEVENLABS_VOICE_PUBLIC: 'true', ELEVENLABS_VOICE_CHOICES: 'ليلى|female|f1' });
  t.mock.method(AssistantProfile, 'findOne', () => ({ lean: async () => null }));
  const updates = [];
  t.mock.method(AssistantProfile, 'updateOne', async (q, u) => { updates.push(u.$set); return {}; });
  t.mock.method(axios, 'post', async () => { const e = new Error('402'); e.response = { status: 402 }; throw e; });
  t.mock.method(console, 'warn', () => {});
  const sock = fakeSock();
  await handleVoiceCommand(sock, USER, USER, '/فويس صوت 1');
  assert.equal(updates.length, 0);
  assert.match(sock.sent.at(-1).content.text, /ما اشتغل/);
});
