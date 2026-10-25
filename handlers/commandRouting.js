import { dashboardReply } from '../services/dashboardTemplates.js';
import { userCommands } from "../commands/user.js";
import { handleAdminCommands } from "../commands/adminCommands.js";
import { showCommandsList, handleCommandsMenuReply, isMenuTrigger } from "../commands/commandsList.js";
import { showLeaderboard } from "../games/guessAnime.js";
import { denyCommandIfPaused } from '../services/botControls.js';
import { funEnabled, personalEnabled } from '../services/botMode.js';
import { buildSmartCommandExplanation, classifySmartCommandRequest } from "../utils/smartCommandRouter.js";
import { handleQuranCommand, isQuranCommand } from "../utils/quran.js";
import { handlePersonalCommand } from "../utils/personalAssistant.js";
import { handleBotStatusCommand } from "../utils/botStatus.js";
import { handleAssistantHomeCommand } from "../utils/assistantHome.js";
import { handleVoiceCommand } from "../utils/voiceReplies.js";
import { handleExpenseCommand } from "../utils/expenses.js";
import { handleExpenseQuestionCommand } from "../utils/expenseInsights.js";
import { handleDailyPlanCommand } from "../utils/dailyPlan.js";
import { handleGroupCommand } from "../utils/groupTools.js";
import { handleDashboardCommand, getSeriesSession, selectSeriesResult } from "../services/dashboardRuntime.js";
import { handleBotDeletion } from '../services/botMessageDeletion.js';

// /أوامر و/مساعدة بكل صيغها بتفتح القائمة المرقمة حسب المود
export async function handleCommandsMenuCommand(sock, jid, sender, trimmedText) {
  if (!isMenuTrigger(trimmedText)) return false;
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

  if (await handleCommandsMenuCommand(sock, jid, sender, trimmedText)) return true;

  if (isQuranCommand(trimmedText)) {
    await handleQuranCommand(sock, jid, trimmedText);
    return true;
  }

  const personal = personalEnabled();
  if (personal) {
    if (await handleAssistantHomeCommand(sock, jid, sender, trimmedText, msg)) return true;
    if (await handleVoiceCommand(sock, jid, sender, trimmedText)) return true;
  }
  if (await handleGroupCommand(sock, jid, sender, trimmedText, msg)) return true;
  if (personal) {
    if (await handleExpenseQuestionCommand(sock, jid, sender, trimmedText)) return true;
    if (await handleExpenseCommand(sock, jid, sender, trimmedText)) return true;
    if (await handleDailyPlanCommand(sock, jid, sender, trimmedText)) return true;
    if (await handlePersonalCommand(sock, jid, sender, trimmedText)) return true;
  }
  if (await handleBotStatusCommand(sock, jid, sender, trimmedText)) return true;

  if (!funEnabled()) {
    await sock.sendMessage(jid, { text: `❌ الأمر غير معروف: ${trimmedText}\nاكتب /مساعدة لتشوف الأوامر.` });
    return true;
  }

  const handledByUser = await userCommands(sock, jid, sender, trimmedText, msg);
  const handledByAdmin = await handleAdminCommands(sock, jid, trimmedText, sender, msg);

  if (!handledByUser && !handledByAdmin) {
    await sock.sendMessage(jid, { text: dashboardReply('reply_e760c62a7333ac5c')`❌ الأمر غير معروف: ${trimmedText}` });
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

// رقم من قائمة الأوامر المفتوحة (بكل الأوضاع)
export async function handleCommandsMenuChoice(sock, jid, sender, text) {
  return handleCommandsMenuReply(sock, jid, sender, text);
}
