import User from "../database/userModel.js";
import { getKingdomIdFromGroupJid } from "../config.js";

export const activeWordSplitterGames = {};
const MAX_TIME = 30000; // 30 ثانية
const HINT_TIME = 15000; // 15 ثانية

// متغيرات لإدارة حالة الانتظار
export const wordSplitterGameWaiting = {};

// قائمة جملات وكلمات متعددة للتفكيك - كلمات عربية فقط
const phrases = [
  { jumbled: "العلمنورالحياة", correct: "العلم نور الحياة" },
  { jumbled: "الصبريفتحالأقفال", correct: "الصبر يفتح الأقفال" },
  { jumbled: "الأخوةهيالعزوالقوة", correct: "الأخوة هي العز والقوة" },
  { jumbled: "الحبوالسلامأساسالسعادة", correct: "الحب والسلام أساس السعادة" },
  { jumbled: "التعليمبنأالأممالجديد", correct: "التعليم بناء الأمم الجديد" },
  { jumbled: "الشموخفيالروحفيالقلب", correct: "الشموخ في الروح في القلب" },
  { jumbled: "العدلأساسالحضارة", correct: "العدل أساس الحضارة" },
  { jumbled: "الحريةحقمقدسلكلإنسان", correct: "الحرية حق مقدس لكل إنسان" },
  { jumbled: "الإخلاصيرفعالإنسان", correct: "الإخلاص يرفع الإنسان" },
  { jumbled: "الأمانةزينةالمؤمن", correct: "الأمانة زينة المؤمن" },
  { jumbled: "الصدقتطفئنارالذنوب", correct: "الصدقة تطفئ نار الذنوب" },
  { jumbled: "الشكرمفتاحالرسائل", correct: "الشكر مفتاح الرسائل" },
  { jumbled: "الرحمةصفةمؤمن", correct: "الرحمة صفة مؤمن" },
  { jumbled: "الأصدقاءالحقيقيونناديون", correct: "الأصدقاء الحقيقيون ناديون" },
  { jumbled: "الحياةاختبارونهايتها", correct: "الحياة اختبار ونهايتها" },
  { jumbled: "الأمللامايموتالإنسان", correct: "الأمل لا يموت الإنسان" },
  { jumbled: "التسامحقوةالقويين", correct: "التسامح قوة القويين" },
  { jumbled: "كلمةطيبةصدقة", correct: "كلمة طيبة صدقة" },
  { jumbled: "الجاهلخطيركلوحش", correct: "الجاهل خطير كل وحش" },
  { jumbled: "المعرفةقوةالعقل", correct: "المعرفة قوة العقل" },
  { jumbled: "الإرادةتحطمالعوائق", correct: "الإرادة تحطم العوائق" },
  { jumbled: "الصبرمفتاحالفرج", correct: "الصبر مفتاح الفرج" },
  { jumbled: "النجاحيحتاجعملجاد", correct: "النجاح يحتاج عمل جاد" },
  { jumbled: "الثقافةتزينالروح", correct: "الثقافة تزين الروح" },
  { jumbled: "الفنأسمىمظاهرالحضارة", correct: "الفن أسمى مظاهر الحضارة" },
  { jumbled: "الموسيقىتهدئالنفس", correct: "الموسيقى تهدئ النفس" },
  { jumbled: "القراءةافتتاحعقولجديدة", correct: "القراءة افتتاح عقول جديدة" },
  { jumbled: "الكتابةخلودالفكرة", correct: "الكتابة خلود الفكرة" },
  { jumbled: "الشعرغذاءالروح", correct: "الشعر غذاء الروح" },
  { jumbled: "الحكمةتاجالعقل", correct: "الحكمة تاج العقل" }
];

// بدء اللعبة
export async function startWordSplitterGame(sock, jid, sender) {
    if (activeWordSplitterGames[jid]) {
        await sock.sendMessage(jid, { text: "🎮 هناك لعبة تعمل حالياً!" });
        return;
    }

    // إرسال خيارات اللعبة
    await sock.sendMessage(jid, {
        text: `🎮 اختر نوع لعبة تفكيك الكلمات:\n\n1️⃣ للجميع في المجموعة\n2️⃣ بين شخصين محددين\n3️⃣ شرح اللعبة\n\nأرسل الرقم المطلوب.`
    });

    // انتظار الرد
    wordSplitterGameWaiting[jid] = {
        state: 'waiting_for_mode',
        initiator: sender
    };
}

