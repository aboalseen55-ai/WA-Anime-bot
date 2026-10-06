import { handleWelcomeModeStep } from "../commands/adminCommands.js";
import { addRecentMessage } from "../utils/messageCache.js";
import User from "../database/userModel.js";
import { getKingdomIdFromGroupJid } from "../config.js";
import { handleMafiaCommand, handleMafiaHostPrivateFlow, handleMafiaNicknameRegistration } from "../games/mafia.js";
import { getCreatorInfoMessage, isCreatorQuestion } from "../utils/creatorInfo.js";
import { handleDeveloperCommandGuide } from "../utils/developerCommandGuide.js";
import { buildIdentityInfoMessage, isIdentityCommand } from "../utils/identityInfo.js";
import { handleKingdomDeleteStep, handleStartKingdomDelete } from "../utils/kingdomDelete.js";
import { handleKingdomEditStep, handleStartKingdomEdit } from "../utils/kingdomEdit.js";
import { handleDeveloperKingdomCommand, handleKingdomRegistrationStep, handleStartKingdomRegistration } from "../utils/kingdomRegistration.js";
import { handleSamBotInteraction } from "../utils/samBotIntelligence.js";
import { handleNaturalExpense } from "../utils/expenses.js";
import { featureEnabled, denyCommandIfPaused } from '../services/botControls.js';
import { handleBusinessMessage } from '../services/businessMode.js';
import { handleFirstContact } from "../utils/assistantHome.js";
import { handleMediaAssistant } from "../utils/mediaAssistant.js";
import { enforceGroupProtection, recordGroupMessage } from "../utils/groupTools.js";
import { handleSamBotTokenCountCommand, handleSamBotUsageCommand } from "../utils/samBotUsage.js";
import { trackMainGroupActivity } from "./activityTracking.js";
import { checkAndSendMilestoneMessage } from "./milestones.js";
import { handleWordGameSetup, handleGamesMenuCommand, handleGameCommands, handleActiveGameResponses } from "./gameCommands.js";
import { handleCommandsMenuCommand, handleSeriesSelection, handleSlashCommand, handleQuranText, handleSmartCommandRoute, handleCommandsMenuChoice } from "./commandRouting.js";
import { handlePendingMention, handleReportReason } from "./pendingMentionFlow.js";
import { handleKickConfirmation, handleEmperorPassword } from "./adminConfirmations.js";
import { handleWelcomeImageChoice, handleWelcomeConfirmation } from "./welcomeFlow.js";
import { handleProfileChoice } from "./profileChoices.js";
import { handleReceptionRegistration } from "./receptionRegistration.js";

// الحالات المشتركة موجودة في handlerState.js، وتُعاد تصديرها هنا للتوافقية
export {
  pendingMentions,
  awaitingGameChoice,
  awaitingCommandsChoice,
  awaitingEmperorPassword,
  awaitingNicknameRegistration,
  pendingKick,
  nicknameRegistrationStages,
  awaitingWelcomeImage
} from "./handlerState.js";

// (نظام حذف الرسائل يُدار عبر وحدة منفصلة في utils/messageCache.js)

