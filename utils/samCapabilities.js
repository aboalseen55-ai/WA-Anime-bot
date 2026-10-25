// ما يقدر سام يعمله فعليًا، حتى يشرحه الذكاء الاصطناعي صح، وتنفيذ الطلبات الطبيعية (تذكير، مهمة، ملاحظة) عبر الأوامر الحقيقية
import { handlePersonalCommand } from "./personalAssistant.js";
import { handleAssistantHomeCommand } from "./assistantHome.js";
import { handleExpenseCommand } from "./expenses.js";
import { handleExpenseQuestionCommand } from "./expenseInsights.js";
import { handleDailyPlanCommand } from "./dailyPlan.js";
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
  "5ب) المصاريف: /مصروف 5 قهوة لتسجيل مصروف، /مصاريفي (أو /مصاريفي اليوم، /مصاريفي الاسبوع) للمجموع والتفاصيل، /حذف_مصروف <رقم>، و/تصدير_مصاريف (أو /تصدير_مصاريف الكل) بيبعت ملف إكسل مرتب فيه كل المصاريف والمجموع.",
  "5ج) أسئلة وتحليل المصاريف: /حلل_مصاريف <سؤال> بيجاوب من سجل المصاريف الحقيقي (قديش صرفت على البنزين هالشهر، قارن بالشهر الماضي)، ولما يطلب تحليل بيعطي رأي محلل مالي ووين بقدر يوفر.",
  "5د) خطة اليوم: /خطة <مهام بأوقات> أو /خطة_بكرة، /خطتي، و\"خلصت 2\". سام بيذكّر بوقت كل مهمة وبيسأل إذا خلصت، بيذكّر بنص اليوم بالباقي، وبآخر اليوم بيلخص وبينقل الباقي لبكرة.",
  "6) الملخص الصباحي: /صباحي تشغيل 7 كل يوم يبعت مواقيت الصلاة والتذكيرات والمهام؛ /مدينتي اربد لتغيير المدينة.",
  "6ب) الذاكرة: سام بيتذكر المعلومات المهمة عن كل شخص وآخر أحاديثه؛ /ذاكرتي للعرض، /تذكر <معلومة>، /انسى <رقم> أو /انسى الكل.",
  "7) الردود الصوتية: /فويس تشغيل أو ايقاف، /فويس صوت لاختيار صوت سام (صوتين بنات وصوتين شباب بالعربي)، /فويس اسلوب ناعم هادي، /فويس رصيد. بالقروب: رد على رسالة سام بفويس وبيرد عليك.",
  "8) بالقروبات: /ملخص (شو فاتني)، /حماية روابط أو سبام، /نداء، /ذكر_القروب للمشرفين.",
  "9) ترفيه: أنمي، ألعاب، مسابقات وقرآن من قائمة /أوامر. و/مساعدة تعرض كل شيء."
].join("\n");

// الأوامر اللي مسموح للذكاء الاصطناعي ينفذها نيابة عن المستخدم بالخاص
const ALLOWED_COMMANDS = [
  "ذكرني", "نبهني", "مهمة", "مهمه", "ملاحظة", "ملاحظه", "تذكيراتي", "مهامي", "ملاحظاتي", "صباحي", "مدينتي",
  "مصروف", "مصاريفي", "تصديرمصاريف", "حللمصاريف", "خطة", "خطه", "خطةبكرة", "خطهبكره", "خطتي",
  "تم", "خلصت", "انقللبكرة", "انقللبكره", "الغاءتذكير", "حذفمهمة", "حذفمهمه", "حذفملاحظة", "حذفملاحظه", "حذفمصروف",
  "ذاكرتي", "تذكر", "انسى", "انسي", "فويس", "قرآن", "قران", "أوامر", "اوامر"
];

// أوامر بتعرض بيانات: بدل ما نبعت القائمة زي ما هي، سام بيقرأها وبيجاوب بذكاء
const READ_COMMANDS = ["تذكيراتي", "مهامي", "ملاحظاتي", "مصاريفي", "خطتي", "ذاكرتي"];

function commandName(command) {
  return String(command || "").trim().slice(1).split(" ")[0].replace(/_/g, "");
}

export function isReadCommand(command) {
  return READ_COMMANDS.includes(commandName(command));
}