// معالجة اختيار النمط
export async function handleWordSplitterModeSelection(sock, jid, sender, text) {
    const waiting = wordSplitterGameWaiting[jid];
    if (!waiting) return;

    // التحقق من الصلاحيات
    const { getKingdomIdFromGroupJid } = await import('../config.js');
    const { isModerator } = await import('../commands/adminSystem.js');
    const kingdom = getKingdomIdFromGroupJid(jid);
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
        clearTimeout(waiting.timeout);
        delete wordSplitterGameWaiting[jid];
        await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن يمكنهم بدء الألعاب!' });
        return;
    }

    clearTimeout(waiting.timeout);
    delete wordSplitterGameWaiting[jid];

    const mode = text.trim();

    if (mode === '1') {
        // للجميع
        await startAllPlayersGame(sock, jid, sender);
    } else if (mode === '2') {
        // بين شخصين
        await sock.sendMessage(jid, {
            text: `👥 وضع لشخصين محددين\n\nأرسل اسم اللاعب الأول (اللقب):`
        });

        wordSplitterGameWaiting[jid] = {
            sender: sender,
            mode: 'two_players',
            timeout: setTimeout(async () => {
                await sock.sendMessage(jid, { text: "⏱ انتهى وقت اختيار المشاركين!" });
                delete wordSplitterGameWaiting[jid];
            }, 30000)
        };
    } else if (mode === '3') {
        // شرح اللعبة
        await showWordSplitterExplanation(sock, jid);
        delete wordSplitterGameWaiting[jid];
        await startWordSplitterGame(sock, jid, sender);
    } else {
        await sock.sendMessage(jid, { text: "❌ اختيار غير صحيح! أرسل 1 أو 2 أو 3 فقط." });
    }
}

// دالة لعرض شرح لعبة تفكيك الكلمات
async function showWordSplitterExplanation(sock, jid) {
    const explanation = `
╔════════════════════════════════════╗
║  ✂️ شرح لعبة فصل الكلمات          ║
╚════════════════════════════════════╝

*🎮 أهداف اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
افصل الجملة المجمعة إلى كلمات منفصلة بالمسافات!

*📋 قواعد اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ ستُعطى جملة بدون مسافات
✅ عليك إضافة المسافات بين الكلمات
✅ يجب أن تكتب الجملة بالترتيب الصحيح تماماً
✅ لديك 30 ثانية لحل الجملة
✅ التطابق يجب أن يكون 100% دقيق
✅ كل إجابة صحيحة = +1 نقطة

*🎭 أنماط اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1️⃣ النمط الجماعي**
   • جميع الأعضاء يشاركون
   • سباق على السرعة والدقة
   • منافسة حامية وقوية

**2️⃣ النمط الثنائي**
   • صراع بين لاعبين فقط
   • تركيز عالي جداً
   • مثير جداً ومشوق!

*💡 نصائح للفوز:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👀 اقرأ الجملة بعناية عميقة
⚡ فكّر بالكلمات العربية الشهيرة
✂️ افصل كل كلمة على حدة بمسافة
📖 تذكر القواعد النحوية
🏆 السرعة + الدقة = الفوز!

*مثال:*
الجملة المجمعة: "العلمنورالحياة"
الجملة الصحيحة: "العلم نور الحياة"

جاهز؟ اختر النمط! 🚀`;

    await sock.sendMessage(jid, { text: explanation });
}

// معالجة اختيار اللاعبين للوضع الثنائي
export async function handleWordSplitterPlayersSelection(sock, jid, sender, text) {
    const waiting = wordSplitterGameWaiting[jid];
    if (!waiting || waiting.sender !== sender || waiting.mode !== 'two_players') return;

    // التحقق من الصلاحيات
    const { getKingdomIdFromGroupJid } = await import('../config.js');
    const { isModerator } = await import('../commands/adminSystem.js');
    const kingdom = getKingdomIdFromGroupJid(jid);
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
        clearTimeout(waiting.timeout);
        delete wordSplitterGameWaiting[jid];
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
        delete wordSplitterGameWaiting[jid];
        await startActualWordSplitterGame(sock, jid, players);
    }
}

// بدء اللعبة للجميع
async function startAllPlayersGame(sock, jid, sender) {
    await startActualWordSplitterGame(sock, jid, null);
}

