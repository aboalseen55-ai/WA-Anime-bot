// لما المستخدم يطلب بياناته بالحكي أو بالفويس (شو مهامي؟ احكيلي ذاكرتي)، سام بينفذ الأمر بصمت،
// وبيعطي البيانات للذكاء الاصطناعي ليجاوب بذكاء بدل ما يبعت القائمة زي ما هي.
import { captureAssistantCommand } from "./samCapabilities.js";
import { generateCommandAnswer, isSamBotAIAvailable } from "./samBotAI.js";
import { sendVoiceOrText } from "./voiceReplies.js";

/** يعيد النص اللي انبعت، أو null إذا الأمر ما انتفذ. */
export async function answerFromCommandData(sock, jid, sender, { command, userMessage, nickname, voice = false, quoted } = {}) {
  const { ran, text } = await captureAssistantCommand(sock, jid, sender, command);
  if (!ran) return null;
  // أوامر زي التصدير بتبعت ملف ومافي نص نجاوب منه
  if (!text) return "";

  const answer = isSamBotAIAvailable()
    ? await generateCommandAnswer({ userMessage, commandOutput: text, nickname, spoken: voice })
    : "";
  const body = answer || text;
  if (voice) await sendVoiceOrText(sock, jid, body, { quoted, userJid: sender });
  else await sock.sendMessage(jid, { text: body }, quoted ? { quoted } : undefined);
  return body;
}
