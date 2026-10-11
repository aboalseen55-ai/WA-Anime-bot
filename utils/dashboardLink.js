// المطور بيطلب لينك الداشبورد من واتساب ("/داشبورد" أو "اعطيني الداشبورد")
import { DEVELOPER_JIDS } from "../config.js";

const SLASH_TRIGGERS = new Set(["/داشبورد", "/الداشبورد", "/لوحة", "/لوحه", "/لوحة_التحكم", "/dashboard"]);
const PHRASE = /(داشبورد|دشبورد|لوحة التحكم|لوحه التحكم|dashboard)/i;
const MAX_PHRASE_LENGTH = 50;

export function getDashboardUrl(env = process.env) {
  if (env.DASHBOARD_URL) return env.DASHBOARD_URL.trim();
  const domain = env.RAILWAY_PUBLIC_DOMAIN?.trim() || "sambot.up.railway.app";
  return `https://${domain}/dashboard/`;
}

export function isDashboardLinkRequest(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (value.startsWith("/")) return SLASH_TRIGGERS.has(value.toLowerCase());
  return value.length <= MAX_PHRASE_LENGTH && PHRASE.test(value);
}

export async function handleDashboardLinkCommand(sock, jid, sender, text, { developers = DEVELOPER_JIDS, env = process.env } = {}) {
  if (!developers.includes(sender) || !isDashboardLinkRequest(text)) return false;
  const message = `🖥️ *لوحة التحكم*\n${getDashboardUrl(env)}\n\nادخل بكلمة سر الداشبورد.`;
  if (jid.endsWith("@g.us")) {
    // ما بنحط اللينك بالقروب، بنبعته خاص
    await sock.sendMessage(sender, { text: message });
    await sock.sendMessage(jid, { text: "📩 بعتلك لينك الداشبورد عالخاص." });
  } else {
    await sock.sendMessage(jid, { text: message });
  }
  return true;
}
