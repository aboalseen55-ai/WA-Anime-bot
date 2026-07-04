export const IDENTITY_COMMANDS = new Set([
  "/هويتي",
  "/معرفي",
  "/id",
  "/myid",
  "/whoami"
]);

function formatOptional(value) {
  return value || "-";
}

export function isIdentityCommand(text) {
  return IDENTITY_COMMANDS.has(String(text || "").trim().toLowerCase());
}

export function buildIdentityInfoMessage(msg, sender, chatJid) {
  const participant = msg.key?.participant || "";
  const remoteJid = msg.key?.remoteJid || chatJid || "";
  const isGroup = remoteJid.endsWith("@g.us");
  const pushName = msg.pushName || "";
  const messageId = msg.key?.id || "";

  return `🧾 *بياناتك عند البوت*

*sender:*
\`${formatOptional(sender)}\`

*chatJid:*
\`${formatOptional(remoteJid)}\`

*participant:*
\`${formatOptional(participant)}\`

*pushName:*
\`${formatOptional(pushName)}\`

*نوع المحادثة:*
${isGroup ? "مجموعة" : "خاص"}

*messageId:*
\`${formatOptional(messageId)}\`

إذا كان أمر المطور لا يتعرف عليك، انسخ قيمة *sender* وضعها في Railway داخل:
\`DEVELOPER_JIDS\``;
}
