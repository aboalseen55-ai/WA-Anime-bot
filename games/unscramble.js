import User from "../database/userModel.js";
import { getKingdomIdFromGroupJid } from "../config.js";
import { enqueueAnswer, processAnswerQueue, clearAnswerQueue } from "../utils/answerQueue.js";

export const activeUnscrambleGames = {};
const MAX_TIME = 30000; // 30 ثانية
const HINT_TIME = 15000; // 15 ثانية
const ROUND_DELAY = 3000; // 3 ثواني تأخير بين الجولات

// متغيرات لإدارة حالة الانتظار لاختيار الوضع
export const unscrambleGameWaiting = {};

// قائمة كلمات للتفكيك (كلمات عربية فقط - مستوى تنافسي عالي)
const words = [
  // كلمات أساسية
  "الحضارة", "المدينة", "العلم", "الفن", "الموسيقى", "الرياضة", "المعلم",
  "المجتمع", "الثقافة", "التراث", "الأصدقاء", "العائلة", "البيت", "المدرسة",
  
  // كلمات تاريخية
  "الفراعنة", "الحجاج", "الخلافة", "المعاهدة", "الدولة", "الإمبراطورية",
  "الحرب", "السلطان", "الملك", "القيصر", "الخليفة", "الأمير", "الفتح",
  
  // كلمات أدبية وشعرية
  "القصيدة", "الشاعر", "الرواية", "الكاتب", "الأسطورة", "الخيال",
  "الحزن", "الفرح", "الطموح", "النجاح", "النصر", "الكفاح", "الصمود",
  "الشموخ", "الجمال", "الرقة", "الفضيلة", "الشرف", "الكرامة", "الحب",
  
  // كلمات علمية
  "الفيزياء", "الرياضيات", "الكيمياء", "الأحياء", "الفلسفة", "المنطق",
  "النظرية", "التجربة", "الاكتشاف", "الابتكار", "الذكاء", "المعرفة",
  "الحكمة", "الحقيقة", "الواقع", "التفكير", "العقل", "التحليل",
  
  // كلمات طبيعية
  "الجبال", "الأنهار", "البحار", "الصحراء", "الغابات", "الحقول", "الجزر",
  "السماء", "النجوم", "القمر", "الشمس", "الريح", "المطر", "الثلج",
  "الرعد", "البرق", "الزلزال", "البركان", "الفيضان", "الأعاصير",
  
  // كلمات اجتماعية
  "المحبة", "الأخوّة", "التعاون", "الوحدة", "الكرامة", "العدل", "الحرية",
  "المساواة", "السلام", "الأمان", "الاستقرار", "التطور", "التقدم", "الرقي",
  "الإنسانية", "الرحمة", "الصبر", "الشجاعة", "القوة", "الثقة", "الأمل",
  
  // كلمات دينية
  "الإيمان", "التقوى", "العبادة", "الدعاء", "التسبيح", "التوكل", "الرضا",
  "المغفرة", "الرحمة", "النور", "الهدى", "الجنة", "الأخلاق",
  "الصفاء", "القلب", "الروح", "البركة", "الحسنة", "الذكر",
  
  // كلمات تقنية عربية
  "الحاسوب", "البرنامج", "الإنترنت", "التكنولوجيا", "الاتصالات", "الوسائط",
  "الرقمية", "البيانات", "المعلومات", "الأمن", "الحماية", "التطبيق",
  
  // كلمات فنية
  "الألوان", "الفرشاة", "القماش", "النحت", "الرسم", "التصوير", "الديكور",
  "الزينة", "الأناقة", "التناغم", "التوازن", "الملمس", "الشكل", "البعد",
  
  // كلمات رياضية
  "السباحة", "الجري", "القفز", "الرمي", "المرونة", "القوة", "السرعة",
  "الفريق", "المنافسة", "الفوز", "التدريب", "الملعب", "الكرة", "النقاط",
  
  // كلمات متقدمة
  "الاستبشار", "الاستقرار", "الاستقلال", "الاستنباط", "الاستقامة",
  "الاستشارة", "الاستعداد", "الاستفادة", "الاستحقاق", "الاستقبال",
  "التجاهل", "التطاول", "التماسك", "التماثل", "التمايز", "التمام",
  "التمويل", "التنافس", "التنافر", "التنافي", "التنويع", "الترابط"
];

// دالة لفصل حروف الكلمة بمسافات
function separateLetters(word) {
  return word.split('').join(' ');
}

