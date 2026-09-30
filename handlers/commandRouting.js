import { dashboardReply } from '../services/dashboardTemplates.js';
import { userCommands } from "../commands/user.js";
import { handleAdminCommands } from "../commands/adminCommands.js";
import { showCommandsList, handleCommandsChoice } from "../commands/commandsList.js";
import { isModerator } from "../commands/adminSystem.js";
import { showLeaderboard } from "../games/guessAnime.js";
import { denyCommandIfPaused } from '../services/botControls.js';
import { buildSmartCommandExplanation, classifySmartCommandRequest } from "../utils/smartCommandRouter.js";
import { handleQuranCommand, isQuranCommand } from "../utils/quran.js";
import { handlePersonalCommand } from "../utils/personalAssistant.js";
import { handleDashboardCommand, getSeriesSession, selectSeriesResult } from "../services/dashboardRuntime.js";
import { handleBotDeletion } from '../services/botMessageDeletion.js';
import { awaitingCommandsChoice, awaitingGameChoice } from "./handlerState.js";
import { sendGamesMenu } from "./gameCommands.js";

// دعم جميع صيغ أمر الأوامر: /أوامر، /اوامر، /الأوامر، /الاوامر
const commandsTriggers = ["/أوامر", "/اوامر", "/الأوامر", "/الاوامر"];

export async function handleCommandsMenuCommand(sock, jid, sender, trimmedText) {
  if (!commandsTriggers.includes(trimmedText)) return false;
  awaitingCommandsChoice.add(sender);
  await showCommandsList(sock, jid, sender);
  return true;
}

// If the user is sending a numeric selection and has an active series session, handle it here
export async function handleSeriesSelection(sock, jid, sender, trimmedText, msg) {
  if (!/^[1-9][0-9]*$/.test(trimmedText)) return false;
  const session = getSeriesSession(sender, jid);
  if (!session) return false;

  const index = Number(trimmedText) - 1;
  try {
    await selectSeriesResult(sender, index, sock, jid, msg);
  } catch (err) {
    console.warn('Series selection failed:', err.message);
    await sock.sendMessage(jid, { text: 'اختيار غير صالح أو فشل التحميل.' });
  }
  return true;
}

export async function handleSlashCommand(sock, jid, sender, trimmedText, msg) {
  if (!trimmedText.startsWith("/")) return false;

  console.log(`📥 [CMD] ${sender} -> ${trimmedText}`);

  if (await handleBotDeletion(sock, jid, sender, trimmedText)) return true;
  // Dashboard commands must run before the built-in unknown-command fallback.
  if (await handleDashboardCommand(sock, jid, sender, trimmedText, msg)) {
    return true;
  }

  if (isQuranCommand(trimmedText)) {
    await handleQuranCommand(sock, jid, trimmedText);
    return true;
  }

  if (await handlePersonalCommand(sock, jid, sender, trimmedText)) return true;

  // إذا لم يكن أمر الأوامر (تمت معالجته أعلاه)
  if (!commandsTriggers.includes(trimmedText)) {
    const handledByUser = await userCommands(sock, jid, sender, trimmedText, msg);
    const handledByAdmin = await handleAdminCommands(sock, jid, trimmedText, sender, msg);

    if (!handledByUser && !handledByAdmin) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_e760c62a7333ac5c')`❌ الأمر غير معروف: ${trimmedText}` });
    }
  }
  return true;
}

export async function handleQuranText(sock, jid, trimmedText) {
  if (!isQuranCommand(trimmedText)) return false;
  await handleQuranCommand(sock, jid, trimmedText);
  return true;
}

export async function handleSmartCommandRoute(sock, jid, sender, trimmedText, msg) {
  const smartCommandRoute = await classifySmartCommandRequest(trimmedText);
  if (smartCommandRoute.intent === "none") return false;

  if (smartCommandRoute.command && await denyCommandIfPaused(sock, jid, sender, smartCommandRoute.command)) return true;
  console.log(`🧭 [SMART_CMD:${smartCommandRoute.source}] ${sender} -> ${smartCommandRoute.intent} (${smartCommandRoute.command || "-"})`);

  if (smartCommandRoute.intent === "show_profile") {
    await userCommands(sock, jid, sender, "/ملفي", msg);
    await handleAdminCommands(sock, jid, "/ملفي", sender, msg);
    return true;
  }

  if (smartCommandRoute.intent === "show_level") {
    await userCommands(sock, jid, sender, "/مستواي", msg);
    return true;
  }

  if (smartCommandRoute.intent === "show_level_leaderboard") {
    await userCommands(sock, jid, sender, "/ترتيب_المستوى", msg);
    return true;
  }

  if (smartCommandRoute.intent === "show_points_leaderboard") {
    await showLeaderboard(sock, jid);
    return true;
  }

  if (smartCommandRoute.intent === "show_commands") {
    awaitingCommandsChoice.add(sender);
    await showCommandsList(sock, jid, sender);
    return true;
  }

  if (smartCommandRoute.intent === "explain_command") {
    const explanation = await buildSmartCommandExplanation(smartCommandRoute.command || "/أوامر");
    await sock.sendMessage(jid, { text: explanation });
    return true;
  }

  return false;
}

// معالجة اختيارات قائمة الأوامر
export async function handleCommandsMenuChoice(sock, jid, sender, text, kingdom) {
  if (!(awaitingCommandsChoice.has(sender) && /^[1-7]$/.test(text.trim()))) return false;

  const choice = text.trim();
  if (choice === '2') {
    // user asked for games list via /أوامر; provide the interactive menu
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_2cde6253a66bdae5')(['❌ فقط المشرفون والأدمن يمكنهم بدء الألعاب!']) });
      awaitingCommandsChoice.delete(sender);
      return true;
    }
    awaitingCommandsChoice.delete(sender);
    awaitingGameChoice.add(sender);
    await sendGamesMenu(sock, jid);
    return true;
  }

  await handleCommandsChoice(sock, jid, sender, text);
  awaitingCommandsChoice.delete(sender);
  return true;
}
