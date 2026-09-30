import { dashboardReply } from '../services/dashboardTemplates.js';
import { isModerator, startGameSession, stopGameSession } from "../commands/adminSystem.js";
import { startGuessAnime, handleGuessAnimeResponse, activeGames, showLeaderboard, stopGuessAnime } from "../games/guessAnime.js";
import { startWordGame, checkWordGuess, activeWordGames, stopWordGame, wordGameWaiting, handleWordGameModeSelection, handleWordGamePlayersSelection } from "../games/wordtype.js";
import { startGuessCharacter, checkCharacterGuess, activeCharacterGames, characterGameWaiting, handleGuessCharacterResponse, handleCharacterPlayersSelection, stopGuessCharacter } from "../games/guessCharacter.js";
import { startUnscrambleGame, checkUnscrambleGuess, activeUnscrambleGames, unscrambleGameWaiting, handleUnscrambleResponse, handleUnscramblePlayersSelection, stopUnscrambleGame } from "../games/unscramble.js";
import { startWordSplitterGame, checkWordSplitterGuess, activeWordSplitterGames, wordSplitterGameWaiting, handleWordSplitterModeSelection, handleWordSplitterPlayersSelection, stopWordSplitterGame } from "../games/wordSplitter.js";
import { startFlagGame, handleFlagGameResponse, activeGames as activeFlagGames } from "../games/flagGame.js";
import { clearAnswerQueue } from "../utils/answerQueue.js";
import { awaitingGameChoice } from "./handlerState.js";

export async function sendGamesMenu(sock, jid) {
  const gamesMenu = dashboardReply('reply_b27508bd616fc1bc')`*🎮 قائمة الألعاب*
اختر رقم اللعبة:

🎬 1. تخمين الأنمي
📝 2. لعبة الكلمات
🎭 3. تخمين الشخصيات
🔤 4. ترتيب الحروف
✂️ 5. تفكيك الكلمات
🚩 6. لعبة الأعلام

اكتب الرقم فقط.`;

  await sock.sendMessage(jid, { text: gamesMenu });
}

// إعداد لعبة الكلمات (يعمل حتى قبل التحقق من وجود نص)
export async function handleWordGameSetup(sock, jid, sender, text) {
  // معالجة اختيار لاعبي لعبة الكلمات (يجب أن يكون قبل معالجة النمط)
  if (wordGameWaiting[jid] && wordGameWaiting[jid].mode === 'two_players') {
    await handleWordGamePlayersSelection(sock, jid, sender, text);
    return true;
  }

  // معالجة اختيار نمط لعبة الكلمات
  if (wordGameWaiting[jid]) {
    await handleWordGameModeSelection(sock, jid, sender, text);
    return true;
  }

  return false;
}

// قائمة موحدة للألعاب (مع وبدون همزة)
export async function handleGamesMenuCommand(sock, jid, sender, trimmedText, kingdom) {
  if (trimmedText !== "/ألعاب" && trimmedText !== "/العاب") return false;

  const userIsModerator = await isModerator(sender, kingdom);
  if (!userIsModerator) {
    await sock.sendMessage(jid, { text: dashboardReply('reply_2cde6253a66bdae5')(['❌ فقط المشرفون والأدمن يمكنهم بدء الألعاب!']) });
    return true;
  }

  awaitingGameChoice.add(sender);
  await sendGamesMenu(sock, jid);
  return true;
}

async function startGameIfModerator(sock, jid, sender, kingdom, gameName, start) {
  const userIsModerator = await isModerator(sender, kingdom);
  if (!userIsModerator) {
    await sock.sendMessage(jid, { text: dashboardReply('reply_05c4dfb7d205e2d2')(['❌ فقط المشرفون والأدمن الأساسي يمكنهم بدء الألعاب!']) });
    return;
  }
  await startGameSession(sender, gameName, kingdom);
  await start();
}