// بدء اللعبة
export async function startUnscrambleGame(sock, jid, sender) {
    // التحقق من صلاحية المرسل (مشرف أو مالك)
    const isAdmin = await checkAdmin(sock, jid, sender);
    if (!isAdmin) {
        await sock.sendMessage(jid, { text: "❌ هذا الأمر متاح للمشرفين فقط!" });
        return;
    }

    if (activeUnscrambleGames[jid]) {
        await sock.sendMessage(jid, { text: "🎮 هناك لعبة تعمل حالياً!" });
        return;
    }

    // إرسال خيارات اللعبة
    await sock.sendMessage(jid, {
        text: `🎮 اختر نوع لعبة ترتيب الحروف:\n\n1️⃣ للجميع في المجموعة\n2️⃣ بين شخصين محددين\n3️⃣ شرح اللعبة\n\nأرسل الرقم المطلوب.`
    });

    // وضع حالة الانتظار
    unscrambleGameWaiting[jid] = {
        sender: sender,
        timeout: setTimeout(async () => {
            await sock.sendMessage(jid, { text: "⏱ انتهى وقت الاختيار!" });
            delete unscrambleGameWaiting[jid];
        }, 30000) // 30 ثانية للاختيار
    };
}

// دالة التعامل مع ردود اختيار الوضع
export async function handleUnscrambleResponse(sock, jid, sender, text) {
    const waiting = unscrambleGameWaiting[jid];
    if (!waiting || waiting.sender !== sender) return;

    // التحقق من الصلاحيات
    const { getKingdomIdFromGroupJid } = await import('../config.js');
    const { isModerator } = await import('../commands/adminSystem.js');
    const kingdom = getKingdomIdFromGroupJid(jid);
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
        clearTimeout(waiting.timeout);
        delete unscrambleGameWaiting[jid];
        await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن يمكنهم بدء الألعاب!' });
        return;
    }

    clearTimeout(waiting.timeout);
    delete unscrambleGameWaiting[jid];

    const choice = text.trim();

    if (choice === '1') {
        // وضع جميع الأعضاء
        await startActualUnscrambleGame(sock, jid, null);
    } else if (choice === '2') {
        // وضع شخصين محددين
        await sock.sendMessage(jid, {
            text: `👥 وضع لشخصين محددين\n\nأرسل اسم اللاعب الأول (اللقب):`
        });

        unscrambleGameWaiting[jid] = {
            sender: sender,
            mode: 'two_players',
            timeout: setTimeout(async () => {
                await sock.sendMessage(jid, { text: "⏱ انتهى وقت اختيار المشاركين!" });
                delete unscrambleGameWaiting[jid];
            }, 30000)
        };
    } else if (choice === '3') {
        // شرح اللعبة
        await showUnscrambleExplanation(sock, jid);
        delete unscrambleGameWaiting[jid];
        await startUnscrambleGame(sock, jid, sender);
    } else {
        await sock.sendMessage(jid, { text: '❌ اختر 1 أو 2 أو 3 فقط!' });
    }
}

// دالة التعامل مع اختيار المشاركين للوضع الثنائي
export async function handleUnscramblePlayersSelection(sock, jid, sender, text) {
    const waiting = unscrambleGameWaiting[jid];
    if (!waiting || waiting.sender !== sender || waiting.mode !== 'two_players') return;

    // التحقق من الصلاحيات
    const { getKingdomIdFromGroupJid } = await import('../config.js');
    const { isModerator } = await import('../commands/adminSystem.js');
    const kingdom = getKingdomIdFromGroupJid(jid);
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
        clearTimeout(waiting.timeout);
        delete unscrambleGameWaiting[jid];
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
        waiting.player1 = user; // تخزين بيانات المستخدم الكاملة
        await sock.sendMessage(jid, { text: '👤 أرسل اسم اللاعب الثاني (اللقب):' });
    } else {
        // اختيار اللاعب الثاني
        const user = await User.findOne({ nickname: { $regex: text.trim(), $options: 'i' } });
        if (!user) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على اللاعب. أعد المحاولة:' });
            return;
        }
        if (user.jid === waiting.player1.jid) {
            await sock.sendMessage(jid, { text: '❌ لا يمكن اختيار نفس اللاعب مرتين. أعد المحاولة:' });
            return;
        }
        const players = [waiting.player1, user]; // تخزين بيانات المستخدمين الكاملة
        delete unscrambleGameWaiting[jid];
        await startActualUnscrambleGame(sock, jid, players);
    }
}