export function assistantActionInstruction() {
  return [
    "إذا طلب المستخدم صراحة إنشاء تذكير أو مهمة أو ملاحظة أو مصروف أو عرضها، أو تشغيل الملخص الصباحي، حوّل طلبه لأمر واحد من الأوامر أعلاه بنفس صيغتها",
    "(مثال: \"ذكرني بكرة الساعة 9 اتصل بأحمد\" -> /ذكرني بكرة الساعة 9 اتصل بأحمد ؛ \"سجل مهمة اشتري خبز\" -> /مهمة اشتري خبز ؛ \"صرفت خمسة دنانير على قهوة\" -> /مصروف 5 قهوة ؛ \"وريني مصاريفي\" -> /مصاريفي ؛ \"بدي مصاريفي اكسل\" -> /تصدير_مصاريف ؛ \"كم مجموع البنزين هالشهر\" -> /حلل_مصاريف كم مجموع البنزين هالشهر ؛ \"بكرة بدي اروح عالبنك الساعة 10 واخلص التقرير\" -> /خطة_بكرة اروح عالبنك الساعة 10، اخلص التقرير).",
    "أي سؤال عن المصاريف (مجموع تصنيف معين، فترة، مقارنة، تحليل، نصيحة توفير) استخدم /حلل_مصاريف <سؤاله كما هو> وليس /مصاريفي، لأن /مصاريفي بتعرض كل المصاريف بس.",
    "أي كلام عن صرف أو دفع مبلغ (صرفت، دفعت، اشتريت بكذا) هو مصروف: استخدم /مصروف <المبلغ بالأرقام مع العملة إذا مش دينار> <على شو>، وأبدًا لا تسجله /ملاحظة.",
    "إذا فيه أكثر من مصروف، حطهم كلهم بأمر /مصروف واحد مفصولين بـ و، مثال: /مصروف 20 دولار كلود و 22.5 انترنت (لا تكرر /مصروف بنفس الأمر).",
    "الأوامر المسموحة فقط: /ذكرني، /مهمة، /ملاحظة، /تذكيراتي، /مهامي، /ملاحظاتي، /تم <رقم>، /حذف_مهمة <رقم>، /حذف_ملاحظة <رقم>، /الغاء_تذكير <رقم>، /صباحي، /مدينتي، /مصروف، /مصاريفي، /حذف_مصروف <رقم>، /تصدير_مصاريف، /حلل_مصاريف، /خطة، /خطة_بكرة، /خطتي، /خلصت <رقم>، /انقل_لبكرة، /ذاكرتي، /تذكر <معلومة>، /انسى <رقم>، /فويس تشغيل|ايقاف|صوت، /قرآن ...، /أوامر.",
    "أي طلب يعرض بيانات المستخدم (شو مهامي، شو عندي تذكيرات، اعرضلي ملاحظاتي، وين وصلت بخطتي، شو بتعرف عني، احكيلي ذاكرتي، مصاريفي) حوّله للأمر المناسب (/مهامي، /تذكيراتي، /ملاحظاتي، /خطتي، /ذاكرتي، /مصاريفي) واكتب ردك كلمة وحدة قصيرة بس، لأن النظام رح يجيب البيانات ويجاوبه منها.",
    "\"تذكر إني ...\" أو \"احفظ عني ...\" -> /تذكر ... ؛ \"شغل الرد بالصوت\" -> /فويس تشغيل ؛ \"بدي أغير صوتك\" -> /فويس صوت ؛ \"شو الأوامر\" أو \"وريني القائمة\" -> /أوامر.",
    "إذا الطلب ناقص (مثلًا تذكير بدون وقت) لا تعطي أمر، واسأله عن الناقص.",
    "لما تعطي أمر، خلي ردك تأكيد قصير طبيعي بدون ما تكرر تفاصيل الأمر، لأن النظام بيبعت التفاصيل."
  ].join(" ");
}

