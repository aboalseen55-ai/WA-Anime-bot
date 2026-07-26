import { getWords } from "../utils/wordList.js";
import User from "../database/userModel.js";
import { getKingdomIdFromGroupJid } from "../config.js";
import { getCleanMentionTextForUser } from "../commands/adminSystem.js";
import { awardGameXp } from "../utils/xpSystem.js";

export const activeWordGames = {};
export const wordGameWaiting = {};

// دالة لإنشاء جولة جديدة
async function startNewRound(sock, jid) {
  if (!activeWordGames[jid]) return; // إذا لم تكن اللعبة موجودة، لا تفعل شيئاً

  const words = getWords();
  const randomWord = words[Math.floor(Math.random() * words.length)];

  const game = activeWordGames[jid];
  game.word = randomWord;
  game.answered = false;
  game.round++;

  // إعادة تعيين المحاولات
  if (game.mode === 'duo' && game.players) {
    // للنمط الثنائي: إعادة تعيين محاولات كل لاعب بشكل منفصل
    game.playerAttempts[game.players[0]] = 3;
    game.playerAttempts[game.players[1]] = 3;
    game.playerAnswered[game.players[0]] = false;
    game.playerAnswered[game.players[1]] = false;
  } else if (game.mode === 'group' && game.allPlayersAttempts) {
    // للنمط الجماعي: إعادة تعيين محاولات كل لاعب
    for (const jid in game.allPlayersAttempts) {
      game.allPlayersAttempts[jid] = 3;
      game.allPlayersAnswered[jid] = false;
    }
  } else {
    // fallback (قديم) - لا يجب أن يتم استخدامه
    game.attempts = 3;
  }

  await sock.sendMessage(jid, {
    text: `📝 الجولة ${game.round}\nاكتب الكلمة التالية بشكل صحيح: *${randomWord}*\nلديك 3 محاولات.`,
  });
}

// دالة لعرض شرح اللعبة
async function showGameExplanation(sock, jid) {
  const explanation = `
╔════════════════════════════════════╗
║  📝 شرح لعبة كتابة الكلمات          ║
╚════════════════════════════════════╝

*🎮 أهداف اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
اكتب الكلمات بشكل صحيح وتطابق! كل إجابة صحيحة = +1 نقطة

*📋 قواعد اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ اكتب الكلمة المطلوبة بشكل دقيق
✅ الفراغات والأحرف يجب أن تكون صحيحة تماماً
✅ لديك 3 محاولات لكل كلمة
✅ كل لاعب له محاولاته الخاصة 🎯
✅ الإجابة الأولى الصحيحة تحسم الجولة

*🎭 أنماط اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1️⃣ النمط الجماعي (الجميع)**
   • جميع أعضاء المجموعة يشاركون
   • كل لاعب له 3 محاولات منفصلة
   • أول من يجيب بشكل صحيح يحصل على النقطة
   • إذا أنهى لاعب محاولاته، يمكن للآخرين المتابعة

**2️⃣ النمط الثنائي (شخصان)**
   • لاعبان محددان فقط
   • كل لاعب له 3 محاولات منفصلة
   • يستمران في المحاولة حتى ينتهي أحدهما أو أحدهما يجيب صحيح
   • سريعة ومركزة

*💡 نصائح للفوز:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 اقرأ الكلمة بعناية من البداية للنهاية
⚡ كن سريعاً - أول جواب صحيح يفوز
🎯 تجنب الأخطاء الإملائية البسيطة
🏆 كل جولة = فرصة جديدة لكسب نقطة

*📊 النقاط:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ إجابة صحيحة = +1 نقطة 🎉
❌ إجابة خاطئة = -1 محاولة

جاهز للعب؟ أرسل /كلمات لبدء اللعبة! 🚀`;

  await sock.sendMessage(jid, { text: explanation });
}