// اختيار اللعبة برقم، أوامر تشغيل الألعاب الفردية، الترتيب، والإيقاف
export async function handleGameCommands(sock, jid, sender, trimmedText, kingdom) {
  // معالجة اختيار اللعبة برقم
  if (awaitingGameChoice.has(sender)) {
    awaitingGameChoice.delete(sender);
    await handleGameChoice(sock, jid, sender, trimmedText, kingdom);
    return true;
  }

  // الأوامر القديمة الفردية (للتوافقية)
  if (trimmedText === "/انمي") {
    await startGameIfModerator(sock, jid, sender, kingdom, 'تخمين الأنمي', () => startGuessAnime(sock, jid));
    return true;
  }

  // تشغيل لعبة الكلمات
  if (trimmedText === "/كلمات") {
    await startGameIfModerator(sock, jid, sender, kingdom, 'كتابة الكلمات', () => startWordGame(sock, jid));
    return true;
  }

  // تشغيل لعبة تخمين الشخصيات
  if (trimmedText === "/شخصيات") {
    await startGameIfModerator(sock, jid, sender, kingdom, 'تخمين الشخصيات', () => startGuessCharacter(sock, jid, sender));
    return true;
  }

  // تشغيل لعبة الأعلام
  if (trimmedText === "/اعلام") {
    await startGameIfModerator(sock, jid, sender, kingdom, 'لعبة الأعلام', () => startFlagGame(sock, jid));
    return true;
  }

  // تشغيل لعبة ترتيب الحروف
  if (trimmedText === "/فك" || trimmedText === "/ترتيب_حروف") {
    await startGameIfModerator(sock, jid, sender, kingdom, 'ترتيب الحروف', () => startUnscrambleGame(sock, jid, sender));
    return true;
  }

  // تشغيل لعبة تفكيك الكلمات
  if (trimmedText === "/تفكيك" || trimmedText === "/تفكيك_الكلمات") {
    await startGameIfModerator(sock, jid, sender, kingdom, 'تفكيك الكلمات', () => startWordSplitterGame(sock, jid, sender));
    return true;
  }

  // عرض leaderboard موحد لجميع الألعاب
  if (trimmedText === "/ترتيب") {
    await showLeaderboard(sock, jid);
    return true;
  }

  // إيقاف الألعاب
  if (trimmedText === "/وقف") {
    await stopAllGames(sock, jid, sender, kingdom);
    return true;
  }

  return false;
}

async function stopAllGames(sock, jid, sender, kingdom) {
  const userIsModerator = await isModerator(sender, kingdom);
  if (!userIsModerator) {
    await sock.sendMessage(jid, { text: dashboardReply('reply_9d6d52e0724498b2')(['❌ فقط المشرفون والأدمن الأساسي يمكنهم إيقاف الألعاب!']) });
    return;
  }
  // إيقاف جميع الألعاب الممكنة
  let stoppedAny = false;
  if (activeGames[jid]) {
    await stopGuessAnime(sock, jid);
    await stopGameSession(sender, kingdom);
    stoppedAny = true;
  }
  if (activeWordGames[jid]) {
    await stopWordGame(sock, jid);
    await stopGameSession(sender, kingdom);
    stoppedAny = true;
  }
  if (activeCharacterGames[jid]) {
    await stopGuessCharacter(sock, jid);
    await stopGameSession(sender, kingdom);
    stoppedAny = true;
  }
  if (activeUnscrambleGames[jid]) {
    await stopUnscrambleGame(sock, jid);
    await stopGameSession(sender, kingdom);
    stoppedAny = true;
  }
  if (activeWordSplitterGames[jid]) {
    await stopWordSplitterGame(sock, jid);
    await stopGameSession(sender, kingdom);
    stoppedAny = true;
  }
  if (activeFlagGames[jid]) {
    await sock.sendMessage(jid, { text: dashboardReply('reply_f476b998baf36762')(["🛑 تم إيقاف لعبة الأعلام!"]) });
    clearAnswerQueue('flagGame', jid);
    await stopGameSession(sender, kingdom);
    delete activeFlagGames[jid];
    stoppedAny = true;
  }
  if (!stoppedAny) {
    await sock.sendMessage(jid, { text: dashboardReply('reply_54c70184a6bde4d5')(["❌ لا توجد ألعاب تعمل حالياً!"]) });
  }
}

