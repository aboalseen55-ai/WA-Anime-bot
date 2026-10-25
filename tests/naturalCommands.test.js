import test from 'node:test';
import assert from 'node:assert/strict';
import UserMemory from '../database/userMemoryModel.js';
import { toWhatsAppFormatting } from '../utils/samBotAI.js';
import { captureAssistantCommand, isReadCommand, extractAssistantCommand } from '../utils/samCapabilities.js';
import { answerFromCommandData } from '../utils/commandAnswers.js';

const USER = '962722222222@s.whatsapp.net';

test('Markdown from Gemini becomes WhatsApp formatting', () => {
  const input = [
    '### خطة اليوم',
    '* **تعديل النوم:** نام بكير',
    '- **الصباح (8:00):** رياضة',
    'نص فيه **عريض** و __مائل__ و ~~مشطوب~~ و *عريض أصلًا*'
  ].join('\n');
  assert.equal(toWhatsAppFormatting(input), [
    '*خطة اليوم*',
    '• *تعديل النوم:* نام بكير',
    '• *الصباح (8:00):* رياضة',
    'نص فيه *عريض* و _مائل_ و ~مشطوب~ و *عريض أصلًا*'
  ].join('\n'));
  assert.equal(toWhatsAppFormatting('2 * 3 = 6'), '2 * 3 = 6');
});

test('data requests are recognised as read commands', () => {
  for (const c of ['/ذاكرتي', '/مهامي', '/تذكيراتي', '/ملاحظاتي', '/خطتي بكرة', '/مصاريفي الاسبوع']) assert.ok(isReadCommand(c), c);
  for (const c of ['/مهمة خبز', '/ذكرني بكرة 9 اتصل', '/تذكر بحب القهوة']) assert.equal(isReadCommand(c), false, c);
  assert.equal(extractAssistantCommand('تمام [[CMD: /ذاكرتي]]').command, '/ذاكرتي');
});

test('a read command runs silently and its text comes back for the AI', async t => {
  t.mock.method(UserMemory, 'findOne', () => ({ lean: async () => ({ userJid: USER, facts: [{ text: 'بشتغل محاسب' }], summary: '' }) }));
  const sent = [];
  const sock = { sendMessage: async (jid, payload) => { sent.push(payload); } };
  const { ran, text } = await captureAssistantCommand(sock, USER, USER, '/ذاكرتي');
  assert.equal(ran, true);
  assert.match(text, /بشتغل محاسب/);
  assert.equal(sent.length, 0);
});

test('without AI the user still gets the real data', async t => {
  const previous = process.env.SAM_BOT_AI_ENABLED;
  process.env.SAM_BOT_AI_ENABLED = 'false';
  t.after(() => { if (previous === undefined) delete process.env.SAM_BOT_AI_ENABLED; else process.env.SAM_BOT_AI_ENABLED = previous; });
  t.mock.method(UserMemory, 'findOne', () => ({ lean: async () => ({ userJid: USER, facts: [{ text: 'ساكن بعمان' }], summary: '' }) }));
  const sent = [];
  const sock = { sendMessage: async (jid, payload) => { sent.push(payload); } };
  const body = await answerFromCommandData(sock, USER, USER, { command: '/ذاكرتي', userMessage: 'احكيلي ذاكرتي' });
  assert.match(body, /ساكن بعمان/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, body);
});
