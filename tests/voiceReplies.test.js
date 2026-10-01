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
