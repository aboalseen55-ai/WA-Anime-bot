import { userCommands } from "../commands/user.js";
import { handleAdminCommands } from "../commands/adminCommands.js";
import { showCommandsList, handleCommandsChoice } from "../commands/commandsList.js";
import { addRecentMessage } from "../utils/messageCache.js";
import { isSuperAdminInKingdom, isModerator, extractAndSaveUserFromMention, grantEmperorRankWithPassword, getPhoneFromJID, startGameSession, stopGameSession, generateAdminDailyReport, getDailyGameStats, deleteUser } from "../commands/adminSystem.js";
import User from "../database/userModel.js";
import { WELCOME_LINK, getKingdomIdFromGroupJid } from "../config.js";
import { startGuessAnime, handleGuessAnimeResponse, activeGames, showLeaderboard, stopGuessAnime } from "../games/guessAnime.js";
import { startWordGame, checkWordGuess, activeWordGames, stopWordGame, wordGameWaiting, handleWordGameModeSelection, handleWordGamePlayersSelection } from "../games/wordtype.js";
import { startGuessCharacter, checkCharacterGuess, activeCharacterGames, characterGameWaiting, handleGuessCharacterResponse, handleCharacterPlayersSelection, stopGuessCharacter } from "../games/guessCharacter.js";
import { startUnscrambleGame, checkUnscrambleGuess, activeUnscrambleGames, unscrambleGameWaiting, handleUnscrambleResponse, handleUnscramblePlayersSelection, stopUnscrambleGame } from "../games/unscramble.js";
import { startWordSplitterGame, checkWordSplitterGuess, activeWordSplitterGames, wordSplitterGameWaiting, handleWordSplitterModeSelection, handleWordSplitterPlayersSelection, stopWordSplitterGame } from "../games/wordSplitter.js";
import { startFlagGame, handleFlagGameResponse, activeGames as activeFlagGames, checkGuess as checkFlagGuess } from "../games/flagGame.js";
import { clearAnswerQueue } from "../utils/answerQueue.js";
import { getCreatorInfoMessage, isCreatorQuestion } from "../utils/creatorInfo.js";
import { handleDeveloperCommandGuide } from "../utils/developerCommandGuide.js";
import { buildIdentityInfoMessage, isIdentityCommand } from "../utils/identityInfo.js";
import { handleKingdomEditStep, handleStartKingdomEdit } from "../utils/kingdomEdit.js";
import { handleDeveloperKingdomCommand, handleKingdomRegistrationStep, handleStartKingdomRegistration } from "../utils/kingdomRegistration.js";
import { handleSamBotInteraction } from "../utils/samBotIntelligence.js";
import { handleSamBotTokenCountCommand, handleSamBotUsageCommand } from "../utils/samBotUsage.js";

// نظام الحالات - لتتبع الأوامر المعلقة التي تحتاج تأكيد منشن
export const pendingMentions = {};

// نظام الحالات - لتتبع المستخدمين الذين ينتظرون اختيار قائمة الألعاب
export const awaitingGameChoice = new Set();

// نظام الحالات - لتتبع المستخدمين الذين ينضرون لاختيار قائمة الأوامر
export const awaitingCommandsChoice = new Set();

// نظام الحالات - لتتبع الأدمنز الذين ينتظرون كلمة السر لمنح رتبة الإمبراطور
export const awaitingEmperorPassword = new Map();

// نظام الحالات - لتتبع المستخدمين الجدد الذين ينتظرون تسجيل لقبهم
export const awaitingNicknameRegistration = new Set();

// نظام الحالات - لتتبع طلبات حذف بيانات المطرودين
export const pendingKick = {};

// نظام الحالات - لتتبع مراحل التسجيل المتقدمة
// { userJid: { stage: 'welcome'|'nicknameInput'|'nicknameConfirmation'|'enteringSource', nickname: string } }
export const nicknameRegistrationStages = {};

// نظام الحالات - لتتبع الأدمنز الذين ينتظرون إرسال صورة الترحيب
export const awaitingWelcomeImage = {};

// نظام الحالات - لتتبع الرسائل المرسلة للتشجيع على الوصول لـ 50 عضو
const milestoneMessagesSent = new Set();

// (نظام حذف الرسائل يُدار عبر وحدة منفصلة في utils/messageCache.js)

// دالة للتحقق من عدد الأعضاء وإرسال رسالة التشجيع
async function checkAndSendMilestoneMessage(sock, jid, kingdom) {
  try {
    // التحقق من تفعيل الرسائل التحفيزية
    const { ENABLE_MOTIVATIONAL_MESSAGES } = await import('../config.js');
    if (!ENABLE_MOTIVATIONAL_MESSAGES) {
      return; // الرسائل التحفيزية معطلة
    }

    // التحقق من أن هذا القروب الأساسي للمملكة
    const { KINGDOMS } = await import('../config.js');
    const kingdomData = KINGDOMS[kingdom];
    if (!kingdomData || kingdomData.mainGroup !== jid) {
      return; // ليس القروب الأساسي
    }

    // عد أعضاء القروب
    const groupMetadata = await sock.groupMetadata(jid);
    const memberCount = groupMetadata.participants.length;

    // إرسال رسائل تشجيع قبل الوصول لـ 50 عضو
    await sendMotivationalMessages(sock, jid, memberCount, kingdom);

    // إذا وصلنا إلى 50 عضو، أرسل الرسالة النهائية
    if (memberCount >= 50) {
      if (!milestoneMessagesSent.has(`${kingdom}_50_members`)) {
        const encouragementMessage = `🎉 *مبروك! وصلتم إلى 50 عضو!* 🎉

🏰 أنتم الآن في مملكة كلوفر الأسطورية - مملكة النجوم السوداء! 🏰

🌟 كل واحد منكم نجمة لامعة في سماء المملكة 🌟
💪 قوتكم تجمع ووحدتكم تبهر العوالم 💪

🎯 الآن أنتم مستعدون لفتح فرع جديد للمملكة! 🎯
🚀 قريباً ستحصلون على قروب إضافي للمملكة 🚀

🏆 استمروا في التميز والإبداع - مستقبلكم مشرق! 🏆

🍀 مملكة كلوفر تفتخر بكم! 🍀

🎊 *تهانينا لجميع أعضاء مملكة كلوفر!*
💫 *أنتم الأفضل والأقوى!*`;

        await sock.sendMessage(jid, { text: encouragementMessage });
        milestoneMessagesSent.add(`${kingdom}_50_members`);
        console.log(`✅ تم إرسال رسالة الوصول لـ 50 عضو لمملكة ${kingdom}`);
      }
    }
  } catch (error) {
    console.error('خطأ في إرسال رسالة التشجيع:', error);
  }
}

// دالة إرسال رسائل التحفيز قبل الوصول لـ 50 عضو
async function sendMotivationalMessages(sock, jid, memberCount, kingdom) {
  // التحقق من تفعيل الرسائل التحفيزية
  const { ENABLE_MOTIVATIONAL_MESSAGES } = await import('../config.js');
  if (!ENABLE_MOTIVATIONAL_MESSAGES) {
    return; // الرسائل التحفيزية معطلة
  }

  const motivationalMilestones = [
    { count: 40, messageKey: '40_members' },
    { count: 45, messageKey: '45_members' },
    { count: 48, messageKey: '48_members' },
    { count: 49, messageKey: '49_members' }
  ];

  for (const milestone of motivationalMilestones) {
    if (memberCount === milestone.count && !milestoneMessagesSent.has(`${kingdom}_${milestone.messageKey}`)) {
      const remaining = 50 - memberCount;
      const message = getMotivationalMessage(memberCount, remaining, kingdom);
      await sock.sendMessage(jid, { text: message });
      milestoneMessagesSent.add(`${kingdom}_${milestone.messageKey}`);
      console.log(`✅ تم إرسال رسالة التحفيز لـ ${memberCount} عضو لمملكة ${kingdom}`);
      break; // أرسل رسالة واحدة فقط في كل مرة
    }
  }
}