// كل معالج يرجع true إذا تعامل مع الرسالة، والترتيب هنا يحدد الأولوية
export async function messageHandler(sock, msg) {
  if (!featureEnabled('replies')) return;
  if (!msg.message) return;

  const jid = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
  if (await denyCommandIfPaused(sock, jid, sender, text)) return;

  // حفظ رسالة في الـ cache لاستخدامها في حذف مجموعة رسائل لاحقاً
  addRecentMessage(jid, msg.key);

  // حماية المجموعة (روابط وسبام) قبل أي معالجة، ثم حفظ النص لأمر /ملخص
  if (await enforceGroupProtection(sock, msg)) return;
  recordGroupMessage(jid, msg.pushName, text);

  let kingdom = await trackMainGroupActivity(sock, msg, jid, sender, text);

  // التحقق من عدد الأعضاء وإرسال رسالة التشجيع إذا لزم الأمر
  if (!kingdom) {
    kingdom = getKingdomIdFromGroupJid(jid);
  }
  await checkAndSendMilestoneMessage(sock, jid, kingdom);

  if (await handleWordGameSetup(sock, jid, sender, text)) return;

  // المساعد الشخصي: تعريف أول مرة بالخاص، ثم الفويسات والصور وملفات PDF
  await handleFirstContact(sock, msg);
  if (await handleMediaAssistant(sock, msg, text)) return;

  if (!text) return;

  const trimmedText = text.trim();

  if (isCreatorQuestion(trimmedText)) {
    await sock.sendMessage(jid, { text: getCreatorInfoMessage() });
    return;
  }

  if (isIdentityCommand(trimmedText)) {
    await sock.sendMessage(jid, { text: buildIdentityInfoMessage(msg, sender, jid) });
    return;
  }

  if (await handleMafiaHostPrivateFlow(sock, jid, sender, trimmedText)) return;
  if (await handleMafiaNicknameRegistration(sock, jid, sender, trimmedText)) return;
  if (await handleMafiaCommand(sock, jid, sender, trimmedText)) return;
  if (await handleDeveloperCommandGuide(sock, jid, sender, trimmedText)) return;
  if (await handleSamBotTokenCountCommand(sock, jid, sender, trimmedText)) return;
  if (await handleSamBotUsageCommand(sock, jid, sender, trimmedText)) return;
  if (await handleDeveloperKingdomCommand(sock, jid, sender, trimmedText)) return;
  if (await handleStartKingdomDelete(sock, jid, sender, trimmedText)) return;
  if (await handleKingdomDeleteStep(sock, jid, sender, trimmedText)) return;
  if (await handleStartKingdomEdit(sock, jid, sender, trimmedText)) return;
  if (await handleKingdomEditStep(sock, jid, sender, trimmedText)) return;
  if (await handleStartKingdomRegistration(sock, jid, sender, trimmedText, msg)) return;
  if (await handleKingdomRegistrationStep(sock, jid, sender, trimmedText)) return;

  if (await handleBusinessMessage(sock, msg, trimmedText)) return;

  // البحث عن المستخدم (بدون تسجيل تلقائي)
  const user = await User.findOne({ jid: sender, kingdom_id: kingdom });

  // التحقق من حظر المستخدم
  if (user && user.isBanned) {
    return; // تجاهل الرسائل من المحظورين
  }

  if (await handleGamesMenuCommand(sock, jid, sender, trimmedText, kingdom)) return;
  if (await handleCommandsMenuCommand(sock, jid, sender, trimmedText)) return;
  if (await handleGameCommands(sock, jid, sender, trimmedText, kingdom)) return;
  if (await handleActiveGameResponses(sock, jid, sender, text)) return;
  if (await handlePendingMention(sock, jid, sender, msg)) return;
  if (await handleKickConfirmation(sock, jid, sender, trimmedText, kingdom)) return;

  // الأوامر
  if (await handleSeriesSelection(sock, jid, sender, trimmedText, msg)) return;
  if (await handleSlashCommand(sock, jid, sender, trimmedText, msg)) return;
  if (await handleQuranText(sock, jid, trimmedText)) return;
  if (await handleSmartCommandRoute(sock, jid, sender, trimmedText, msg)) return;

  if (await handleWelcomeModeStep(sock, jid, sender, text)) return;
  if (await handleWelcomeImageChoice(sock, jid, text)) return;
  if (await handleWelcomeConfirmation(sock, jid, text)) return;
  if (await handleProfileChoice(sock, jid, sender, text)) return;
  if (await handleReportReason(sock, jid, sender, text, kingdom)) return;
  if (await handleCommandsMenuChoice(sock, jid, sender, text, kingdom)) return;
  if (await handleEmperorPassword(sock, sender, text)) return;
  if (await handleReceptionRegistration(sock, jid, sender, text, msg)) return;

  // تفاعل سام بوت الذكي: يرد فقط إذا الكلام موجه له أو في الخاص أو بالرد على رسالته.
  // "صرفت 5 على قهوة" بالخاص = مصروف، مش ملاحظة
  if (await handleNaturalExpense(sock, jid, sender, trimmedText)) return;
  if (featureEnabled('ai')) {
    await handleSamBotInteraction(sock, jid, sender, text, msg);
  }
}