export async function startWordGame(sock, jid) {
  if (wordGameWaiting[jid] || activeWordGames[jid]) {
    await sock.sendMessage(jid, { text: "🎮 هناك لعبة تعمل حالياً!" });
    return;
  }

  // إرسال خيارات النمط
  await sock.sendMessage(jid, {
    text: `🎮 اختر نوع لعبة كتابة الكلمات:\n\n1️⃣ للجميع في المجموعة\n2️⃣ بين شخصين محددين\n3️⃣ شرح اللعبة\n\nأرسل الرقم المطلوب.\n📌 لإيقاف اللعبة استخدم الأمر /وقف` 
  });

  // وضع حالة انتظار اختيار النمط
  wordGameWaiting[jid] = {
    state: 'waiting_for_mode',
    timeout: setTimeout(async () => {
      await sock.sendMessage(jid, { text: "⏱ انتهى وقت اختيار النمط!" });
      delete wordGameWaiting[jid];
    }, 30000)
  };
}

export async function handleWordGameModeSelection(sock, jid, sender, text) {
  const waiting = wordGameWaiting[jid];
  if (!waiting) return;

  // التحقق من الصلاحيات
  const { getKingdomIdFromGroupJid } = await import('../config.js');
  const { isModerator } = await import('../commands/adminSystem.js');
  const kingdom = getKingdomIdFromGroupJid(jid);
  const userIsModerator = await isModerator(sender, kingdom);
  if (!userIsModerator) {
    clearTimeout(waiting.timeout);
    delete wordGameWaiting[jid];
    await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن يمكنهم بدء الألعاب!' });
    return;
  }

  clearTimeout(waiting.timeout);
  delete wordGameWaiting[jid];

  const choice = text.trim();

  if (choice === '1') {
    // للجميع
    await startActualWordGame(sock, jid, null);
  } else if (choice === '2') {
    // بين شخصين
    await sock.sendMessage(jid, {
      text: `👥 وضع لشخصين محددين\n\nأرسل اسم اللاعب الأول (اللقب):`
    });

    wordGameWaiting[jid] = {
      sender: sender,
      mode: 'two_players',
      timeout: setTimeout(async () => {
        await sock.sendMessage(jid, { text: "⏱ انتهى وقت اختيار المشاركين!" });
        delete wordGameWaiting[jid];
      }, 30000)
    };
  } else if (choice === '3') {
    // شرح اللعبة
    await showGameExplanation(sock, jid);
    // إعادة عرض القائمة للبداية من جديد
    await startWordGame(sock, jid);
  } else {
    await sock.sendMessage(jid, { text: "❌ اختيار غير صحيح! أرسل 1 أو 2 أو 3 فقط." });
  }
}

export async function handleWordGamePlayersSelection(sock, jid, sender, text) {
  const waiting = wordGameWaiting[jid];
  if (!waiting || waiting.sender !== sender || waiting.mode !== 'two_players') return;

  // التحقق من الصلاحيات
  const { getKingdomIdFromGroupJid } = await import('../config.js');
  const { isModerator } = await import('../commands/adminSystem.js');
  const kingdom = getKingdomIdFromGroupJid(jid);
  const userIsModerator = await isModerator(sender, kingdom);
  if (!userIsModerator) {
    clearTimeout(waiting.timeout);
    delete wordGameWaiting[jid];
    await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن يمكنهم بدء الألعاب!' });
    return;
  }

  clearTimeout(waiting.timeout);

  if (!waiting.player1) {
    // اختيار اللاعب الأول
    const user = await User.findOne({ nickname: { $regex: text.trim(), $options: 'i' } });
    if (!user) {
      await sock.sendMessage(jid, { text: '❌ لم يتم العثور على اللاعب. أعد المحاولة:' });
      return;
    }
    waiting.player1 = user.jid;
    await sock.sendMessage(jid, { text: '👤 أرسل اسم اللاعب الثاني (اللقب):' });
  } else {
    // اختيار اللاعب الثاني
    const user = await User.findOne({ nickname: { $regex: text.trim(), $options: 'i' } });
    if (!user) {
      await sock.sendMessage(jid, { text: '❌ لم يتم العثور على اللاعب. أعد المحاولة:' });
      return;
    }
    if (user.jid === waiting.player1) {
      await sock.sendMessage(jid, { text: '❌ لا يمكن اختيار نفس اللاعب مرتين. أعد المحاولة:' });
      return;
    }
    const players = [waiting.player1, user.jid];
    delete wordGameWaiting[jid];
    await startActualWordGame(sock, jid, players);
  }
}

