import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransientGeminiError, resolveModelChain } from '../utils/samBotAI.js';
import { toOpenAIContent, generateOpenAIFallback } from '../utils/openAIFallback.js';

test('Gemini overload errors count as transient, bad keys do not', () => {
  assert.equal(isTransientGeminiError(new Error('[503 Service Unavailable] This model is currently experiencing high demand.')), true);
  assert.equal(isTransientGeminiError(new Error('[429 Too Many Requests] Resource exhausted')), true);
  assert.equal(isTransientGeminiError(new Error('API key not valid')), false);
  assert.equal(isTransientGeminiError(new Error('Sam Bot AI request timed out')), false);
});

test('model chain puts the primary first and drops duplicates', () => {
  assert.deepEqual(resolveModelChain('gemini-flash-latest', 'gemini-2, gemini-flash-latest'), ['gemini-flash-latest', 'gemini-2']);
  assert.deepEqual(resolveModelChain('m1', ''), ['m1']);
  assert.equal(resolveModelChain('m1', undefined)[0], 'm1');
});

test('OpenAI fallback converts voice, image and PDF parts', async () => {
  const content = await toOpenAIContent([
    { inlineData: { mimeType: 'audio/ogg; codecs=opus', data: 'AAA' } },
    { inlineData: { mimeType: 'image/jpeg', data: 'BBB' } },
    { inlineData: { mimeType: 'application/pdf', data: 'CCC' } },
    { text: 'Answer this voice note.' }
  ], { transcribeImpl: async ({ mimeType }) => (mimeType === 'audio/ogg' ? 'شو مهامي اليوم' : '') });
  assert.equal(content[0].text, 'Voice note (automatic transcript): شو مهامي اليوم');
  assert.equal(content[1].image_url.url, 'data:image/jpeg;base64,BBB');
  assert.equal(content[2].file.file_data, 'data:application/pdf;base64,CCC');
  assert.equal(content[3].text, 'Answer this voice note.');
  assert.equal(await toOpenAIContent('hi'), 'hi');
});

test('OpenAI fallback sends a JSON chat request with the configured model', async (t) => {
  t.after(() => { delete process.env.OPENAI_API_KEY; delete process.env.SAM_BOT_OPENAI_MODEL; });
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SAM_BOT_OPENAI_MODEL = 'gpt-test';
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"reply":"أهلين"}' } }] }) };
  };
  const out = await generateOpenAIFallback({ systemInstruction: 'sys', prompt: 'hello', temperature: 0.5, maxOutputTokens: 100, json: true, fetchImpl });
  assert.equal(out, '{"reply":"أهلين"}');
  assert.equal(sent.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(sent.auth, 'Bearer sk-test');
  assert.equal(sent.body.model, 'gpt-test');
  assert.equal(sent.body.max_completion_tokens, 100);
  assert.deepEqual(sent.body.response_format, { type: 'json_object' });
});