// دالة لعرض شرح اللعبة
async function showUnscrambleExplanation(sock, jid) {
    const explanation = `
╔════════════════════════════════════╗
║  � شرح لعبة تفكيك الحروف          ║
╚════════════════════════════════════╝

*🎮 أهداف اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
رتّب الحروف المخلوطة لتكوين كلمة عربية صحيحة!

*📋 قواعد اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ ستُعطى حروف مخلوطة لكلمة عربية
✅ رتّب الحروف بالترتيب الصحيح
✅ لديك 30 ثانية لكل كلمة
✅ التطابق يجب أن يكون 100%
✅ كل إجابة صحيحة = +1 نقطة

*🎭 أنماط اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1️⃣ النمط الجماعي**
   • كل الأعضاء يتنافسون
   • من يكون الأسرع يفوز
   • منافسة حادة وقوية

**2️⃣ النمط الثنائي**
   • صراع مباشر بين لاعبين
   • سرعة وتركيز عالي
   • من يحل أولاً يحصل على النقطة

*💡 نصائح للفوز:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 فكّر في الكلمات العربية الشائعة
⚡ كن سريعاً جداً
📝 تخيل الكلمة قبل كتابتها
🏆 التركيز أهم من السرعة

جاهز للعب؟ اختر نمطاً! 🚀`;

    await sock.sendMessage(jid, { text: explanation });
}

// بدء اللعبة الفعلية
async function startActualUnscrambleGame(sock, jid, players) {
    // حذف state interim والتأكد من بدء جولة جديدة
    const existingGame = activeUnscrambleGames[jid];
    if (existingGame && existingGame.state === 'interim') {
        delete existingGame.state;
        delete existingGame.startingNewRound;
    }

    // اختيار كلمة عشوائية
    const word = words[Math.floor(Math.random() * words.length)];
    const separatedLetters = separateLetters(word);

    // دالة لخلط الأحرف وإرجاع ترتيب جديد
    function shuffleString(str) {
        const arr = str.split('');
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr.join('');
    }

    // نحاول الحصول على ترتيب مختلف عن الكلمة الأصلية
    let scrambled = shuffleString(word);
    if (scrambled === word && word.length > 1) {
        // أعيد الخلط حتى يختلف
        do {
            scrambled = shuffleString(word);
        } while (scrambled === word);
    }

    activeUnscrambleGames[jid] = {
        word: word,
        scrambled: scrambled,
        separatedLetters: separatedLetters,
        players: players, // null للجميع، أو مصفوفة لشخصين محددين
        startTime: Date.now(),
        hintSent: false,
        timeout: null,
        hintTimeout: null,
        answered: false
    };

    // إرسال الرسالة الأولية مع الوصف
    // استخدام نفس منطق /منشن - الحصول على المنشن المحفوظ أو استخدام الرقم
    const playerText = players ? `\n👥 المشاركون: ${players.map(p => (p.mention || `@${p.jid.split('@')[0]}`)).join(' و ')}` : '\n👥 جميع الأعضاء مدعوون للمشاركة';
    const messageOptions = {
        text: `🎮 لعبة ترتيب الحروف${playerText}\n\n🔤 الكلمة:\n${scrambled}\n\n⏱ لديك 30 ثانية لترتيب الحروف بالشكل الصحيح\n💡 سيظهر تلميح بعد 15 ثانية\n📌 أرسل /وقف لإيقاف اللعبة`
    };
    if (players) {
        messageOptions.mentions = players.map(p => p.jid);
    }
    await sock.sendMessage(jid, messageOptions);

    // تلميح بعد 15 ثانية
    activeUnscrambleGames[jid].hintTimeout = setTimeout(async () => {
        const game = activeUnscrambleGames[jid];
        if (game && !game.hintSent) {
            game.hintSent = true;
            await sock.sendMessage(jid, {
                text: `💡 تلميح: أول حرف هو "${word[0]}" وآخر حرف هو "${word[word.length - 1]}"`
            });
        }
    }, HINT_TIME);

    // انتهاء الوقت بعد 30 ثانية
    activeUnscrambleGames[jid].timeout = setTimeout(async () => {
        const game = activeUnscrambleGames[jid];
        if (game && !game.answered) {
            await sock.sendMessage(jid, {
                text: `⏱ انتهى الوقت!\n✅ الكلمة الصحيحة: **${word}**`
            });
            clearTimeout(game.hintTimeout);
            // إخطار بالجولة القادمة
            await sock.sendMessage(jid, { text: "⏭️ جولة جديدة قادمة..." });
            
            const playersList = game.players;
            
            // تعيين الحالة إلى "interim" لمنع التداخل
            activeUnscrambleGames[jid] = { 
                state: 'interim',
                players: playersList,
                startingNewRound: true
            };
            
            setTimeout(() => {
                // التحقق من أن الحالة لا تزال "interim"
                if (activeUnscrambleGames[jid] && activeUnscrambleGames[jid].state === 'interim') {
                    startActualUnscrambleGame(sock, jid, playersList);
                }
            }, ROUND_DELAY);
        }
    }, MAX_TIME);
}