// ذاكرة كل شخص: المعلومات المهمة بتطلع بنفس الرد بدون طلب إضافي
export const USER_MEMORY_INSTRUCTION = [
  "عندك ذاكرة عن المستخدم بالسياق (facts وearlier): استعملها بشكل طبيعي لما تفيد، وبدون ما تعددها أو تحكي إنها مخزنة.",
  "إذا المستخدم حكالك معلومة دائمة ومهمة عن حاله (اسمه، شغله، مدينته، عيلته، تفضيلاته، أهدافه، مواعيد مهمة) أو طلب تتذكر اشي، اكتب بآخر ردك سطر لحاله [[MEM: المعلومة باختصار بصيغة الغائب]].",
  "لا تحفظ السوالف العادية ولا الأسئلة العامة ولا الأشياء المؤقتة، ولا كلمات سر أو أرقام بطاقات.",
  "سطر MEM ما بيوصل للمستخدم، فلا تحكي عنه."
].join(" ");

export function currentTimeContext(now = new Date()) {
  const formatted = now.toLocaleString("ar-JO", { timeZone: TIME_ZONE, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `الوقت الحالي عند المستخدم: ${formatted} (${TIME_ZONE}).`;
}

/** يقبل الأمر فقط إذا كان من الأوامر الآمنة المسموحة. */
export function sanitizeAssistantCommand(command) {
  const value = String(command || "").trim().replace(/\s+/g, " ");
  if (!value.startsWith("/") || value.length > 300) return null;
  const name = commandName(value);
  if (!ALLOWED_COMMANDS.includes(name)) return null;
  // المسح الكامل بس بأمر مكتوب من المستخدم نفسه، مش من فهم الذكاء الاصطناعي
  if (/^(انسى|انسي)$/.test(name) && !/\d/.test(value)) return null;
  return value;
}

/** يفصل سطر [[CMD: /...]] عن نص الرد. */
export function extractAssistantCommand(text) {
  const source = String(text || "");
  const match = source.match(/\[\[\s*CMD\s*:\s*([^\]]+)\]\]/i);
  const reply = source.replace(/\[\[\s*CMD\s*:[^\]]*\]\]/gi, "").trim();
  return { reply, command: match ? sanitizeAssistantCommand(match[1]) : null };
}

/** ينفذ الأمر وبيرجع النصوص اللي كان رح يبعتها بدل ما يبعتها (الملفات زي الإكسل بتنبعت عادي). */
export async function captureAssistantCommand(sock, jid, sender, command) {
  const texts = [];
  const capturing = new Proxy(sock, {
    get(target, key) {
      if (key !== "sendMessage") return Reflect.get(target, key);
      return async (to, payload, options) => {
        if (payload && typeof payload.text === "string" && Object.keys(payload).every((k) => ["text", "mentions"].includes(k))) {
          // "بعتلك على الخاص" ما إلها معنى لما الرد نفسه بيوصل
          if (!/على الخاص\.?$/.test(payload.text.trim())) texts.push(payload.text);
          return null;
        }
        return target.sendMessage(to, payload, options);
      };
    }
  });
  const ran = await runAssistantCommand(capturing, jid, sender, command);
  return { ran, text: texts.join("\n\n") };
}

/** ينفذ الأمر كأنه المستخدم كتبه. يعيد true إذا انتفذ. */
export async function runAssistantCommand(sock, jid, sender, command) {
  const safe = sanitizeAssistantCommand(command);
  if (!safe) return false;
  try {
    if (/^\/(أوامر|اوامر)$/.test(safe)) {
      const { showCommandsList } = await import("../commands/commandsList.js");
      return await showCommandsList(sock, jid, sender);
    }
    if (/^\/(قرآن|قران)/.test(safe)) {
      const { handleQuranCommand } = await import("./quran.js");
      return await handleQuranCommand(sock, jid, safe);
    }
    if (/^\/(فويس)/.test(safe)) {
      const { handleVoiceCommand } = await import("./voiceReplies.js");
      return await handleVoiceCommand(sock, jid, sender, safe);
    }
    if (await handleAssistantHomeCommand(sock, jid, sender, safe, null)) return true;
    if (await handleExpenseQuestionCommand(sock, jid, sender, safe)) return true;
    if (await handleExpenseCommand(sock, jid, sender, safe)) return true;
    if (await handleDailyPlanCommand(sock, jid, sender, safe)) return true;
    return await handlePersonalCommand(sock, jid, sender, safe);
  } catch (error) {
    console.error("Assistant action failed:", error.message);
    return false;
  }
}