// دالة إنشاء رسالة التحفيز
function getMotivationalMessage(currentCount, remaining, kingdom) {
  const messages = {
    40: `🚀 *دعوة للتحدي في مملكة كلوفر* 🚀

🌟 مبروك! وصلتم إلى 40 عضو في مملكة كلوفر! 🌟

🏰 أنتم في مملكة كلوفر الأسطورية - مملكة النجوم السوداء! 🏰

🎯 تبقى فقط ${remaining} خطوة للوصول إلى 50 عضو! 🎯
💪 قوتكم مذهلة وروحكم الجماعية رائعة! 💪

🚀 استمروا في الدعوة والمشاركة - الفرع الجديد ينتظركم! 🚀
🌟 كل عضو جديد يقربكم من الانتصار! 🌟

🍀 مملكة كلوفر تشجعكم على الاستمرار! 🍀

🔥 *أنتم على بعد ${remaining} عضو من الانتصار الكبير!*`,

    45: `⚡ *اقتراب النصر في مملكة كلوفر* ⚡

🎯 مبروك! وصلتم إلى 45 عضو في مملكة كلوفر! 🎯

🏰 أنتم في مملكة كلوفر الأسطورية - مملكة النجوم السوداء! 🏰

🔥 تبقى فقط ${remaining} خطوة للوصول إلى 50 عضو! 🔥
💪 قوتكم مذهلة وإصراركم يلهم الجميع! 💪

🚀 الفرع الجديد على الأبواب - استمروا في الدعوة! 🚀
🌟 كل صديق تدعونه يقربكم من الفوز! 🌟

🍀 مملكة كلوفر تؤمن بقدراتكم! 🍀

🎯 *${remaining} عضو فقط وتحققون الحلم!*`,

    48: `🏆 *على أعتاب النصر في مملكة كلوفر* 🏆

🎉 مبروك! وصلتم إلى 48 عضو في مملكة كلوفر! 🎉

🏰 أنتم في مملكة كلوفر الأسطورية - مملكة النجوم السوداء! 🏰

⚡ تبقى فقط ${remaining} خطوة للوصول إلى 50 عضو! ⚡
💪 قوتكم مذهلة وإصراركم يبهر العوالم! 💪

🚀 الفرع الجديد على بعد خطوات - لا تتوقفوا الآن! 🚀
🌟 كل جهد تبذلونه يقربكم من النجاح! 🌟

🍀 مملكة كلوفر تفخر بإصراركم! 🍀

🔥 *أنتم على بعد ${remaining} عضو من الانتصار التاريخي!*`,

    49: `🎯 *اللمسة الأخيرة في مملكة كلوفر* 🎯

🎊 مبروك! وصلتم إلى 49 عضو في مملكة كلوفر! 🎊

🏰 أنتم في مملكة كلوفر الأسطورية - مملكة النجوم السوداء! 🏰

🔥 تبقى خطوة واحدة فقط للوصول إلى 50 عضو! 🔥
💪 قوتكم مذهلة وإصراركم يلهم الأجيال! 💪

🚀 الفرع الجديد على الأبواب - دعوة واحدة تفصلكم عن النصر! 🚀
🌟 كل صديق تدعونه يكتب التاريخ معكم! 🌟

🍀 مملكة كلوفر تنتظر انتصاركم! 🍀

🎯 *خطوة واحدة فقط تفصلكم عن الفرع الجديد!*`
  };

  return messages[currentCount] || '';
}

