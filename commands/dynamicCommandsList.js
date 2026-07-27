// قائمة ديناميكية مختصرة للأوامر
import { COMMANDS_REGISTRY, formatCommandList } from "./commandsRegistry.js";
import { isAdmin, isModerator } from "./adminSystem.js";
import { getKingdomIdFromGroupJid } from "../config.js";

export async function showDynamicCommandsList(sock, jid, sender) {
  const kingdom = getKingdomIdFromGroupJid(jid);
  const userIsAdmin = await isAdmin(sender, kingdom);
  const userIsModerator = await isModerator(sender, kingdom);

  const rows = [
    ["1", "👤", "أوامر الأعضاء"],
    ["2", "🎮", "أوامر الألعاب"],
    ["3", "💰", "البنك والعملات"]
  ];

  if (userIsModerator) rows.push(["4", "🛡️", "أوامر المشرفين"]);
  if (userIsAdmin) {
    rows.push(["5", "👑", "أوامر الأدمن"]);
    rows.push(["6", "⭐", "الرتب والنجوم"]);
  }

  rows.push(["7", "🔎", "البحث والمعلومات"]);
  rows.push(["8", "🔍", "البحث في الأوامر"]);

  const text = [
    "*📋 قائمة الأوامر*",
    "اختر رقم القائمة:",
    "",
    ...rows.map(([number, emoji, label]) => `${emoji} ${number}. ${label}`),
    "",
    "اكتب الرقم فقط."
  ].join("\n");

  await sock.sendMessage(jid, { text });
}

export async function showCategoryCommands(sock, jid, category, title, userPermissions = {}) {
  const commands = COMMANDS_REGISTRY[category] || [];
  let filteredCommands = commands;

  if (category === "moderator" && !userPermissions.isModerator && !userPermissions.isAdmin) {
    filteredCommands = [];
  }
  if (category === "admin" && !userPermissions.isAdmin) {
    filteredCommands = [];
  }

  if (!filteredCommands.length) {
    await sock.sendMessage(jid, { text: "❌ لا تملك صلاحية لهذه القائمة." });
    return;
  }

  const text = `${formatCommandList(filteredCommands, title)}\nاكتب /أوامر للرجوع.`.trim();
  await sock.sendMessage(jid, { text });
}

export async function searchInCommands(sock, jid, query, userPermissions = {}) {
  const { searchCommands } = await import("./commandsRegistry.js");
  let results = searchCommands(query);

  results = results.filter((cmd) => {
    if (cmd.permission === "admin" && !userPermissions.isAdmin) return false;
    if (cmd.permission === "moderator" && !userPermissions.isModerator && !userPermissions.isAdmin) return false;
    return true;
  });

  if (!results.length) {
    await sock.sendMessage(jid, { text: `❌ لم أجد أمرًا يطابق: ${query}` });
    return;
  }

  const text = [
    `*🔍 نتائج البحث: ${query}*`,
    "",
    ...results.map((cmd) => `▪️ ${cmd.emoji} ${cmd.command} — ${cmd.description}`),
    "",
    "اكتب /أوامر للرجوع."
  ].join("\n");

  await sock.sendMessage(jid, { text });
}

export async function handleDynamicCommandsChoice(sock, jid, sender, text) {
  const kingdom = getKingdomIdFromGroupJid(jid);
  const userPermissions = {
    isAdmin: await isAdmin(sender, kingdom),
    isModerator: await isModerator(sender, kingdom)
  };

  const choice = text.trim();

  switch (choice) {
    case "1":
      await showCategoryCommands(sock, jid, "member", "👤 أوامر الأعضاء", userPermissions);
      break;
    case "2":
      await showCategoryCommands(sock, jid, "games", "🎮 أوامر الألعاب", userPermissions);
      break;
    case "3":
      await showCategoryCommands(sock, jid, "bank", "💰 البنك والعملات", userPermissions);
      break;
    case "4":
      if (!userPermissions.isModerator) {
        await sock.sendMessage(jid, { text: "❌ هذه القائمة للمشرفين فقط." });
        return;
      }
      await showCategoryCommands(sock, jid, "moderator", "🛡️ أوامر المشرفين", userPermissions);
      break;
    case "5":
      if (!userPermissions.isAdmin) {
        await sock.sendMessage(jid, { text: "❌ هذه القائمة للأدمن فقط." });
        return;
      }
      await showCategoryCommands(sock, jid, "admin", "👑 أوامر الأدمن", userPermissions);
      break;
    case "6":
      if (!userPermissions.isAdmin) {
        await sock.sendMessage(jid, { text: "❌ هذه القائمة للأدمن فقط." });
        return;
      }
      await showLegacyRanksSystem(sock, jid);
      break;
    case "7":
      await showCategoryCommands(sock, jid, "search", "🔎 البحث والمعلومات", userPermissions);
      break;
    case "8":
      await sock.sendMessage(jid, { text: "*🔍 البحث في الأوامر*\nاكتب: بحث كلمة\nمثال: بحث نقاط" });
      break;
    default:
      await sock.sendMessage(jid, { text: "❌ اختيار غير صحيح. اكتب رقم من القائمة." });
  }
}

async function showLegacyRanksSystem(sock, jid) {
  const text = [
    "*⭐ الرتب والنجوم*",
    "▪️ نواب الأدميرال — 24000 نجم",
    "▪️ العميد — 15000 نجم",
    "▪️ التشيبوكاي — 6500 نجم",
    "▪️ ملازم — 1500 نجم",
    "▪️ بيرق — 800 نجم",
    "▪️ راية — 500 نجم",
    "▪️ مشرف متدرب — 400 نجم",
    "",
    "اكتب /أوامر للرجوع."
  ].join("\n");

  await sock.sendMessage(jid, { text });
}