async function startActualWordSplitterGame(sock, jid, players) {
    const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
    
    // determine if this is a single-word puzzle (no spaces)
    const isSingleWord = !randomPhrase.correct.includes(' ');
    let jumbledText = randomPhrase.jumbled;

    // if puzzle is single word, keep it intact so players only need to insert spaces between letters
    if (isSingleWord) {
        jumbledText = randomPhrase.correct;
    } else if (jumbledText === randomPhrase.correct) {
        // scramble phrases that accidentally match their correct form
        const chars = randomPhrase.correct.replace(/\s+/g, '').split('');
        function shuffle(arr) {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }
        let scrambled = chars.slice();
        do {
            scrambled = shuffle(scrambled.slice());
            jumbledText = scrambled.join('');
        } while (jumbledText === chars.join('') && chars.length > 1);
    }

    const game = {
        state: 'active',
        jumbled: jumbledText,
        correct: randomPhrase.correct,
        players: players, // null للجميع، أو مصفوفة JID
        mode: players ? 'duo' : 'group',
        startTime: Date.now(),
        answered: false,
        winners: [],
        letterMode: isSingleWord
    };

    activeWordSplitterGames[jid] = game;
    delete wordSplitterGameWaiting[jid];

    const playerText = players 
        ? `\n👥 المشاركون: ${players.map(p => p.split('@')[0]).join(' و ')}`
        : '\n👥 جميع الأعضاء مدعوون للمشاركة';

    let message;
    if (game.letterMode) {
        message = `🎮 **لعبة تفكيك الحروف${players ? ' (ثنائي)' : ' (جماعي)'}**
━━━━━━━━━━━━━━━━━━━
📝 ضع مسافة بين كل حرف من الكلمة التالية:

🔤 **${game.jumbled}**

⏱️ لديك 30 ثانية!${playerText}
💡 هل تستطيع؟
📌 أرسل /وقف لإيقاف اللعبة`;
    } else {
        message = `🎮 **لعبة تفكيك الكلمات${players ? ' (ثنائي)' : ' (جماعي)'}**
━━━━━━━━━━━━━━━━━━━
📝 فكك هذه الكلمات بوضع مسافات في الأماكن الصحيحة:

🔤 **${game.jumbled}**

⏱️ لديك 30 ثانية!${playerText}
💡 هل تستطيع؟
📌 أرسل /وقف لإيقاف اللعبة`;
    }

    await sock.sendMessage(jid, { text: message });

    // إيقاف اللعبة بعد انتهاء الوقت
    setTimeout(async () => {
        if (!activeWordSplitterGames[jid]) return;
        
        const currentGame = activeWordSplitterGames[jid];
        if (!currentGame.answered) {
            await sock.sendMessage(jid, { 
                text: `⏰ انتهى الوقت!\n\n✅ الإجابة الصحيحة:\n${currentGame.correct}` 
            });
        }
        // إخطار بالجولة القادمة مع مهلة 5 ثواني
        await sock.sendMessage(jid, { text: "⏭️ جولة جديدة قادمة بعد 5 ثواني..." });
        // جولة جديدة بعد 5 ثواني على الأقل
        setTimeout(() => {
            if (!activeWordSplitterGames[jid]) return;
            if (currentGame.players) {
                startActualWordSplitterGame(sock, jid, currentGame.players);
            } else {
                startActualWordSplitterGame(sock, jid, null);
            }
        }, 5000);
    }, MAX_TIME);
}

// معالجة إجابة اللاعب
export async function checkWordSplitterGuess(sock, jid, sender, text) {
    const game = activeWordSplitterGames[jid];
    if (!game) return;

    // فحص وتعيين فوري - هذا هو السبيل الوحيد الآمن تماماً
    if (game.answered) return;
    game.answered = true; // تعيين فوراً قبل أي عملية غير متزامنة

    try {
        // في نمط الشخصين، تحقق من أن المرسل هو أحد اللاعبين المحددين
        if (game.mode === 'duo' && game.players) {
            if (!game.players.includes(sender)) {
                return; // تجاهل الرسالة من غير المشاركين
            }
        }

        const guess = text.trim();

        // check answer according to mode
        let isCorrect = false;
        if (game.letterMode) {
            // player should provide letters separated by spaces (or anything) that collapse to the target
            const collapsed = guess.replace(/\s+/g, '');
            if (collapsed === game.correct.replace(/\s+/g, '')) {
                isCorrect = true;
            }
        } else {
            if (normalizeText(guess) === normalizeText(game.correct)) {
                isCorrect = true;
            }
        }

        if (isCorrect) {
            // قفل الإجابة فوراً قبل أي عملية غير متزامنة
            game.answered = true;

            const kingdom = getKingdomIdFromGroupJid(jid);
            const player = await User.findOne({ jid: sender, kingdom_id: kingdom });
            if (!player) return;

            // إضافة نقطة
            player.points = (player.points || 0) + 1;
            await player.save();

            const winMessage = `🎉 **برافو ${player.nickname}!**
━━━━━━━━━━━━━━━━━━━
✅ الإجابة صحيحة!
🎯 الجملة: ${game.correct}
⭐ +1 نقطة
💰 إجمالي نقاطك: ${player.points}`;

            await sock.sendMessage(jid, { text: winMessage, mentions: [sender] });
            // إخطار بالجولة القادمة مع مهلة 5 ثواني
            await sock.sendMessage(jid, { text: "⏭️ جولة جديدة قادمة بعد 5 ثواني..." });
            // جولة جديدة بعد 5 ثواني على الأقل
            setTimeout(() => {
                if (!activeWordSplitterGames[jid]) return;
                if (game.players) {
                    startActualWordSplitterGame(sock, jid, game.players);
                } else {
                    startActualWordSplitterGame(sock, jid, null);
                }
            }, 5000);
        }
    } catch (error) {
        console.error('خطأ في معالجة الإجابة:', error);
    }
}

// تطبيع النص للمقارنة
function normalizeText(text) {
    return text
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[،؛:]/g, '');
}

// إيقاف اللعبة
export async function stopWordSplitterGame(sock, jid) {
    if (activeWordSplitterGames[jid]) {
        const game = activeWordSplitterGames[jid];
        delete activeWordSplitterGames[jid];
        
        await sock.sendMessage(jid, { 
            text: `🛑 تم إيقاف لعبة تفكيك الكلمات!\n\n✅ الإجابة الصحيحة:\n${game.correct}` 
        });
    }
}