export async function messageHandler(sock, msg) {
  if (!msg.message) return;

  const jid = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

  // حفظ رسالة في الـ cache لاستخدامها في حذف مجموعة رسائل لاحقاً
  addRecentMessage(jid, msg.key);

  // ============================================
  // �📊 تتبع الرسائل اليومية في القروب الأساسي
  // ============================================
  let kingdom;
  let kingdomData;
  
  try {
    const { getKingdomIdFromGroupJid } = await import('../config.js');
    const { KINGDOMS } = await import('../config.js');
    kingdom = getKingdomIdFromGroupJid(jid);
    kingdomData = KINGDOMS[kingdom];

    // DEBUG: تحقق من القيم
    console.log(`[DEBUG] جاء من: ${jid}`);
    console.log(`[DEBUG] المملكة: ${kingdom}, mainGroup: ${kingdomData?.mainGroup}`);
    console.log(`[DEBUG] من المستخدم: ${sender}`);
    console.log(`[DEBUG] نوع الرسالة: ${Object.keys(msg.message || {}).join(', ')}`);
    console.log(`[DEBUG] من مجموعة رئيسية؟ ${kingdomData && kingdomData.mainGroup === jid}`);

    // تتبع الرسائل من المجموعة الرئيسية فقط
    if (kingdomData && kingdomData.mainGroup === jid && !msg.key.fromMe) {
      console.log(`[DEBUG] تطابق! بدء تتبع الرسالة...`);
      try {
        let user = await User.findOne({ jid: sender, kingdom_id: kingdom });

        if (!user) {
          console.log(`[DEBUG] المستخدم غير موجود: ${sender}، جاري الإنشاء...`);
          // إنشاء مستخدم جديد
          user = new User({
            jid: sender,
            kingdom_id: kingdom,
            nickname: sender.split('@')[0],
            dailyMessages: 1,
            lastMessageResetDate: new Date()
          });
        } else {
          // تحديث الرسائل اليومية
          user.dailyMessages = (user.dailyMessages || 0) + 1;
          user.lastMessageResetDate = new Date();
        }

        // ✅ حفظ فوري للبيانات
        await user.save();
        console.log(`📊 [${user.nickname}] رسائل اليوم: ${user.dailyMessages}`);

        // إشعار تلقائي عند الوصول إلى شوط جديد (كل 100 تفاعل)
        const prevDailyMessages = (user.dailyMessages || 1) - 1;
        const prevMilestone = Math.floor(prevDailyMessages / 100);
        const newMilestone = Math.floor(user.dailyMessages / 100);
        if (user.dailyMessages >= 100 && newMilestone > prevMilestone) {
          const mentionText = user.mention || `@${user.jid.split('@')[0]}`;
          const congratsMsg = `🎉 رائع يا ${mentionText}\nلقد وصلت إلى ${user.dailyMessages} تفاعل! 🏆🔥👏`;
          await sock.sendMessage(jid, { text: congratsMsg, mentions: [user.jid] });
        }
      } catch (error) {
        console.error('❌ خطأ في تتبع الرسائل اليومية:', error.message);
      }
    } else {
      console.log(`[DEBUG] ❌ لم يتطابق - jid: ${jid}, mainGroup: ${kingdomData?.mainGroup}, fromMe: ${msg.key.fromMe}`);
    }
  } catch (importError) {
    console.error('❌ خطأ في استيراد البيانات:', importError.message);
  }

  // لا نحتاج لـ awaitingWelcomeImage بعد الآن - تم التشطيب من المنطق

  // التحقق من عدد الأعضاء وإرسال رسالة التشجيع إذا لزم الأمر
  if (!kingdom) {
    const { getKingdomIdFromGroupJid } = await import('../config.js');
    kingdom = getKingdomIdFromGroupJid(jid);
  }
  await checkAndSendMilestoneMessage(sock, jid, kingdom);

  // معالجة اختيار لاعبي لعبة الكلمات (يجب أن يكون قبل معالجة النمط)
  if (wordGameWaiting[jid] && wordGameWaiting[jid].mode === 'two_players') {
    await handleWordGamePlayersSelection(sock, jid, sender, text);
    return;
  }

  // معالجة اختيار نمط لعبة الكلمات
  if (wordGameWaiting[jid]) {
    await handleWordGameModeSelection(sock, jid, sender, text);
    return;
  }
  
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

  if (await handleDeveloperCommandGuide(sock, jid, sender, trimmedText)) {
    return;
  }

  if (await handleSamBotTokenCountCommand(sock, jid, sender, trimmedText)) {
    return;
  }

  if (await handleSamBotUsageCommand(sock, jid, sender, trimmedText)) {
    return;
  }

  if (await handleDeveloperKingdomCommand(sock, jid, sender, trimmedText)) {
    return;
  }

  if (await handleStartKingdomEdit(sock, jid, sender, trimmedText)) {
    return;
  }

  if (await handleKingdomEditStep(sock, jid, sender, trimmedText)) {
    return;
  }

  if (await handleStartKingdomRegistration(sock, jid, sender, trimmedText, msg)) {
    return;
  }

  if (await handleKingdomRegistrationStep(sock, jid, sender, trimmedText)) {
    return;
  }

  // البحث عن المستخدم (بدون تسجيل تلقائي)
  let user = await User.findOne({ jid: sender, kingdom_id: kingdom });

  // التحقق من حظر المستخدم
  if (user && user.isBanned) {
    return; // تجاهل الرسائل من المحظورين
  }

  // قائمة موحدة للألعاب (مع وبدون همزة)
  if (trimmedText === "/ألعاب" || trimmedText === "/العاب") {
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
      await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن يمكنهم بدء الألعاب!' });
      return;
    }

    awaitingGameChoice.add(sender);
    const gamesMenu = `🎮 **قائمة الألعاب المتاحة**
━━━━━━━━━━━━━━━━━━━━
1️⃣ تخمين الأنمي
2️⃣ لعبة الكلمات
3️⃣ تخمين الشخصيات
4️⃣ ترتيب الحروف
5️⃣ تفكيك الكلمات
6️⃣ لعبة الأعلام

💡 أرسل الرقم المطلوب (1-6) لبدء اللعبة`;

    await sock.sendMessage(jid, { text: gamesMenu });
    return;
  }

  // دعم جميع صيغ أمر الأوامر: /أوامر، /اوامر، /الأوامر، /الاوامر
  const commandsTriggers = ["/أوامر", "/اوامر", "/الأوامر", "/الاوامر"];
  if (commandsTriggers.includes(trimmedText)) {
    awaitingCommandsChoice.add(sender);
    await showCommandsList(sock, jid, sender);
    return;
  }

  // معالجة اختيار اللعبة برقم
  if (awaitingGameChoice.has(sender)) {
    awaitingGameChoice.delete(sender);
    await handleGameChoice(sock, jid, sender, trimmedText, kingdom);
    return;
  }

  // الأوامر القديمة الفردية (للتوافقية)
  if (trimmedText === "/انمي") {
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
      await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن الأساسي يمكنهم بدء الألعاب!' });
      return;
    }
    await startGameSession(sender, 'تخمين الأنمي');
    await startGuessAnime(sock, jid);
    return;
  }

  // تشغيل لعبة الكلمات
  if (trimmedText === "/كلمات") {
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
      await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن الأساسي يمكنهم بدء الألعاب!' });
      return;
    }
    await startGameSession(sender, 'كتابة الكلمات');
    await startWordGame(sock, jid);
    return;
  }

  // تشغيل لعبة تخمين الشخصيات
  if (trimmedText === "/شخصيات") {
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
      await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن الأساسي يمكنهم بدء الألعاب!' });
      return;
    }
    await startGameSession(sender, 'تخمين الشخصيات');
    await startGuessCharacter(sock, jid, sender);
    return;
  }

  // تشغيل لعبة الأعلام
  if (trimmedText === "/اعلام") {
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
      await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن الأساسي يمكنهم بدء الألعاب!' });
      return;
    }
    await startGameSession(sender, 'لعبة الأعلام');
    await startFlagGame(sock, jid);
    return;
  }

  // تشغيل لعبة ترتيب الحروف
  if (trimmedText === "/فك" || trimmedText === "/ترتيب_حروف") {
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
      await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن الأساسي يمكنهم بدء الألعاب!' });
      return;
    }
    await startGameSession(sender, 'ترتيب الحروف');
    await startUnscrambleGame(sock, jid, sender);
    return;
  }

  // تشغيل لعبة تفكيك الكلمات
  if (trimmedText === "/تفكيك" || trimmedText === "/تفكيك_الكلمات") {
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
      await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن الأساسي يمكنهم بدء الألعاب!' });
      return;
    }
    await startGameSession(sender, 'تفكيك الكلمات');
    await startWordSplitterGame(sock, jid, sender);
    return;
  }

  // عرض leaderboard موحد لجميع الألعاب
  if (trimmedText === "/ترتيب") {
    await showLeaderboard(sock, jid);
    return;
  }

  // إيقاف الألعاب
  if (trimmedText === "/وقف") {
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
      await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن الأساسي يمكنهم إيقاف الألعاب!' });
      return;
    }
    // إيقاف جميع الألعاب الممكنة
    let stoppedAny = false;
    if (activeGames[jid]) {
      await stopGuessAnime(sock, jid);
      await stopGameSession(sender);
      stoppedAny = true;
    }
    if (activeWordGames[jid]) {
      await stopWordGame(sock, jid);
      await stopGameSession(sender);
      stoppedAny = true;
    }
    if (activeCharacterGames[jid]) {
      await stopGuessCharacter(sock, jid);
      await stopGameSession(sender);
      stoppedAny = true;
    }
    if (activeUnscrambleGames[jid]) {
      await stopUnscrambleGame(sock, jid);
      await stopGameSession(sender);
      stoppedAny = true;
    }
    if (activeWordSplitterGames[jid]) {
      await stopWordSplitterGame(sock, jid);
      await stopGameSession(sender);
      stoppedAny = true;
    }
    if (activeFlagGames[jid]) {
      await sock.sendMessage(jid, { text: "🛑 تم إيقاف لعبة الأعلام!" });
      clearAnswerQueue('flagGame', jid);
      await stopGameSession(sender);
      delete activeFlagGames[jid];
      stoppedAny = true;
    }
    if (!stoppedAny) {
      await sock.sendMessage(jid, { text: "❌ لا توجد ألعاب تعمل حالياً!" });
    }
    return;
  }

  // التحقق من الإجابة إذا هناك لعبة أنمي فعالة
  if (activeGames[jid]) {
    const handled = await handleGuessAnimeResponse(sock, jid, sender, text);
    if (handled) return;
  }

  // التحقق من الإجابة إذا هناك لعبة اعلام فعالة
  if (activeFlagGames[jid]) {
    const handled = await handleFlagGameResponse(sock, jid, sender, text);
    if (handled) return;
  }

  // التحقق من الإجابة إذا هناك لعبة كلمات فعالة
  if (activeWordGames[jid]) {
    await checkWordGuess(sock, jid, sender, text);
    return;
  }

  // التحقق من انتظار اختيار وضع لعبة الشخصيات
  if (characterGameWaiting[jid]) {
    if (characterGameWaiting[jid].mode === 'two_players') {
      await handleCharacterPlayersSelection(sock, jid, sender, text);
    } else {
      await handleGuessCharacterResponse(sock, jid, sender, text);
    }
    return;
  }

  // التحقق من انتظار اختيار وضع لعبة ترتيب الحروف
  if (unscrambleGameWaiting[jid]) {
    if (unscrambleGameWaiting[jid].mode === 'two_players') {
      await handleUnscramblePlayersSelection(sock, jid, sender, text);
    } else {
      await handleUnscrambleResponse(sock, jid, sender, text);
    }
    return;
  }

  // التحقق من الإجابة إذا هناك لعبة شخصيات فعالة
  if (activeCharacterGames[jid]) {
    await checkCharacterGuess(sock, jid, sender, text);
    return;
  }

  // التحقق من الإجابة إذا هناك لعبة ترتيب حروف فعالة
  if (activeUnscrambleGames[jid]) {
    await checkUnscrambleGuess(sock, jid, sender, text);
    return;
  }

  // التحقق من انتظار اختيار وضع لعبة تفكيك الكلمات
  if (wordSplitterGameWaiting[jid]) {
    if (wordSplitterGameWaiting[jid].mode === 'two_players') {
      await handleWordSplitterPlayersSelection(sock, jid, sender, text);
    } else {
      await handleWordSplitterModeSelection(sock, jid, sender, text);
    }
    return;
  }

  // التحقق من الإجابة إذا هناك لعبة تفكيك كلمات فعالة
  if (activeWordSplitterGames[jid]) {
    await checkWordSplitterGuess(sock, jid, sender, text);
    return;
  }

  // معالجة المنشن المعلقة - إذا كان هناك منشن في الرسالة
  if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid && pendingMentions[jid]) {
    const mentionedJids = msg.message.extendedTextMessage.contextInfo.mentionedJid;
    const pendingData = pendingMentions[jid];

    if (mentionedJids.length > 0) {
      const mentionedJid = mentionedJids[0];
      // استخراج المنشن الحقيقي من النص
      const text = msg.message.extendedTextMessage.text || '';
      const mentionRegex = /(@\w+)/g;
      const mentions = text.match(mentionRegex);
      const realMention = mentions && mentions.length > 0 ? mentions[0] : `@${mentionedJid.split('@')[0]}`;

      // معالجة التبليغ عن الإساءة
      if (pendingData.action === 'report_mention') {
        // حفظ بيانات التبليغ والانتظار لسبب التبليغ
        pendingData.accusedJid = mentionedJid;
        pendingData.accusedMention = realMention;
        pendingData.action = 'awaiting_report_reason'; // تغيير الحالة

        await sock.sendMessage(jid, {
          text: `📝 *تم تحديد الشخص المسيء: ${realMention}*\n\n📋 الآن، الرجاء إرسال سبب التبليغ:\n\n💡 (وصف مختصر للإساءة أو السلوك غير المناسب)`
        });

        return;
      }

      const kingdom = getKingdomIdFromGroupJid(jid);
      const result = await extractAndSaveUserFromMention(sock, jid, mentionedJid, pendingData.nickname, kingdom);

      if (result) {
        // حفظ المنشن الحقيقي في البيانات المعلقة
        pendingData.mentionedJid = mentionedJid;
        pendingData.realMention = realMention;
        // تنفيذ الإجراء المعلق
        if (pendingData.action === 'welcoming') {
          // إرسال رسالة الترحيب
          const welcomeMessage = `*~╃ 𝘾𝙇𝙊𝙑𝙀𝙍𖠛🍀 𝘾𝙇𝙊𝙑𝙀𝙍 ╄~*
*『 ❀ اســتـمـارة الـتـرحـيـب ❀ 』*

*❀✦═══ •『🍀』• ═══✦❀*

*✧ بكل ودّ واحترام، نفتح لك أبواب قلوبنا قبل أبواب مجموعتنا*  
*✧ يسعدنا انضمامك إلى عائلة 🍀 𝘾𝙇𝙊𝙑𝙀𝙍 الراقية*
*✧ وجودك بيننا هو إضافة ثمينة نعتز بها، فمرحبًا بك عدد نجوم السماء*✨

➤ *الــلــقــــب ✦  :  『${result.nickname}』*
➤ *الـمـنـشـن@ ✦ : 『@${pendingData.mentionedJid.split('@')[0]}』*
*➤ الـمـسـؤول ✦ :  『${pendingData.moderatorName}』*

📌 *يُرجى زيارة رابط الإعلانات الرسمي للاطلاع على كل جديد:*
『 📰』 
${WELCOME_LINK}
*
*❀✦═══ •『🍀』• ═══✦❀*

*~╃ C•L•O 𖠛🍀 𝘾𝙇𝙊𝙑𝙀𝙍 ╄~*`;

          // إذا كان هناك صورة، أرسل الترحيب مع الصورة
          if (pendingData.hasImage && pendingData.imageUrl) {
            try {
              // ✅ إرسال الصورة مع رسالة الترحيب
              await sock.sendMessage(jid, {
                image: { url: pendingData.imageUrl },
                caption: welcomeMessage
              });
              console.log(`✅ تم إرسال ترحيب مع صورة للعضو ${result.nickname}`);
            } catch (imageError) {
              console.error('⚠️ خطأ في إرسال الصورة، جاري الإرسال بدونها:', imageError.message);
              // إرسال بدون صورة كبديل
              await sock.sendMessage(jid, {
                text: welcomeMessage,
                mentions: [pendingData.mentionedJid]
              });
            }
          } else {
            // أرسل رسالة الترحيب (بدون صورة)
            await sock.sendMessage(jid, {
              text: welcomeMessage,
              mentions: [pendingData.mentionedJid]
            });
          }
          
          console.log(`✅ تم إرسال رسالة ترحيب للعضو ${result.nickname}`);
        } else if (pendingData.action === 'promotion') {
          // تنفيذ الترقية
          const kingdom = getKingdomIdFromGroupJid(jid);
          const { promoteModerator } = await import('../commands/adminSystem.js');
          await promoteModerator(sock, jid, result.nickname, pendingData.adminJid, pendingData.mentionedJid, kingdom);
        } else if (pendingData.action === 'assign_mention') {
          // معالجة تعيين المنشن
          const { handleAssignMention } = await import('../commands/adminSystem.js');
          await handleAssignMention(sock, jid, sender, mentionedJid, pendingData.nickname, pendingData.realMention);
        } else if (pendingData.action === 'change_mention') {
          // معالجة تغيير المنشن
          const { handleChangeMention } = await import('../commands/adminSystem.js');
          await handleChangeMention(sock, jid, sender, mentionedJid, pendingData.nickname, pendingData.realMention);
        } else if (pendingData.action === 'retrieveNickname') {
          // معالجة استرجاع/إنشاء اللقب للعضو المنشن عليه
          const { retrieveOrCreateNickname } = await import('../commands/adminSystem.js');
          await retrieveOrCreateNickname(sock, jid, mentionedJid);
        }
      }

      // حذف الحالة المعلقة
      delete pendingMentions[jid];
      return;
    }
  }

  // التحقق من طلب حذف بيانات المطرود
  if (pendingKick[jid] && (trimmedText.toLowerCase() === 'نعم' || trimmedText.toLowerCase() === 'لا')) {
    const kickData = pendingKick[jid];
    
    // التحقق من أن الرد من مشرف أو أدمن (في نفس المملكة)
    const isSuper = await isSuperAdminInKingdom(sender, kingdom);
    const admin = await User.findOne({ jid: sender, kingdom_id: kingdom });
    const isModOrAdmin = admin && (isSuper || admin.role === 'admin' || admin.role === 'moderator');
    
    if (!isModOrAdmin) {
      await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمنز يمكنهم الرد على هذا السؤال!' });
      return;
    }
    
    if (trimmedText.toLowerCase() === 'نعم') {
      // حذف البيانات
      await deleteUser(sock, jid, kickData.userId, sender);
      await sock.sendMessage(jid, { text: `✅ تم حذف بيانات ${kickData.nickname} من قاعدة البيانات!` });
    } else {
      await sock.sendMessage(jid, { text: `ℹ️ تم الاحتفاظ ببيانات ${kickData.nickname}.` });
    }
    
    delete pendingKick[jid];
    return;
  }

  // الأوامر
  if (trimmedText.startsWith("/")) {
    console.log(`📥 [CMD] ${sender} -> ${trimmedText}`);

    // إذا لم يكن أمر الأوامر (تمت معالجته أعلاه)
    if (!commandsTriggers.includes(trimmedText)) {
      const handledByUser = await userCommands(sock, jid, sender, trimmedText, msg);
      const handledByAdmin = await handleAdminCommands(sock, jid, trimmedText, sender, msg);

      if (!handledByUser && !handledByAdmin) {
        await sock.sendMessage(jid, { text: `❌ الأمر غير معروف: ${trimmedText}` });
      }
    }
    return;
  }

  // معالجة اختيار صورة الترحيب (1️⃣ 2️⃣ 3️⃣ 4️⃣)
  if ((text === '1' || text === '2' || text === '3' || text === '4')) {
    // البحث عن حالة اختيار الصور
    let welcomeImagesKey = null;
    let welcomeImagesData = null;

    if (pendingMentions) {
      for (const key in pendingMentions) {
        if (key.startsWith('welcome_images_') && pendingMentions[key].action === 'welcome_images') {
          welcomeImagesKey = key;
          welcomeImagesData = pendingMentions[key];
          break;
        }
      }
    }

    if (welcomeImagesData && welcomeImagesData.action === 'welcome_images') {
      const selectedIndex = parseInt(text) - 1;
      
      if (selectedIndex < 0 || selectedIndex >= welcomeImagesData.imageBuffers.length) {
        await sock.sendMessage(jid, {
          text: `❌ اختيار غير صحيح! الرجاء اختيار رقم بين 1️⃣ و ${welcomeImagesData.imageBuffers.length}️⃣`
        });
        return;
      }

      const selectedImageBuffer = welcomeImagesData.imageBuffers[selectedIndex];
      const mainGroupJid = welcomeImagesData.mainGroupJid;
      const receptionGroupJid = welcomeImagesData.receptionGroupJid;
      
      console.log(`✅ تم اختيار الصورة ${parseInt(text)} للعضو ${welcomeImagesData.nickname}`);
      
      // التحقق من وجود العضو في المجموعة الأساسية
      try {
        const mainGroupMetadata = await sock.groupMetadata(mainGroupJid);
        const memberJids = mainGroupMetadata.participants.map(p => p.id);
        const memberExists = memberJids.includes(welcomeImagesData.userJid);

        if (!memberExists) {
          // إعلام الأدمن بعدم وجود العضو في المجموعة الأساسية
          const errorMessage = `❌ *خطأ في الترحيب*

لم يتم العثور على العضو *${welcomeImagesData.nickname}* في المجموعة الأساسية.

يُرجى التأكد من انضمام العضو إلى المجموعة الأساسية أولاً.`;

          await sock.sendMessage(receptionGroupJid, {
            text: errorMessage,
            mentions: [welcomeImagesData.moderatorJid]
          });

          console.warn(`⚠️ العضو ${welcomeImagesData.nickname} غير موجود في المجموعة الأساسية`);
          delete pendingMentions[welcomeImagesKey];
          return;
        }

        // إرسال رسالة الترحيب النهائية إلى المجموعة الأساسية
        const welcomeMessage = `*~╃ 𝘾𝙇𝙊𝙑𝙀𝙍𖠛🍀 𝘾𝙇𝙊𝙑𝙀𝙍 ╄~*
*『 ❀ اســتـمـارة الـتـرحـيـب ❀ 』*

*❀✦═══ •『🍀』• ═══✦❀*

*✧ بكل ودّ واحترام، نفتح لك أبواب قلوبنا قبل أبواب مجموعتنا*  
*✧ يسعدنا انضمامك إلى عائلة 🍀 𝘾𝙇𝙊𝙑𝙀𝙍 الراقية*
*✧ وجودك بيننا هو إضافة ثمينة نعتز بها، فمرحبًا بك عدد نجوم السماء*✨

➤ *الــلــقــــب ✦  :  『${welcomeImagesData.nickname}』*
➤ *الـمـنـشـن@ ✦ : 『@${welcomeImagesData.mentionPhone}』*
*➤ الـمـسـؤول ✦ :  『${welcomeImagesData.moderatorName}』*

📌 *يُرجى زيارة رابط الإعلانات الرسمي للاطلاع على كل جديد:*
『 📰』 
${WELCOME_LINK}
*
*❀✦═══ •『🍀』• ═══✦❀*

*~╃ C•L•O 𖠛🍀 𝘾𝙇𝙊𝙑𝙀𝙍 ╄~*`;

        try {
          // إرسال الترحيب مع الصورة المختارة إلى المجموعة الأساسية
          await sock.sendMessage(mainGroupJid, {
            image: selectedImageBuffer,
            caption: welcomeMessage,
            mentions: [welcomeImagesData.userJid]
          });
          console.log(`✅ تم إرسال ترحيب مع الصورة المختارة للعضو ${welcomeImagesData.nickname} إلى المجموعة الأساسية`);

          // تأكيد للأدمن في مجموعة الاستقبال بنجاح الترحيب
          await sock.sendMessage(receptionGroupJid, {
            text: `✅ *تم إرسال رسالة الترحيب بنجاح للعضو ${welcomeImagesData.nickname} إلى المجموعة الأساسية* ✨`,
            mentions: [welcomeImagesData.moderatorJid]
          });
        } catch (error) {
          console.error('❌ خطأ في إرسال الترحيب مع الصورة:', error.message);
          
          try {
            // محاولة الإرسال بدون صورة كبديل
            await sock.sendMessage(mainGroupJid, {
              text: welcomeMessage,
              mentions: [welcomeImagesData.userJid]
            });
            console.log(`⚠️ تم إرسال ترحيب بدون صورة للعضو ${welcomeImagesData.nickname} إلى المجموعة الأساسية`);

            await sock.sendMessage(receptionGroupJid, {
              text: `⚠️ *تم إرسال الترحيب بدون صورة للعضو ${welcomeImagesData.nickname}*\n\n📌 السبب: ${error.message}`,
              mentions: [welcomeImagesData.moderatorJid]
            });
          } catch (textError) {
            await sock.sendMessage(receptionGroupJid, {
              text: `❌ *خطأ في إرسال رسالة الترحيب للعضو ${welcomeImagesData.nickname}*\n\n📌 الخطأ: ${textError.message}`,
              mentions: [welcomeImagesData.moderatorJid]
            });
          }
        }
      } catch (metadataError) {
        console.error('❌ خطأ في الحصول على بيانات المجموعة الأساسية:', metadataError.message);
        
        await sock.sendMessage(receptionGroupJid, {
          text: `❌ *خطأ في الترحيب - لم يتمكن من الوصول إلى المجموعة الأساسية*\n\n📌 الخطأ: ${metadataError.message}`,
          mentions: [welcomeImagesData.moderatorJid]
        });
      }

      // حذف الحالة المعلقة
      delete pendingMentions[welcomeImagesKey];
      return;
    }
  }

  // معالجة تأكيد الترحيب (1 للموافقة، 2 للإلغاء)
  if ((text === '1' || text === '2')) {
    // البحث عن حالة تأكيد الترحيب
    let welcomeConfirmKey = null;
    let welcomeData = null;

    if (pendingMentions) {
      for (const key in pendingMentions) {
        if (key.startsWith('welcome_confirm_') && pendingMentions[key].action === 'welcome_confirm') {
          welcomeConfirmKey = key;
          welcomeData = pendingMentions[key];
          break;
        }
      }
    }

    if (welcomeData && welcomeData.action === 'welcome_confirm') {
      if (text === '1') {
        // الموافقة على الترحيب
        console.log(`✅ تم الموافقة على ترحيب ${welcomeData.nickname}`);
        
        const mainGroupJid = welcomeData.mainGroupJid;
        const receptionGroupJid = welcomeData.receptionGroupJid;

        // التحقق من وجود العضو في المجموعة الأساسية
        try {
          const mainGroupMetadata = await sock.groupMetadata(mainGroupJid);
          const memberJids = mainGroupMetadata.participants.map(p => p.id);
          const memberExists = memberJids.includes(welcomeData.userJid);

          if (!memberExists) {
            // إعلام الأدمن بعدم وجود العضو في المجموعة الأساسية
            const errorMessage = `❌ *خطأ في الترحيب*

لم يتم العثور على العضو *${welcomeData.nickname}* في المجموعة الأساسية.

يُرجى التأكد من انضمام العضو إلى المجموعة الأساسية أولاً.`;

            await sock.sendMessage(receptionGroupJid, {
              text: errorMessage,
              mentions: [welcomeData.moderatorJid]
            });

            console.warn(`⚠️ العضو ${welcomeData.nickname} غير موجود في المجموعة الأساسية`);
            delete pendingMentions[welcomeConfirmKey];
            return;
          }

          // إرسال رسالة الترحيب النهائية إلى المجموعة الأساسية
          const welcomeMessage = `*~╃ 𝘾𝙇𝙊𝙑𝙀𝙍𖠛🍀 𝘾𝙇𝙊𝙑𝙀𝙍 ╄~*
*『 ❀ اســتـمـارة الـتـرحـيـب ❀ 』*

*❀✦═══ •『🍀』• ═══✦❀*

*✧ بكل ودّ واحترام، نفتح لك أبواب قلوبنا قبل أبواب مجموعتنا*  
*✧ يسعدنا انضمامك إلى عائلة 🍀 𝘾𝙇𝙊𝙑𝙀𝙍 الراقية*
*✧ وجودك بيننا هو إضافة ثمينة نعتز بها، فمرحبًا بك عدد نجوم السماء*✨

➤ *الــلــقــــب ✦  :  『${welcomeData.nickname}』*
➤ *الـمـنـشـن@ ✦ : 『@${welcomeData.mentionPhone}』*
*➤ الـمـسـؤول ✦ :  『${welcomeData.moderatorName}』*

📌 *يُرجى زيارة رابط الإعلانات الرسمي للاطلاع على كل جديد:*
『 📰』 
${WELCOME_LINK}
*
*❀✦═══ •『🍀』• ═══✦❀*

*~╃ C•L•O 𖠛🍀 𝘾𝙇𝙊𝙑𝙀𝙍 ╄~*`;

          try {
            // أرسل رسالة الترحيب إلى المجموعة الأساسية
            await sock.sendMessage(mainGroupJid, {
              text: welcomeMessage,
              mentions: [welcomeData.userJid]
            });
            console.log(`✅ تم إرسال رسالة ترحيب بدون صورة للعضو ${welcomeData.nickname} إلى المجموعة الأساسية`);

            // تأكيد للأدمن في مجموعة الاستقبال بنجاح الترحيب
            await sock.sendMessage(receptionGroupJid, {
              text: `✅ *تم إرسال رسالة الترحيب بنجاح للعضو ${welcomeData.nickname} إلى المجموعة الأساسية* ✨`,
              mentions: [welcomeData.moderatorJid]
            });
          } catch (error) {
            console.error('❌ خطأ في إرسال الترحيب:', error.message);
            await sock.sendMessage(receptionGroupJid, {
              text: `❌ *خطأ في إرسال رسالة الترحيب للعضو ${welcomeData.nickname}*\n\n📌 الخطأ: ${error.message}`,
              mentions: [welcomeData.moderatorJid]
            });
          }
        } catch (metadataError) {
          console.error('❌ خطأ في الحصول على بيانات المجموعة الأساسية:', metadataError.message);
          
          await sock.sendMessage(receptionGroupJid, {
            text: `❌ *خطأ في الترحيب - لم يتمكن من الوصول إلى المجموعة الأساسية*\n\n📌 الخطأ: ${metadataError.message}`,
            mentions: [welcomeData.moderatorJid]
          });
        }
      } else if (text === '2') {
        // الرفض والإلغاء
        await sock.sendMessage(jid, {
          text: `❌ *تم إلغاء ترحيب العضو ${welcomeData.nickname}*`
        });
        console.log(`❌ تم إلغاء ترحيب ${welcomeData.nickname}`);
      }

      // حذف الحالة المعلقة
      delete pendingMentions[welcomeConfirmKey];
      return;
    }
  }

  // معالجة اختيارات الملف للأداريين (خيار بين معلومات والألعاب)
  if ((text === '1' || text === '2')) {
    // البحث عن حالة اختيار ملف شخص آخر في pendingMentions
    let profileChoiceKey = null;
    let profileData = null;

    if (pendingMentions) {
      for (const key in pendingMentions) {
        if (key.startsWith('profile_choice_') && pendingMentions[key].action === 'profile_choice') {
          profileChoiceKey = key;
          profileData = pendingMentions[key];
          break;
        }
      }
    }

    if (profileData && profileData.action === 'profile_choice') {
      if (text === '1') {
        // عرض المعلومات الأساسية
        try {
          const targetUser = await User.findOne({ jid: profileData.targetJid });
          if (targetUser) {
            const kingdom = getKingdomIdFromGroupJid(jid);
            const { getHighestRank, displayRank } = await import('../commands/rankSystem.js');
            const { ADMINS } = await import('../config.js');
            
            let roleEmoji = '👤';
            let roleText = 'عضو';
            if (targetUser.role === 'super_admin' || ADMINS.includes(targetUser.jid) || ADMINS.includes(targetUser.nickname)) {
              roleEmoji = '👑';
              roleText = 'أدمن رئيسي';
            } else if (targetUser.role === 'admin') {
              roleEmoji = '👑';
              roleText = 'أدمن';
            } else if (targetUser.role === 'moderator') {
              roleEmoji = '🔰';
              roleText = 'مشرف';
            }
            
            const rankStars = targetUser.rankStarsByKingdom?.[kingdom] || 0;
            const highestRank = getHighestRank(kingdom, rankStars);
            const kingdomRankDisplay = highestRank ? displayRank(kingdom, highestRank) : '❌ لا توجد رتبة';

            let message = `${roleEmoji} معلومات ${targetUser.nickname}\n`;
            message += `━━━━━━━━━━━━━━━━━\n`;
            message += `📛 اللقب: ${targetUser.nickname}\n`;
            message += `🎖️ الرتبة الإدارية: ${roleText}\n`;
            message += `👑 رتبة المملكة: ${kingdomRankDisplay}\n`;
            message += `💰 النقاط: ${targetUser.points || 0}\n`;
            message += `🎖️ نجوم الرتب: ${rankStars}\n`;
            message += `💰 العملات: ${targetUser.coins}\n`;
            message += `🏦 البنك: ${targetUser.bankCoins || 0}\n`;
            message += `📅 تاريخ الانضمام: ${targetUser.createdAt.toLocaleDateString('ar-EG')}\n`;

            if (targetUser.isBanned) {
              message += `🚫 محظور - السبب: ${targetUser.banReason}\n`;
            }

            await sock.sendMessage(jid, { text: message });
          }
        } catch (error) {
          console.error('خطأ في عرض المعلومات:', error);
          await sock.sendMessage(jid, { text: '❌ حدث خطأ في عرض المعلومات!' });
        }
      } else if (text === '2') {
        // عرض الألعاب المبدوءة اليوم
        try {
          const targetUser = await User.findOne({ jid: profileData.targetJid });
          if (targetUser) {
            const { gameStats, totalDuration, sessionCount } = getDailyGameStats(targetUser.jid, targetUser);
            
            if (sessionCount === 0) {
              await sock.sendMessage(jid, { 
                text: `📊 *الألعاب المبدوءة من قبل ${profileData.nickname}*\n\n✅ لم يبدأ أي لعبة اليوم` 
              });
            } else {
              let report = `🎮 *الألعاب المبدوءة من قبل ${profileData.nickname}*\n\n`;
              report += `📅 التاريخ: ${new Date().toLocaleDateString('ar-SA')}\n\n`;

              let gameIndex = 1;
              for (const [gameName, stats] of Object.entries(gameStats)) {
                const hours = Math.floor(stats.totalDuration / 3600);
                const minutes = Math.floor((stats.totalDuration % 3600) / 60);
                const seconds = stats.totalDuration % 60;

                let timeStr = '';
                if (hours > 0) timeStr += `${hours}س `;
                if (minutes > 0) timeStr += `${minutes}د `;
                if (seconds > 0 || timeStr === '') timeStr += `${seconds}ث`;

                report += `${gameIndex}️⃣ *${gameName}*\n`;
                report += `   • عدد الجلسات: ${stats.count}\n`;
                report += `   • الوقت الإجمالي: ${timeStr}\n\n`;
                gameIndex++;
              }

              // المجموع الكلي
              const totalHours = Math.floor(totalDuration / 3600);
              const totalMinutes = Math.floor((totalDuration % 3600) / 60);
              const totalSeconds = totalDuration % 60;

              let totalTimeStr = '';
              if (totalHours > 0) totalTimeStr += `${totalHours}س `;
              if (totalMinutes > 0) totalTimeStr += `${totalMinutes}د `;
              if (totalSeconds > 0 || totalTimeStr === '') totalTimeStr += `${totalSeconds}ث`;

              report += `⏱️ *الإجمالي*\n`;
              report += `   • إجمالي الجلسات: ${sessionCount}\n`;
              report += `   • الوقت الكلي: ${totalTimeStr}`;

              await sock.sendMessage(jid, { text: report });
            }
          }
        } catch (error) {
          console.error('خطأ في عرض الألعاب:', error);
          await sock.sendMessage(jid, { text: '❌ حدث خطأ في عرض الألعاب!' });
        }
      }

      // حذف الحالة المعلقة
      delete pendingMentions[profileChoiceKey];
      return;
    }

    // معالجة ملفي (الملف الشخصي)
    const myProfileChoiceKey = `my_profile_choice_${sender}`;
    const myProfileData = pendingMentions[myProfileChoiceKey];

    if (myProfileData && myProfileData.action === 'my_profile_choice') {
      if (text === '1') {
        // عرض المعلومات الأساسية
        try {
          const { showUserStats } = await import('../commands/adminSystem.js');
          const kingdom = getKingdomIdFromGroupJid(jid);
          await showUserStats(sock, jid, myProfileData.nickname, kingdom);
        } catch (error) {
          console.error('خطأ في عرض المعلومات الأساسية:', error);
          await sock.sendMessage(jid, { text: '❌ حدث خطأ في عرض المعلومات الأساسية.' });
        }
      } else if (text === '2') {
        // عرض الألعاب الخاصة بك
        try {
          const targetUser = await User.findOne({ jid: myProfileData.targetJid });
          if (targetUser) {
            const { gameStats, totalDuration, sessionCount } = getDailyGameStats(targetUser.jid, targetUser);
            
            if (sessionCount === 0) {
              await sock.sendMessage(jid, { 
                text: `📊 *جلسات الألعاب الخاصة بك*\n\n✅ لم تبدأ أي لعبة اليوم` 
              });
            } else {
              let report = `🎮 *جلسات الألعاب الخاصة بك*\n\n`;
              report += `📅 التاريخ: ${new Date().toLocaleDateString('ar-SA')}\n\n`;

              let gameIndex = 1;
              for (const [gameName, stats] of Object.entries(gameStats)) {
                const hours = Math.floor(stats.totalDuration / 3600);
                const minutes = Math.floor((stats.totalDuration % 3600) / 60);
                const seconds = stats.totalDuration % 60;

                let timeStr = '';
                if (hours > 0) timeStr += `${hours}س `;
                if (minutes > 0) timeStr += `${minutes}د `;
                if (seconds > 0 || timeStr === '') timeStr += `${seconds}ث`;

                report += `${gameIndex}️⃣ *${gameName}*\n`;
                report += `   • عدد الجلسات: ${stats.count}\n`;
                report += `   • الوقت الإجمالي: ${timeStr}\n\n`;
                gameIndex++;
              }

              // المجموع الكلي
              const totalHours = Math.floor(totalDuration / 3600);
              const totalMinutes = Math.floor((totalDuration % 3600) / 60);
              const totalSeconds = totalDuration % 60;

              let totalTimeStr = '';
              if (totalHours > 0) totalTimeStr += `${totalHours}س `;
              if (totalMinutes > 0) totalTimeStr += `${totalMinutes}د `;
              if (totalSeconds > 0 || totalTimeStr === '') totalTimeStr += `${totalSeconds}ث`;

              report += `⏱️ *الإجمالي*\n`;
              report += `   • إجمالي الجلسات: ${sessionCount}\n`;
              report += `   • الوقت الكلي: ${totalTimeStr}`;

              await sock.sendMessage(jid, { text: report });
            }
          }
        } catch (error) {
          console.error('خطأ في عرض الألعاب:', error);
          await sock.sendMessage(jid, { text: '❌ حدث خطأ في عرض الألعاب!' });
        }
      }

      // حذف الحالة المعلقة
      delete pendingMentions[myProfileChoiceKey];
      return;
    }
  }

  // معالجة انتظار سبب التبليغ
  if (pendingMentions[jid] && pendingMentions[jid].action === 'awaiting_report_reason') {
    const reportData = pendingMentions[jid];
    const reportReason = text.trim();

    if (!reportReason) {
      await sock.sendMessage(jid, { 
        text: '❌ الرجاء إرسال سبب التبليغ بشكل صحيح!' 
      });
      return;
    }

    // الحصول على بيانات المبلِّغ والمتهم
    const { KINGDOMS } = await import('../config.js');
    const kingdomData = KINGDOMS[kingdom];
    const adminGroupJid = kingdomData?.adminGroup;

    if (!adminGroupJid) {
      await sock.sendMessage(jid, { 
        text: '❌ خطأ: لم يتم تحديد مجموعة الإدارة!' 
      });
      delete pendingMentions[jid];
      return;
    }

    // الحصول على معلومات المبلِّغ
    const reporter = await User.findOne({ jid: sender, kingdom_id: kingdom });
    const reporterName = reporter?.nickname || sender.split('@')[0];

    // محاولة الحصول على معلومات المتهم
    const accused = await User.findOne({ jid: reportData.accusedJid, kingdom_id: kingdom });
    const accusedName = accused?.nickname || reportData.accusedMention || reportData.accusedJid.split('@')[0];

    // إنشاء رسالة التبليغ
    const reportMessage = `📢 *تبليغ جديد عن إساءة* 📢

━━━━━━━━━━━━━━━━━━━━━
👤 **المبلِّغ:**
   • الاسم: ${reporterName}
   • الرقم: ${reportData.reporterJid}

🚨 **الشخص المسيء:**
   • الاسم: ${accusedName}
   • المنشن: ${reportData.accusedMention}
   • الرقم: ${reportData.accusedJid}

📝 **سبب التبليغ:**
   ${reportReason}

⏰ **التاريخ والوقت:**
   ${new Date().toLocaleDateString('ar-SA')} - ${new Date().toLocaleTimeString('ar-SA')}
━━━━━━━━━━━━━━━━━━━━━

⚠️ هذا التبليغ يتطلب انتباه الأداريين!`;

    // إرسال رسالة التبليغ لمجموعة الإدارة
    try {
      await sock.sendMessage(adminGroupJid, { 
        text: reportMessage,
        mentions: [reportData.accusedJid]
      });

      // تأكيد استلام التبليغ
      await sock.sendMessage(jid, {
        text: `✅ *تم استلام تبليغك*\n\n🔔 تم إرسال التبليغ إلى الأداريين\n📋 سيتم النظر في الأمر في أقرب وقت\n\nشكراً لك على مساعدتك في الحفاظ على بيئة صحية! 🙏`
      });

      console.log(`📢 تبليغ جديد من ${reporterName} عن ${accusedName} - السبب: ${reportReason}`);
    } catch (error) {
      console.error('خطأ في إرسال التبليغ:', error);
      await sock.sendMessage(jid, {
        text: '❌ حدث خطأ في إرسال التبليغ. الرجاء المحاولة لاحقاً.'
      });
    }

    // حذف الحالة المعلقة
    delete pendingMentions[jid];
    return;
  }

  // معالجة اختيارات قائمة الأوامر
  if (awaitingCommandsChoice.has(sender) && /^[1-7]$/.test(text.trim())) {
    const choice = text.trim();
    if (choice === '2') {
      // user asked for games list via /أوامر; provide the interactive menu
      const userIsModerator = await isModerator(sender, kingdom);
      if (!userIsModerator) {
        await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن يمكنهم بدء الألعاب!' });
        awaitingCommandsChoice.delete(sender);
        return;
      }
      awaitingCommandsChoice.delete(sender);
      awaitingGameChoice.add(sender);
      const gamesMenu = `🎮 **قائمة الألعاب المتاحة**
━━━━━━━━━━━━━━━━━━━━
1️⃣ تخمين الأنمي
2️⃣ لعبة الكلمات
3️⃣ تخمين الشخصيات
4️⃣ ترتيب الحروف
5️⃣ تفكيك الكلمات

💡 أرسل الرقم المطلوب (1-5) لبدء اللعبة`;
      await sock.sendMessage(jid, { text: gamesMenu });
      return;
    }

    await handleCommandsChoice(sock, jid, sender, text);
    awaitingCommandsChoice.delete(sender);
    return;
  }

  // معالجة كلمة السر لمنح رتبة الإمبراطور
  if (awaitingEmperorPassword.has(sender)) {
    const data = awaitingEmperorPassword.get(sender);
    awaitingEmperorPassword.delete(sender);

    // التحقق من كلمة السر
    const { ADMIN_PASSWORD, ADMIN_PASSWORD_CONFIGURED } = await import('../config.js');
    if (!ADMIN_PASSWORD_CONFIGURED) {
      await sock.sendMessage(sender, { text: '❌ كلمة مرور الأدمن غير مضبوطة في ملف البيئة ADMIN_PASSWORD. تم إلغاء العملية.' });
      return;
    }

    if (text.trim() === ADMIN_PASSWORD) {
      // منح الرتبة
      await grantEmperorRankWithPassword(sock, data.groupJid, data.nickname, text.trim(), sender);
    } else {
      await sock.sendMessage(sender, { text: '❌ كلمة المرور غير صحيحة! تم إلغاء العملية.' });
    }
    return;
  }

  // معالجة تسجيل اللقب للمستخدمين الجدد في مجموعة الاستقبال - نظام متعدد المراحل
  if (awaitingNicknameRegistration.has(sender)) {
    // حتى لو كان المستخدم في مرحلة التسجيل، دع الأوامر تعمل (مثل /أوامر، /التفاعل)
    if (text.startsWith('/')) {
      await userCommands(sock, jid, sender, text, msg);
      await handleAdminCommands(sock, jid, text, sender, msg);
      return;
    }

    const { getKingdomFromGroupJid } = await import('../config.js');
    const kingdom = getKingdomFromGroupJid(jid);
    const receptionJid = kingdom?.receptionGroup || jid;

    // التحقق من أن الرسالة في مجموعة الاستقبال
    if (jid !== receptionJid) {
      await sock.sendMessage(jid, { text: '❌ يرجى إرسال ردك في مجموعة الاستقبال فقط.' });
      return;
    }

    const userStage = nicknameRegistrationStages[sender];

    // ============================================
    // المرحلة الأولى: انتظار تأكيد الترحيب
    // ============================================
    if (userStage && userStage.stage === 'welcome') {
      console.log(`✅ مرحلة الترحيب: تم استقبال رد من ${sender}`);
      
      // الانتقال للمرحلة الثانية: طلب اللقب
      nicknameRegistrationStages[sender].stage = 'nicknameInput';
      
      const nicknameRequestMessage = `✅ شكراً على تفاعلك! 😊

*📝 الآن يرجى اختيار لقب لك من شخصيات الأنمي*

*❓ ما هو لقبك المفضل؟*
*💡 أمثلة: غوكو • ناروتو • لوفي • ساسوكي*

⚠️ تأكد أن اللقب:
• فريد وغير مستخدم من قبل
• بدون أرقام أو رموز
• بعدد أحرف معقول`;

      await sock.sendMessage(jid, {
        text: nicknameRequestMessage,
        mentions: [sender]
      });
      return;
    }

    // ============================================
    // المرحلة الثانية: استقبال اللقب
    // ============================================
    if (userStage && userStage.stage === 'nicknameInput') {
      console.log(`📝 مرحلة إدخال اللقب: تم استقبال لقب من ${sender}`);
      
      const nickname = text.trim();
      
      // التحقق من صحة اللقب
      if (!nickname || nickname.length < 2) {
        await sock.sendMessage(jid, {
          text: '❌ اللقب قصير جداً! يجب أن يكون أطول من حرفين.',
          mentions: [sender]
        });
        return;
      }

      if (nickname.length > 30) {
        await sock.sendMessage(jid, {
          text: '❌ اللقب طويل جداً! يجب أن لا يتجاوز 30 حرف.',
          mentions: [sender]
        });
        return;
      }

      // التحقق من أن اللقب غير مستخدم
      const kingdom = getKingdomIdFromGroupJid(jid);
      const existingUser = await User.findOne({ 
        nickname: { $regex: `^${nickname}$`, $options: 'i' }, 
        kingdom_id: kingdom 
      });
      
      if (existingUser && existingUser.jid !== sender) {
        await sock.sendMessage(jid, {
          text: `❌ هذا اللقب مستخدم بالفعل! 😞\n\n💡 يرجى اختيار لقب آخر.`,
          mentions: [sender]
        });
        return;
      }

      // الانتقال للمرحلة الثالثة: طلب التأكيد
      nicknameRegistrationStages[sender].stage = 'nicknameConfirmation';
      nicknameRegistrationStages[sender].nickname = nickname;

      const confirmationMessage = `✨ هذا لقبك الجديد؟ ✨

*💫 لقبك: ${nickname}*

*✍️ لتأكيد اللقب، يرجى إعادة كتابته*

📝 اكتب اللقب مرة أخرى بدقة:`;

      await sock.sendMessage(jid, {
        text: confirmationMessage,
        mentions: [sender]
      });
      return;
    }

    // ============================================
    // المرحلة الثالثة: تأكيد اللقب (إعادة كتابة)
    // ============================================
    if (userStage && userStage.stage === 'nicknameConfirmation') {
      console.log(`✔️ مرحلة التأكيد: تم استقبال تأكيد من ${sender}`);
      
      const confirmedNickname = text.trim();
      const originalNickname = userStage.nickname;

      // التحقق من أن الإجابة مطابقة للقب الأصلي
      if (confirmedNickname.toLowerCase() === originalNickname.toLowerCase()) {
        // ✅ التأكيد صحيح - الانتقال للمرحلة التالية: السؤال عن المرجع
        const kingdom = getKingdomIdFromGroupJid(jid);
        
        // الانتقال للمرحلة الرابعة: سؤال من طرف من
        nicknameRegistrationStages[sender].stage = 'enteringSource';
        nicknameRegistrationStages[sender].nickname = originalNickname;

        const sourceMessage = `✅ تم حفظ لقبك: *${originalNickname}* 🎭

*━━━━━━━━━━━━━━━━━*

📝 *سؤال مهم:*

*من طرف من دخلت المجموعة؟*
*🔗 (اكتب اسم الشخص الذي عرّفك على المجموعة)*

*💡 مثال: حمد • فاطمة • علي*`;

        await sock.sendMessage(jid, {
          text: sourceMessage,
          mentions: [sender]
        });
        return;

      } else {
        // ❌ التأكيد خاطئ - إعادة العملية من البداية
        nicknameRegistrationStages[sender].stage = 'nicknameInput';
        delete nicknameRegistrationStages[sender].nickname;

        const retryMessage = `⚠️ اللقب لم يطابق! ❌

*اللقب الذي أرسلته:* ${confirmedNickname}
*اللقب المطلوب:* ${originalNickname}

🔄 لنحاول مرة أخرى. الرجاء كتابة لقبك من جديد (بشكل دقيق):`;

        await sock.sendMessage(jid, {
          text: retryMessage,
          mentions: [sender]
        });
        return;
      }
    }

    // ============================================
    // المرحلة الرابعة: استقبال مصدر الدخول
    // ============================================
    if (userStage && userStage.stage === 'enteringSource') {
      console.log(`🔗 مرحلة مصدر الدخول: تم استقبال الرد من ${sender}`);
      
      const enteringSource = text.trim();
      
      // التحقق من صحة الإجابة
      if (!enteringSource || enteringSource.length < 2) {
        await sock.sendMessage(jid, {
          text: '❌ الرجاء إدخال اسم الشخص بشكل صحيح!',
          mentions: [sender]
        });
        return;
      }

      if (enteringSource.length > 50) {
        await sock.sendMessage(jid, {
          text: '❌ الاسم طويل جداً! يجب أن لا يتجاوز 50 حرف.',
          mentions: [sender]
        });
        return;
      }

      // ✅ حفظ البيانات ونهاية التسجيل
      const kingdom = getKingdomIdFromGroupJid(jid);
      let user = await User.findOne({ jid: sender, kingdom_id: kingdom });
      const whatsappName = msg.pushName || 'صديق';
      const originalNickname = userStage.nickname;

      if (!user) {
        const phoneNumber = getPhoneFromJID(sender);
        user = new User({
          jid: sender,
          kingdom_id: kingdom,
          nickname: originalNickname,
          phoneNumber: phoneNumber,
          whatsappName: whatsappName,
          enteringSource: enteringSource // حفظ مصدر الدخول
        });
      } else {
        user.nickname = originalNickname;
        user.whatsappName = whatsappName;
        user.enteringSource = enteringSource;
      }

      await user.save();
      console.log(`✅ تم تسجيل مستخدم جديد: ${originalNickname} (${sender}) - من طرف: ${enteringSource}`);

      // حذف من الحالات المعلقة
      awaitingNicknameRegistration.delete(sender);
      delete nicknameRegistrationStages[sender];

      const successMessage = `🎉 *مرحباً بك في مملكة كلوفر يا ${whatsappName}!* 🍀

✨ تم تسجيلك بنجاح! ✨

*💫 لقبك الرسمي: ${originalNickname}*
*🔗 أحضرك: ${enteringSource}*

🌟 الآن يمكنك:
• الاستمتاع بجميع أوامر البوت
• المشاركة في الألعاب
• جمع النقاط والترقي

🚀 رحلتك في المملكة بدأت! أتمنى لك وقتاً رائعاً! 🎊`;

      await sock.sendMessage(jid, {
        text: successMessage,
        mentions: [sender]
      });

      // إرسال نموذج الترحيب إلى مجموعة الوورك (إذا كانت موجودة)
      try {
        const { KINGDOMS } = await import('../config.js');
        const kingdomData = KINGDOMS[kingdom];
        const workGroupJid = kingdomData?.workGroup;

        if (workGroupJid) {
          // تحديد الحالة (جديد/محرر)
          const status = 'جديد ⭐';

          // البحث عن اسم المسؤول (الشخص الذي أضاف العضو)
          // في هذاالحالة قد لا يكون معروفاً، لذا سنتركه فارغاً أو نضع "غير محدد"
          const moderatorName = 'غير محدد';

          const formMessage = `*☜ اللقب 🎭 ⟦ ${originalNickname} ⟧ ➪*

*☜ الحالة ⚡ ⟦ ${status} ⟧ ➪*

*☜ من طرف 🔗 ⟦ ${enteringSource} ⟧ ➪*

*☜ المسؤول 🤝 ⟦ ${moderatorName} ⟧ ➪*

*𓆩 𝐇٠𝐔٠𝐍⊰🩸⊱𝘾𝙇𝙊𝙑𝙀𝙍 ♦️*`;

          await sock.sendMessage(workGroupJid, { text: formMessage });
          console.log(`✅ تم إرسال نموذج الترحيب إلى مجموعة الوورك: ${originalNickname}`);
        } else {
          console.log(`ℹ️ لا توجد مجموعة وورك محددة للمملكة: ${kingdom}`);
        }
      } catch (workError) {
        console.error(`⚠️ خطأ في إرسال نموذج الترحيب: ${workError.message}`);
      }

      return;
    }
  }

  // تفاعل سام بوت الذكي: يرد فقط إذا الكلام موجه له أو في الخاص أو بالرد على رسالته.
  const smartInteractionHandled = await handleSamBotInteraction(sock, jid, sender, text, msg);
  if (smartInteractionHandled) {
    return;
  }

  // إذا النص عادي (مش أمر أو تحية)، نسأل AI
  // try {
  //   const aiReply = await askAnimeAI(text);
  //   if (aiReply) {
  //     await sock.sendMessage(jid, { text: aiReply });
  //   }
  // } catch (err) {
  //   console.error("❌ AI Error:", err.message);
  // }
}
/**
 * معالجة اختيار لعبة من قائمة الألعاب.
 */
async function handleGameChoice(sock, jid, sender, choice, kingdom) {
  const userIsModerator = await isModerator(sender, kingdom);
  if (!userIsModerator) {
    await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن يمكنهم بدء الألعاب!' });
    return;
  }

  switch (choice.trim()) {
    case '1':
      await startGameSession(sender, 'تخمين الأنمي');
      await startGuessAnime(sock, jid);
      break;
    case '2':
      await startGameSession(sender, 'لعبة الكلمات');
      await startWordGame(sock, jid);
      break;
    case '3':
      await startGameSession(sender, 'تخمين الشخصيات');
      await startGuessCharacter(sock, jid, sender);
      break;
    case '4':
      await startGameSession(sender, 'ترتيب الحروف');
      await startUnscrambleGame(sock, jid, sender);
      break;
    case '5':
      await startGameSession(sender, 'تفكيك الكلمات');
      await startWordSplitterGame(sock, jid, sender);
      break;
    case '6':
      await startGameSession(sender, 'لعبة الأعلام');
      await startFlagGame(sock, jid);
      break;
    default:
      await sock.sendMessage(jid, { text: '❌ اختيار غير صحيح. أرسل رقمًا من 1 إلى 6.' });
      break;
  }
}