async function startActualWordGame(sock, jid, players) {
  const words = getWords();
  const randomWord = words[Math.floor(Math.random() * words.length)];

  activeWordGames[jid] = {
    word: randomWord,
    attempts: 3, // للتوافقية (legacy)
    answered: false,
    round: 1,
    players: players, // null للجميع، أو مصفوفة JID
    mode: players ? 'duo' : 'group',
    // للنمط الثنائي: تتبع منفصل للمحاولات والإجابات
    playerAttempts: players ? {
      [players[0]]: 3,
      [players[1]]: 3
    } : null,
    playerAnswered: players ? {
      [players[0]]: false,
      [players[1]]: false
    } : null,
    // للنمط الجماعي: قاموس لتتبع محاولات كل لاعب
    allPlayersAttempts: !players ? {} : null,
    allPlayersAnswered: !players ? {} : null
  };

  const playerText = players 
    ? `\n👥 المشاركون: ${players.map(p => getCleanMentionTextForUser(p)).join(' و ')}`
    : '\n👥 جميع الأعضاء مدعوون للمشاركة';
  
  await sock.sendMessage(jid, {
    text: `🎮 بدأت لعبة كتابة الكلمات${players ? ' (ثنائي)' : ' (جماعي)'}!\n📝 الجولة 1\nاكتب الكلمة التالية بشكل صحيح: *${randomWord}*\nلديك 3 محاولات لكل جولة.${playerText}\nأرسل /ترك أو /وقف لإيقاف اللعبة.`
  });
}

