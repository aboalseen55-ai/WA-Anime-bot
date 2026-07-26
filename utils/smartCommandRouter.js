import { generateSamBotAIJson, isSamBotAIAvailable } from "./samBotAI.js";

const AI_ROUTER_MAX_OUTPUT_TOKENS = Number(process.env.SAM_BOT_COMMAND_ROUTER_MAX_OUTPUT_TOKENS || 80);
const AI_HELP_MAX_OUTPUT_TOKENS = Number(process.env.SAM_BOT_COMMAND_HELP_MAX_OUTPUT_TOKENS || 120);

const SAFE_INTENTS = new Set([
  "show_profile",
  "show_level",
  "show_level_leaderboard",
  "show_points_leaderboard",
  "show_commands",
  "explain_command",
  "none"
]);

const SAFE_COMMANDS = {
  "/ملفي": {
    title: "ملفي",
    aliases: ["/ملفي", "/ملف", "ملفي", "ملف", "profile", "بروفايل", "حسابي"],
    description: "يعرض ملفك الشخصي: اللقب، الرتبة، المستوى، XP، النقاط، العملات، ورسائل اليوم."
  },
  "/مستواي": {
    title: "مستواي",
    aliases: ["/مستواي", "/مستوى", "/لفلي", "مستواي", "مستوى", "لفلي", "لفل", "level", "xp"],
    description: "يعرض مستوى XP الخاص بك، تقدمك للمستوى التالي، XP المحادثة، وXP الألعاب."
  },
  "/ترتيب_المستوى": {
    title: "ترتيب المستوى",
    aliases: ["/ترتيب_المستوى", "/ترتيب_اللفل", "ترتيب المستوى", "ترتيب اللفل", "level leaderboard", "ترتيب اللفلات"],
    description: "يعرض أعلى الأعضاء في ترتيب XP والمستويات داخل المملكة."
  },
  "/ترتيب": {
    title: "ترتيب النقاط",
    aliases: ["/ترتيب", "ترتيب", "leaderboard", "top", "ترتيب النقاط"],
    description: "يعرض جدول صدارة نقاط الألعاب."
  },
  "/أوامر": {
    title: "الأوامر",
    aliases: ["/أوامر", "/اوامر", "اوامر", "الأوامر", "الاوامر", "commands", "help"],
    description: "يعرض قائمة الأوامر التفاعلية المتاحة."
  },
  "/لقبي": {
    title: "لقبي",
    aliases: ["/لقبي", "لقبي", "nickname", "لقب"],
    description: "يسجل لقبك أو يغيره. أول تغيير مجاني، وبعدها قد يتم خصم عملات حسب النظام."
  },
  "/منشن": {
    title: "منشن",
    aliases: ["/منشن", "منشن", "mention"],
    description: "يعرض منشن عضو مسجل من خلال لقبه."
  },
  "/ألعاب": {
    title: "الألعاب",
    aliases: ["/ألعاب", "/العاب", "ألعاب", "العاب", "games"],
    description: "يعرض قائمة الألعاب. بدء الألعاب مخصص للمشرفين والإدارة."
  },
  "/مافيا": {
    title: "مافيا",
    aliases: ["/مافيا", "مافيا", "mafia"],
    description: "يفتح جلسة لعبة المافيا في المجموعة، والمرسل يصبح الراوي."
  }
};

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s@_/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text, words) {
  return words.some((word) => text.includes(normalizeText(word)));
}

function makeRoute(intent, command = null, confidence = 1, source = "local") {
  return { intent, command, confidence, source };
}

function findCommandInText(text) {
  const normalized = normalizeText(text);
  let bestCommand = null;
  let bestLength = 0;

  for (const [command, info] of Object.entries(SAFE_COMMANDS)) {
    for (const alias of info.aliases) {
      const normalizedAlias = normalizeText(alias);
      if (normalizedAlias.length > bestLength && normalized.includes(normalizedAlias)) {
        bestCommand = command;
        bestLength = normalizedAlias.length;
      }
    }
  }

  return bestCommand;
}

function classifyLocally(text) {
  const normalized = normalizeText(text);
  if (!normalized || normalized.startsWith("/")) return makeRoute("none", null, 0);

  const wantsExplain = hasAny(normalized, [
    "اشرح", "شرح", "فسر", "وضح", "شو يعني", "ايش يعني", "كيف استخدم",
    "how to", "explain", "what is", "شنو", "وش يعني"
  ]);

  if (wantsExplain) {
    const command = findCommandInText(normalized);
    if (command) return makeRoute("explain_command", command, 0.95);
  }

  if (hasAny(normalized, ["ترتيب المستوى", "ترتيب اللفل", "ترتيب اللفلات", "level leaderboard", "xp leaderboard"])) {
    return makeRoute("show_level_leaderboard", "/ترتيب_المستوى", 0.95);
  }

  if (hasAny(normalized, ["مستواي", "لفلي", "اللفل حقي", "level", "my xp", "اكس بي", "xp"])) {
    return makeRoute("show_level", "/مستواي", 0.92);
  }

  if (hasAny(normalized, ["ملفي", "بروفايلي", "بروفايل", "بروفيل", "البروفيل", "حسابي", "بياناتي", "profile", "my account", "show profile"])) {
    return makeRoute("show_profile", "/ملفي", 0.92);
  }

  if (hasAny(normalized, ["ترتيب النقاط", "ترتيب اللاعبين", "الترتيب", "leaderboard", "top players"])) {
    return makeRoute("show_points_leaderboard", "/ترتيب", 0.9);
  }

  if (hasAny(normalized, ["الاوامر", "اوامر", "قائمه الاوامر", "ساعدني بالاوامر", "كيف استخدم البوت", "كيف استعمل البوت", "commands", "help"])) {
    return makeRoute("show_commands", "/أوامر", 0.9);
  }

  return makeRoute("none", null, 0);
}

