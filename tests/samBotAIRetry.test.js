import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransientGeminiError, resolveModelChain } from '../utils/samBotAI.js';

test('Gemini overload errors count as transient, bad keys do not', () => {
  assert.equal(isTransientGeminiError(new Error('[503 Service Unavailable] This model is currently experiencing high demand.')), true);
  assert.equal(isTransientGeminiError(new Error('[429 Too Many Requests] Resource exhausted')), true);
  assert.equal(isTransientGeminiError(new Error('API key not valid')), false);
  assert.equal(isTransientGeminiError(new Error('Sam Bot AI request timed out')), false);
});

test('model chain puts the primary first and drops duplicates', () => {
  assert.deepEqual(resolveModelChain('gemini-3.1-flash-lite', 'gemini-flash-latest, gemini-3.1-flash-lite'), ['gemini-3.1-flash-lite', 'gemini-flash-latest']);
  assert.deepEqual(resolveModelChain('m1', ''), ['m1']);
  assert.equal(resolveModelChain('m1', undefined)[0], 'm1');
  assert.ok(resolveModelChain('m1', undefined).length > 1);
});