export async function checkWordGuess(sock, jid, sender, guess) {
  if (!activeWordGames[jid]) return;

  const game = activeWordGames[jid];

  // إذا تم الإجابة على هذه الجولة بالفعل، تجاهل أي إجابات إضافية
  if (game.answered) return;

  // في نمط الشخصين، تحقق من أن المرسل هو أحد اللاعبين المحددين
  if (game.mode === 'duo' && game.players) {
    if (!game.players.includes(sender)) {
      return; // تجاهل الرسالة من غير المشاركين
    }

    // التحقق من أن هذا اللاعب لم ينته من محاولاته بعد
    if (game.playerAttempts[sender] <= 0) {
      return; // تجاهل، اللاعب انتهت محاولاته
    }
  } else if (game.mode === 'group') {
    // النمط الجماعي: تحقق من أن اللاعب لم ينته من محاولاته
    if (!game.allPlayersAttempts[sender]) {
      game.allPlayersAttempts[sender] = 3;
      game.allPlayersAnswered[sender] = false;
    }

    if (game.allPlayersAttempts[sender] <= 0) {
      return; // تجاهل، هذا اللاعب انتهت محاولاته
    }
  }

  const normalizedGuess = guess.trim().toLowerCase();
  const normalizedWord = game.word.trim().toLowerCase();

  // البحث عن المستخدم بـ jid للحصول على اللقب
  const kingdom = getKingdomIdFromGroupJid(jid);
  const userByJid = await User.findOne({ jid: sender, kingdom_id: kingdom });
  const playerNickname = userByJid?.nickname || sender.split("@")[0];

  if (normalizedGuess === normalizedWord) {
    // إجابة صحيحة
    // تعيين الإجابة فوراً قبل أي معالجة (منع race condition)
    game.answered = true; // إنهاء الجولة فوراً

    if (game.mode === 'duo') {
      // تحقق ذري في النمط الثنائي
      if (game.playerAnswered[sender]) return; // اللاعب أجاب بالفعل
      game.playerAnswered[sender] = true; // قفل فوراً
    } else if (game.mode === 'group') {
      // تحقق ذري في النمط الجماعي
      if (game.allPlayersAnswered[sender]) return; // اللاعب أجاب بالفعل
      game.allPlayersAnswered[sender] = true; // قفل فوراً
    }

    // حفظ النقطة في قاعدة البيانات
    if (userByJid) {
      userByJid.points = (userByJid.points || 0) + 1;
      const xpResult = awardGameXp(userByJid, 1);
      await userByJid.save();
      await sock.sendMessage(jid, {
        text: `✅ أحسنت يا ${playerNickname}! الكلمة الصحيحة هي: *${game.word}*\n💰 +1 نقطة\n✨ +${xpResult.awardedXp} XP${xpResult.leveledUp ? `\n🏅 وصلت للمستوى ${xpResult.newLevel}!` : ""}\nمجموع نقاطك: 💰${userByJid.points}\n\n⏭️ جولة جديدة قادمة...`,
      });
    } else {
      await sock.sendMessage(jid, {
        text: `🎉 أحسنت يا ${playerNickname}! الكلمة الصحيحة هي: *${game.word}*\n⚠️ لكن لا يمكن احتساب النقطة لأنك غير مسجل.\n\n⏭️ جولة جديدة قادمة...`,
      });
    }

    // بدء جولة جديدة بعد 5 ثواني على الأقل
    await sock.sendMessage(jid, { text: "⏭️ جولة جديدة قادمة بعد 5 ثواني..." });
    setTimeout(() => startNewRound(sock, jid), 5000);
    return;
  }

  // إجابة خاطئة
  if (game.mode === 'duo') {
    // النمط الثنائي: تقليل محاولات هذا اللاعب فقط
    game.playerAttempts[sender]--;

    if (game.playerAttempts[sender] <= 0) {
      // هذا اللاعب انتهت محاولاته
      const otherPlayer = game.players.find(p => p !== sender);
      const otherAttempts = game.playerAttempts[otherPlayer];

      if (otherAttempts > 0 && !game.playerAnswered[otherPlayer]) {
        // اللاعب الآخر لديه محاولات متبقية
        await sock.sendMessage(jid, {
          text: `❌ إجابة خاطئة يا ${playerNickname}! انتهت محاولاتك.\n\n🔄 يمكن للاعب الآخر أن يكمل مع ${otherAttempts} محاولات.`,
        });
      } else {
        // كلا اللاعبين انتهت محاولاتهم
        await sock.sendMessage(jid, {
          text: `❌ انتهت المحاولات للجميع! الكلمة الصحيحة كانت: *${game.word}*\n\n⏭️ جولة جديدة قادمة...`,
        });
        setTimeout(() => startNewRound(sock, jid), 5000); // تأخير 5 ثواني على الأقل
      }
    } else {
      // لا تزال لديه محاولات
      await sock.sendMessage(jid, {
        text: `❌ إجابة خاطئة يا ${playerNickname}. تبقى لديك ${game.playerAttempts[sender]} محاولة.\nحاول مرة أخرى: *${game.word}*`,
      });
    }
  } else if (game.mode === 'group') {
    // النمط الجماعي: تقليل محاولات هذا اللاعب فقط
    game.allPlayersAttempts[sender]--;

    if (game.allPlayersAttempts[sender] <= 0) {
      // هذا اللاعب انتهت محاولاته
      const remainingPlayers = Object.keys(game.allPlayersAttempts).filter(
        p => game.allPlayersAttempts[p] > 0 && !game.allPlayersAnswered[p]
      );

      if (remainingPlayers.length > 0) {
        // هناك لاعبون آخرون لديهم محاولات متبقية
        await sock.sendMessage(jid, {
          text: `❌ إجابة خاطئة يا ${playerNickname}! انتهت محاولاتك.\n\n🔄 لاعبون آخرون يمكنهم المتابعة...`,
        });
      } else {
        // جميع اللاعبين انتهت محاولاتهم
        await sock.sendMessage(jid, {
          text: `❌ انتهت المحاولات للجميع! الكلمة الصحيحة كانت: *${game.word}*\n\n⏭️ جولة جديدة قادمة...`,
        });
        setTimeout(() => startNewRound(sock, jid), 2000);
      }
    } else {
      // لا تزال لديه محاولات
      await sock.sendMessage(jid, {
        text: `❌ إجابة خاطئة يا ${playerNickname}. تبقى لديك ${game.allPlayersAttempts[sender]} محاولة.\nحاول مرة أخرى: *${game.word}*`,
      });
    }
  }
}

export async function stopWordGame(sock, jid) {
  if (activeWordGames[jid]) {
    const game = activeWordGames[jid];
    await sock.sendMessage(jid, {
      text: `🛑 تم إيقاف لعبة كتابة الكلمات!\n📊 انتهت اللعبة في الجولة ${game.round}\n\nاستخدم /كلمات لبدء لعبة جديدة.`
    });
    delete activeWordGames[jid];
  }
}
