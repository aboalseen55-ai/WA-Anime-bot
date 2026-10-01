import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAssistantCommand, sanitizeAssistantCommand, runAssistantCommand, SAM_CAPABILITIES } from '../utils/samCapabilities.js';
import { voiceConversationInstruction } from '../utils/voiceReplies.js';

test('extractAssistantCommand splits the reply from a safe command', () => {
  const { reply, command } = extractAssistantCommand('تمام، رح أذكرك 👍\n[[CMD: /ذكرني بكرة الساعة 9 اتصل بأحمد]]');
  assert.equal(reply, 'تمام، رح أذكرك 👍');
  assert.equal(command, '/ذكرني بكرة الساعة 9 اتصل بأحمد');
  assert.deepEqual(extractAssistantCommand('أهلين'), { reply: 'أهلين', command: null });
});

test('only whitelisted personal commands can be run by the AI', () => {
  assert.equal(sanitizeAssistantCommand('/مهمة اشتري خبز'), '/مهمة اشتري خبز');
  assert.equal(sanitizeAssistantCommand('/حماية روابط تشغيل'), null);
  assert.equal(sanitizeAssistantCommand('/نداء يا جماعة'), null);
  assert.equal(sanitizeAssistantCommand('ذكرني بكرة'), null);
  assert.equal(extractAssistantCommand('ok [[CMD: /فويس تشغيل]]').command, null);
});

test('runAssistantCommand refuses unsafe commands without sending anything', async () => {
  const sent = [];
  const sock = { sendMessage: async (...a) => sent.push(a) };
  assert.equal(await runAssistantCommand(sock, 'u@s.whatsapp.net', 'u@s.whatsapp.net', '/نداء هلا'), false);
  assert.equal(sent.length, 0);
});

test('the AI prompts list the real services and commands', () => {
  for (const cmd of ['/ذكرني', '/مهمة', '/صباحي', '/فويس', '/ملخص', '/مساعدة']) assert.ok(SAM_CAPABILITIES.includes(cmd), cmd);
  assert.ok(voiceConversationInstruction().includes('/ذكرني'));
  assert.ok(voiceConversationInstruction().includes('"command"'));
});