// إجابات الألعاب الفعالة واختيارات أوضاعها
export async function handleActiveGameResponses(sock, jid, sender, text) {
  // التحقق من الإجابة إذا هناك لعبة أنمي فعالة
  if (activeGames[jid]) {
    const handled = await handleGuessAnimeResponse(sock, jid, sender, text);
    if (handled) return true;
  }

  // التحقق من الإجابة إذا هناك لعبة اعلام فعالة
  if (activeFlagGames[jid]) {
    const handled = await handleFlagGameResponse(sock, jid, sender, text);
    if (handled) return true;
  }

  // التحقق من الإجابة إذا هناك لعبة كلمات فعالة
  if (activeWordGames[jid]) {
    await checkWordGuess(sock, jid, sender, text);
    return true;
  }

  // التحقق من انتظار اختيار وضع لعبة الشخصيات
  if (characterGameWaiting[jid]) {
    if (characterGameWaiting[jid].mode === 'two_players') {
      await handleCharacterPlayersSelection(sock, jid, sender, text);
    } else {
      await handleGuessCharacterResponse(sock, jid, sender, text);
    }
    return true;
  }

  // التحقق من انتظار اختيار وضع لعبة ترتيب الحروف
  if (unscrambleGameWaiting[jid]) {
    if (unscrambleGameWaiting[jid].mode === 'two_players') {
      await handleUnscramblePlayersSelection(sock, jid, sender, text);
    } else {
      await handleUnscrambleResponse(sock, jid, sender, text);
    }
    return true;
  }

  // التحقق من الإجابة إذا هناك لعبة شخصيات فعالة
  if (activeCharacterGames[jid]) {
    await checkCharacterGuess(sock, jid, sender, text);
    return true;
  }

  // التحقق من الإجابة إذا هناك لعبة ترتيب حروف فعالة
  if (activeUnscrambleGames[jid]) {
    await checkUnscrambleGuess(sock, jid, sender, text);
    return true;
  }

  // التحقق من انتظار اختيار وضع لعبة تفكيك الكلمات
  if (wordSplitterGameWaiting[jid]) {
    if (wordSplitterGameWaiting[jid].mode === 'two_players') {
      await handleWordSplitterPlayersSelection(sock, jid, sender, text);
    } else {
      await handleWordSplitterModeSelection(sock, jid, sender, text);
    }
    return true;
  }

  // التحقق من الإجابة إذا هناك لعبة تفكيك كلمات فعالة
  if (activeWordSplitterGames[jid]) {
    await checkWordSplitterGuess(sock, jid, sender, text);
    return true;
  }

  return false;
}

/**
 * معالجة اختيار لعبة من قائمة الألعاب.
 */
async function handleGameChoice(sock, jid, sender, choice, kingdom) {
  const userIsModerator = await isModerator(sender, kingdom);
  if (!userIsModerator) {
    await sock.sendMessage(jid, { text: dashboardReply('reply_2cde6253a66bdae5')(['❌ فقط المشرفون والأدمن يمكنهم بدء الألعاب!']) });
    return;
  }

  switch (choice.trim()) {
    case '1':
      await startGameSession(sender, 'تخمين الأنمي', kingdom);
      await startGuessAnime(sock, jid);
      break;
    case '2':
      await startGameSession(sender, 'لعبة الكلمات', kingdom);
      await startWordGame(sock, jid);
      break;
    case '3':
      await startGameSession(sender, 'تخمين الشخصيات', kingdom);
      await startGuessCharacter(sock, jid, sender);
      break;
    case '4':
      await startGameSession(sender, 'ترتيب الحروف', kingdom);
      await startUnscrambleGame(sock, jid, sender);
      break;
    case '5':
      await startGameSession(sender, 'تفكيك الكلمات', kingdom);
      await startWordSplitterGame(sock, jid, sender);
      break;
    case '6':
      await startGameSession(sender, 'لعبة الأعلام', kingdom);
      await startFlagGame(sock, jid);
      break;
    default:
      await sock.sendMessage(jid, { text: dashboardReply('reply_3618c46e5b137ac1')(['❌ اختيار غير صحيح. أرسل رقمًا من 1 إلى 6.']) });
      break;
  }
}