function shouldAskAI(text) {
  const normalized = normalizeText(text);
  if (!normalized || normalized.startsWith("/") || normalized.length > 220) return false;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount > 24) return false;
  if (/https?:\/\//i.test(text)) return false;
  if (hasAny(normalized, ["احذف مملكه", "حذف مملكه", "عدل مملكه", "طرد", "حظر", "تحويل", "اعطيني رمز", "كلمه السر"])) {
    return false;
  }

  return hasAny(normalized, [
    "ملف", "بروف", "حساب", "بيانات", "profile", "account",
    "مستوي", "لفل", "level", "xp", "اكس",
    "ترتيب", "leader", "top", "rank",
    "اوامر", "commands", "help", "شرح", "اشرح", "فسر", "وضح",
    "بغيت", "نحب", "عايز", "ابغي", "ابي", "وريني", "اشوف", "شوف"
  ]);
}

function parseJsonReply(reply) {
  const raw = String(reply || "").trim();
  if (!raw) return null;

  const jsonText = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const match = jsonText.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function normalizeAIRoute(value) {
  if (!value || typeof value !== "object") return makeRoute("none", null, 0, "ai");
  const intent = SAFE_INTENTS.has(value.intent) ? value.intent : "none";
  const command = SAFE_COMMANDS[value.command] ? value.command : null;
  const confidence = Math.max(0, Math.min(1, Number(value.confidence) || 0));

  if (intent === "none" || confidence < 0.58) return makeRoute("none", null, confidence, "ai");
  if (intent !== "explain_command") {
    const commandByIntent = {
      show_profile: "/ملفي",
      show_level: "/مستواي",
      show_level_leaderboard: "/ترتيب_المستوى",
      show_points_leaderboard: "/ترتيب",
      show_commands: "/أوامر"
    };
    return makeRoute(intent, commandByIntent[intent] || command, confidence, "ai");
  }

  return makeRoute(intent, command, confidence, "ai");
}

export async function classifySmartCommandRequest(text) {
  const localRoute = classifyLocally(text);
  if (localRoute.intent !== "none") return localRoute;
  if (!isSamBotAIAvailable() || !shouldAskAI(text)) return localRoute;

  const systemInstruction = [
    "You classify a WhatsApp message for Sam Bot.",
    "Return strict JSON only.",
    "Allowed intents: show_profile, show_level, show_level_leaderboard, show_points_leaderboard, show_commands, explain_command, none.",
    "Allowed commands: /ملفي, /مستواي, /ترتيب_المستوى, /ترتيب, /أوامر, /لقبي, /منشن, /ألعاب, /مافيا.",
    "Understand Arabic dialects, Moroccan, Algerian, Egyptian, Levantine, Gulf, English, and Arabizi.",
    "Only safe read/help actions. For delete, edit, ban, kick, transfer, passwords, kingdoms management, or unclear requests return none.",
    "If user asks to see their profile/account/data return show_profile.",
    "If user asks their level/xp return show_level.",
    "If user asks to explain a command return explain_command with the closest allowed command.",
    "JSON shape: {\"intent\":\"show_profile\",\"command\":\"/ملفي\",\"confidence\":0.9}"
  ].join(" ");

  const prompt = `message:${text}`;
  const reply = await generateSamBotAIJson({
    systemInstruction,
    prompt,
    maxOutputTokens: AI_ROUTER_MAX_OUTPUT_TOKENS
  });

  return normalizeAIRoute(parseJsonReply(reply));
}

export async function buildSmartCommandExplanation(command) {
  const info = SAFE_COMMANDS[command] || SAFE_COMMANDS["/أوامر"];
  if (!isSamBotAIAvailable()) {
    return `أمر ${command}: ${info.description}`;
  }

  const systemInstruction = [
    "أنت سام بوت.",
    "اشرح أمر واتساب واحد فقط بلهجة عربية سهلة.",
    "الرد قصير وواضح، سطر أو سطرين.",
    "لا تضف أوامر غير مذكورة."
  ].join(" ");
  const prompt = [
    `command:${command}`,
    `name:${info.title}`,
    `description:${info.description}`
  ].join("\n");

  const reply = await generateSamBotAIJson({
    systemInstruction,
    prompt,
    maxOutputTokens: AI_HELP_MAX_OUTPUT_TOKENS
  });

  return reply || `أمر ${command}: ${info.description}`;
}