// التحقق من الإجابة
export async function checkUnscrambleGuess(sock, jid, sender, text) {
    const game = activeUnscrambleGames[jid];
    
    // إذا كانت الحالة interim (انتظار جولة جديدة)، أتجاهل الرسائل
    if (game && game.state === 'interim') {
        return;
    }
    
    // إذا تم الإجابة على هذه الجولة بالفعل، تجاهل أي إجابات إضافية
    if (game && game.answered) {
        return;
    }
    
    // sometimes we replace the game with a placeholder object while scheduling the next round
    // if word is missing then nothing to check
    if (!game || !game.word) return;

    // تحقق إذا كان المرسل هو أحد المشاركين (إذا كانت هناك مشاركون محددين)
    if (game.mode === 'duo' && game.players) {
        const kingdom = getKingdomIdFromGroupJid(jid);
        const userByJid = await User.findOne({ jid: sender, kingdom_id: kingdom });
        const playerNickname = userByJid?.nickname || sender.split("@")[0];
        if (!game.players.includes(playerNickname)) {
            // لا نرسل رسالة، فقط نتجاهل
            return;
        }
    }

    // أضف الإجابة إلى قائمة الانتظار
    const shouldProcessQueue = enqueueAnswer('unscramble', jid, { sender, text });

    // معالجة قائمة الانتظار فقط إذا كانت هذه أول إجابة
    if (shouldProcessQueue) {
        await processAnswerQueue('unscramble', jid, 
        async (answerSender, answerText) => {
            const g = activeUnscrambleGames[jid];
            if (!g || !g.word) return false;

            const guess = answerText.trim().toLowerCase().replace(/\s+/g, ''); // إزالة المسافات
            const correctWord = g.word.toLowerCase().replace(/\s+/g, '');

            if (guess === correctWord) {
                // إجابة صحيحة - عيِّن الحالة فوراً لمنع معالجة إضافية
                g.state = 'interim';
                g.answered = true;
                clearTimeout(g.timeout);
                clearTimeout(g.hintTimeout);
                
                // إضافة النقاط والإشعار
                const kingdom = getKingdomIdFromGroupJid(jid);
                const player = await User.findOne({ jid: answerSender, kingdom_id: kingdom });
                
                if (player) {
                    const correctWithSpaces = separateLetters(g.word);
                    player.points = (player.points || 0) + 1;
                    await player.save();

                    const winMessage = `🎉 **برافو ${player.nickname}!**
━━━━━━━━━━━━━━━━━━━
✅ الإجابة صحيحة!
🔤 الحروف المفصولة: ${correctWithSpaces}
⭐ +1 نقطة
💰 إجمالي نقاطك: ${player.points}`;

                    await sock.sendMessage(jid, { text: winMessage, mentions: [answerSender] });
                }

                return true; // إجابة صحيحة
            }

            return false; // إجابة خاطئة
        },
        async () => {
            // عند إنهاء الجولة، انتظر 3 ثواني ثم ابدأ جولة جديدة
            const g = activeUnscrambleGames[jid];
            if (!g) return;

            clearTimeout(g.timeout);
            clearTimeout(g.hintTimeout);

            const playersList = g.players;
            activeUnscrambleGames[jid] = { 
                state: 'interim',
                players: playersList
            };

            await sock.sendMessage(jid, { text: "⏭️ جولة جديدة قادمة بعد 3 ثواني..." });
            
            setTimeout(() => {
                if (activeUnscrambleGames[jid] && activeUnscrambleGames[jid].state === 'interim') {
                    startActualUnscrambleGame(sock, jid, playersList);
                }
            }, ROUND_DELAY);
        }
    );
    }
}

// إيقاف اللعبة
export async function stopUnscrambleGame(sock, jid) {
    if (activeUnscrambleGames[jid]) {
        clearTimeout(activeUnscrambleGames[jid].timeout);
        clearTimeout(activeUnscrambleGames[jid].hintTimeout);
        clearAnswerQueue('unscramble', jid);
        delete activeUnscrambleGames[jid];
        await sock.sendMessage(jid, { text: "🛑 تم إيقاف لعبة ترتيب الحروف!" });
    } else {
        await sock.sendMessage(jid, { text: "❌ لا توجد لعبة ترتيب الحروف تعمل حالياً!" });
    }
}

// دالة التحقق من الصلاحيات
async function checkAdmin(sock, jid, sender) {
    try {
        const groupMetadata = await sock.groupMetadata(jid);
        const participant = groupMetadata.participants.find(p => p.id === sender);

        if (!participant) return false;

        // التحقق من كون المرسل مشرف أو مالك
        return participant.admin === 'admin' || participant.admin === 'superadmin';
    } catch (error) {
        console.error('خطأ في التحقق من الصلاحيات:', error);
        return false;
    }
}

