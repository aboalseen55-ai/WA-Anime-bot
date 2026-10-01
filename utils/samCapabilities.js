// ما يقدر سام يعمله فعليًا، حتى يشرحه الذكاء الاصطناعي صح، وتنفيذ الطلبات الطبيعية (تذكير، مهمة، ملاحظة) عبر الأوامر الحقيقية
import { handlePersonalCommand } from "./personalAssistant.js";
import { handleAssistantHomeCommand } from "./assistantHome.js";
import { DEFAULT_TIME_ZONE } from "./quran.js";

const TIME_ZONE = process.env.PERSONAL_REMINDER_TIMEZONE || DEFAULT_TIME_ZONE;

// الخدمات الحقيقية بالخاص، بنفس أسماء الأوامر
export const SAM_CAPABILITIES = [
  "خدماتك الحقيقية (هذه فقط، لا تخترع غيرها):",
  "1) دردشة وأسئلة عامة، صياغة رسائل، ترجمة، تلخيص، أفكار.",
  "2) الفويسات: يفرّغ الرسالة الصوتية لنص ويلخصها إذا طويلة (بالقروب: رد على الفويس بـ /فرغ).",
  "3) الصور وملفات PDF: يقرأها ويطلع أهم المعلومات أو يجاوب سؤال عنها (بالقروب: /اقرأ).",
  "4) التذكيرات: /ذكرني بعد 20 دقيقة ...، /ذكرني بكرة الساعة 9 ...، ومتكررة: /ذكرني كل يوم الساعة 8 مساءً ...، /ذكرني كل جمعة ... ؛ /تذكيراتي للعرض و/الغاء_تذكير <رقم>.",
  "5) المهام: /مهمة <نص>، /مهامي، /تم <رقم>. الملاحظات: /ملاحظة <نص>، /ملاحظاتي.",
  "6) الملخص الصباحي: /صباحي تشغيل 7 كل يوم يبعت مواقيت الصلاة والتذكيرات والمهام؛ /مدينتي اربد لتغيير المدينة.",
  "7) الردود الصوتية: /فويس تشغيل أو ايقاف، /فويس اسلوب ناعم هادي، /فويس رصيد. بالقروب: رد على رسالة سام بفويس وبيرد عليك.",
  "8) بالقروبات: /ملخص (شو فاتني)، /حماية روابط أو سبام، /نداء، /ذكر_القروب للمشرفين.",
  "9) ترفيه: أنمي، ألعاب، مسابقات وقرآن من قائمة /أوامر. و/مساعدة تعرض كل شيء."
].join("\n");

// الأوامر اللي مسموح للذكاء الاصطناعي ينفذها نيابة عن المستخدم بالخاص
const ALLOWED_COMMANDS = ["ذكرني", "نبهني", "مهمة", "مهمه", "ملاحظة", "ملاحظه", "تذكيراتي", "مهامي", "ملاحظاتي", "صباحي", "مدينتي"];

export function assistantActionInstruction() {
  return [
    "إذا طلب المستخدم صراحة إنشاء تذكير أو مهمة أو ملاحظة أو عرضها، أو تشغيل الملخص الصباحي، حوّل طلبه لأمر واحد من الأوامر أعلاه بنفس صيغتها",
    "(مثال: \"ذكرني بكرة الساعة 9 اتصل بأحمد\" -> /ذكرني بكرة الساعة 9 اتصل بأحمد ؛ \"سجل مهمة اشتري خبز\" -> /مهمة اشتري خبز).",
    "الأوامر المسموحة فقط: /ذكرني، /مهمة، /ملاحظة، /تذكيراتي، /مهامي، /ملاحظاتي، /صباحي، /مدينتي.",
    "إذا الطلب ناقص (مثلًا تذكير بدون وقت) لا تعطي أمر، واسأله عن الناقص.",
    "لما تعطي أمر، خلي ردك تأكيد قصير طبيعي بدون ما تكرر تفاصيل الأمر، لأن النظام بيبعت التفاصيل."
  ].join(" ");
}

export function currentTimeContext(now = new Date()) {
  const formatted = now.toLocaleString("ar-JO", { timeZone: TIME_ZONE, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `الوقت الحالي عند المستخدم: ${formatted} (${TIME_ZONE}).`;
}

/** يقبل الأمر فقط إذا كان من الأوامر الآمنة المسموحة. */
export function sanitizeAssistantCommand(command) {
  const value = String(command || "").trim().replace(/\s+/g, " ");
  if (!value.startsWith("/") || value.length > 300) return null;
  const name = value.slice(1).split(" ")[0].replace(/_/g, "");
  return ALLOWED_COMMANDS.includes(name) ? value : null;
}

/** يفصل سطر [[CMD: /...]] عن نص الرد. */
export function extractAssistantCommand(text) {
  const source = String(text || "");
  const match = source.match(/\[\[\s*CMD\s*:\s*([^\]]+)\]\]/i);
  const reply = source.replace(/\[\[\s*CMD\s*:[^\]]*\]\]/gi, "").trim();
  return { reply, command: match ? sanitizeAssistantCommand(match[1]) : null };
}

/** ينفذ الأمر كأنه المستخدم كتبه. يعيد true إذا انتفذ. */
export async function runAssistantCommand(sock, jid, sender, command) {
  const safe = sanitizeAssistantCommand(command);
  if (!safe) return false;
  try {
    if (await handleAssistantHomeCommand(sock, jid, sender, safe, null)) return true;
    return await handlePersonalCommand(sock, jid, sender, safe);
  } catch (error) {
    console.error("Assistant action failed:", error.message);
    return false;
  }
}
