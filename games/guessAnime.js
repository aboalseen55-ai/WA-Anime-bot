import Anime from "../database/animeModel.js";
import User from "../database/userModel.js";
import stringSimilarity from "string-similarity";
import fetch from "node-fetch";
import { getKingdomIdFromGroupJid } from "../config.js";
import { enqueueAnswer, processAnswerQueue, clearAnswerQueue } from "../utils/answerQueue.js";

export const activeGames = {};
const MAX_TIME = 15000; // 15 ثواني
const HINT_TIME = 5000; // 5 ثواني
const ROUND_DELAY = 3000; // 3 ثواني تأخير بين الجولات

// دالة لعرض شرح اللعبة
async function showGameExplanation(sock, jid) {
    const explanation = `
╔════════════════════════════════════╗
║  🎬 شرح لعبة تخمين الأنمي           ║
╚════════════════════════════════════╝

*🎮 أهداف اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
خمّن اسم الأنمي من صورة المسلسل وحقق نقاط!

*📋 قواعد اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ ستُعرض عليك صورة من أنمي معين
✅ اكتب اسم الأنمي بالعربية أو الإنجليزية
✅ لديك 15 ثانية فقط 🏃⚡
✅ بعد 5 ثواني سيظهر تلميح
✅ أول إجابة صحيحة تحسم الجولة

*🎭 أنماط اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1️⃣ النمط الجماعي (الجميع)**
   • جميع أعضاء المجموعة يشاركون
   • أول من يجيب بشكل صحيح يحصل على النقاط
   • سريعة ومشوقة

**2️⃣ النمط الثنائي (شخصان)**
   • لاعبان محددان فقط
   • منافسة مباشرة بينهما
   • من يكون الأسرع يفوز

*💡 نصائح للفوز:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👀 انتبه للتفاصيل في الصورة
⚡ كن سريعاً - الوقت محدود!
🎯 حاول التخمين قبل انتهاء الوقت
💰 كل إجابة صحيحة = +10 نقاط

*📊 النقاط:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ إجابة صحيحة = +10 نقاط 🎉
🏃 الإجابة السريعة = بونص إضافي

جاهز للعب؟ اختر النمط! 🚀`;

    await sock.sendMessage(jid, { text: explanation });
}

// دالة لجلب صورة الأنمي من API
async function fetchImage(title) {
    try {
        const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=1`);
        const data = await res.json();
        return data.data && data.data[0] ? data.data[0].images.jpg.image_url : null;
    } catch {
        return null;
    }
}

// بدء اللعبة
export async function startGuessAnime(sock, jid) {
    if (activeGames[jid]) {
        await sock.sendMessage(jid, { text: "🎮 هناك لعبة تعمل حالياً!" });
        return;
    }

    // إرسال خيارات اللعبة
    await sock.sendMessage(jid, {
        text: `🎮 اختر نوع لعبة تخمين الأنمي:\n\n1️⃣ للجميع في المجموعة\n2️⃣ بين شخصين محددين\n3️⃣ شرح اللعبة\n\nأرسل الرقم المطلوب.\n📌 لإيقاف اللعبة في أي وقت استخدم الأمر /وقف` }
    );

    // انتظار الرد
    activeGames[jid] = {
        state: 'waiting_for_mode',
        participants: null
    };
}

// التحقق من الإجابة
export async function checkGuess(sock, jid, sender, text) {
    // هذه الدالة الآن موجودة في handleGuessAnimeResponse باستخدام نظام الطابور
    // تم الاحتفاظ بها للتوافق مع الرموز القديمة
    await handleGuessAnimeResponse(sock, jid, sender, text);
}

// بدء اللعبة الفعلية بعد اختيار الوضع
async function startActualGame(sock, jid) {
    const game = activeGames[jid];
    if (!game) return;

    // حذف state interim والتأكد من بدء جولة جديدة
    if (game.state === 'interim') {
        delete game.state;
        delete game.startingNewRound;
    }

    // اختيار أنمي عشوائي من DB (فقط الأنمي التي تحتوي على أسماء عربية)
    const count = await Anime.countDocuments({ arabicNames: { $exists: true, $ne: [] } });
    if (!count) {
        await sock.sendMessage(jid, { text: "❌ لا يوجد أنميات عربية في قاعدة البيانات" });
        delete activeGames[jid];
        return;
    }

    const rand = Math.floor(Math.random() * count);
    const anime = await Anime.findOne({ arabicNames: { $exists: true, $ne: [] } }).skip(rand);

    if (!anime) {
        await sock.sendMessage(jid, { text: "❌ فشل اختيار أنمي" });
        delete activeGames[jid];
        return;
    }

    // التأكد من وجود الاسم العربي والإنجليزي
    const arabicName = anime.arabicNames && anime.arabicNames[0];
    const englishName = anime.aliases && anime.aliases[0];

    if (!arabicName || !englishName) {
        await sock.sendMessage(jid, { text: "❌ خطأ في تحميل اللعبة، الأنمي غير مكتمل في قاعدة البيانات." });
        delete activeGames[jid];
        return;
    }

    // جلب صورة الأنمي
    const imageUrl = await fetchImage(englishName);
    if (!imageUrl) {
        await sock.sendMessage(jid, { text: "❌ خطأ في تحميل اللعبة، الصورة غير متوفرة." });
        delete activeGames[jid];
        return;
    }

    // إعداد الإجابات
    const answerVariants = [
        ...(Array.isArray(anime.arabicNames) ? anime.arabicNames : []),
        ...(Array.isArray(anime.aliases) ? anime.aliases : [])
    ].filter(Boolean);

    // تحديث activeGames
    activeGames[jid] = {
        answerVariants,
        startTime: Date.now(),
        hintSent: false,
        timeout: null,
        hintTimeout: null,
        answered: false,
        participants: game.participants
    };

    // إرسال الرسالة الأولية مع الصورة
    await sock.sendMessage(jid, {
        image: { url: imageUrl },
        caption: `🎮 لعبة تخمين الأنمي\n⏱ لديك 15 ثانية\n💡 سيظهر تلميح بعد 5 ثواني`
    });

    // تلميح بعد 5 ثواني
    activeGames[jid].hintTimeout = setTimeout(async () => {
        const game = activeGames[jid];
        if (game && !game.hintSent) {
            game.hintSent = true;
            await sock.sendMessage(jid, {
                text: `💡 تلميح: ${arabicName.slice(0, 3)}...`
            });
        }
    }, HINT_TIME);

    // انتهاء الوقت بعد 15 ثانية
    activeGames[jid].timeout = setTimeout(async () => {
        const game = activeGames[jid];
        if (game && !game.answered) {
            await sock.sendMessage(jid, {
                text: `⏱ انتهى الوقت!\nالأنمي هو: ${arabicName}`
            });
            clearTimeout(game.hintTimeout);

            // إخطار بالجولة القادمة 
            await sock.sendMessage(jid, { text: "⏭️ جولة جديدة قادمة بعد 3 ثواني..." });
            
            // حفظ إعدادات اللعبة قبل إعادة التعيين
            const participants = game.participants;
            
            // تعيين الحالة إلى "interim" لمنع التداخل
            activeGames[jid] = { 
                state: 'interim', 
                participants
            };
            
            setTimeout(async () => {
                // التحقق من أن الحالة لا تزال "interim"
                if (activeGames[jid] && activeGames[jid].state === 'interim') {
                    await startActualGame(sock, jid);
                }
            }, ROUND_DELAY); // تأخير 3 ثواني
        }
    }, MAX_TIME)
}

// معالجة ردود اللعبة
export async function handleGuessAnimeResponse(sock, jid, sender, text) {
    const game = activeGames[jid];
    if (!game) return false;

    // إذا كانت الحالة interim (انتظار جولة جديدة)، أتجاهل الرسائل
    if (game.state === 'interim') {
        return false; // لا نعتبرها معالجة نهائية للعبة
    }

    if (game.state === 'waiting_for_mode') {
        if (text === '1') {
            // للجميع
            game.participants = null; // null يعني الجميع
            await startActualGame(sock, jid);
        } else if (text === '2') {
            // بين شخصين
            game.state = 'waiting_for_player1';
            await sock.sendMessage(jid, { text: '👤 أرسل اسم اللاعب الأول (اللقب):' });
        } else if (text === '3') {
            // شرح اللعبة
            await showGameExplanation(sock, jid);
            // إعادة عرض القائمة
            delete activeGames[jid];
            await startGuessAnime(sock, jid);
        } else {
            await sock.sendMessage(jid, { text: '❌ اختر 1 أو 2 أو 3 فقط.' });
        }
        return true;
    }

    if (game.state === 'waiting_for_player1') {
        const kingdom = getKingdomIdFromGroupJid(jid);
        const user = await User.findOne({ nickname: { $regex: text.trim(), $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على اللاعب. أعد المحاولة:' });
            return true;
        }
        game.player1 = user.jid;
        game.state = 'waiting_for_player2';
        await sock.sendMessage(jid, { text: '👤 أرسل اسم اللاعب الثاني (اللقب):' });
        return true;
    }

    if (game.state === 'waiting_for_player2') {
        const kingdom = getKingdomIdFromGroupJid(jid);
        const user = await User.findOne({ nickname: { $regex: text.trim(), $options: 'i' }, kingdom_id: kingdom });
        if (!user) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على اللاعب. أعد المحاولة:' });
            return true;
        }
        if (user.jid === game.player1) {
            await sock.sendMessage(jid, { text: '❌ لا يمكن اختيار نفس اللاعب مرتين. أعد المحاولة:' });
            return true;
        }
        game.player2 = user.jid;
        game.participants = [game.player1, game.player2];
        await startActualGame(sock, jid);
        return true;
    }

    // إذا كانت الحالة interim (انتظار جولة جديدة)، أتجاهل الرسائل
    if (game.state === 'interim') {
        return false;
    }

    // إذا كانت لعبة قيد التقدم، أضف الإجابة إلى قائمة الانتظار
    if (!game.answered && game.answerVariants && Array.isArray(game.answerVariants)) {
        // التحقق من المشاركة
        if (game.participants && !game.participants.includes(sender)) {
            return false; // ليس مشاركاً
        }

        // أضف الإجابة إلى قائمة الانتظار
        const shouldProcessQueue = enqueueAnswer('guessAnime', jid, { sender, text });

        // معالجة قائمة الانتظار فقط إذا كانت هذه أول إجابة
        if (shouldProcessQueue) {
            await processAnswerQueue('guessAnime', jid, 
                async (answerSender, answerText) => {
                    const g = activeGames[jid];
                    if (!g || !g.answerVariants) return false;

                    const similarity = stringSimilarity.findBestMatch(
                        answerText.toLowerCase(), 
                        g.answerVariants.map(v => v.toLowerCase())
                    );

                    if (similarity.bestMatch.rating >= 0.8) {
                        // إجابة صحيحة - عيِّن الحالة فوراً لمنع معالجة إضافية
                        g.state = 'interim';
                        g.answered = true;
                        clearTimeout(g.timeout);
                        clearTimeout(g.hintTimeout);

                        // إضافة النقاط والنجوم
                        const kingdom = getKingdomIdFromGroupJid(jid);
                        const user = await User.findOne({ jid: answerSender, kingdom_id: kingdom });
                        if (user) {
                            user.points = (user.points || 0) + 1;

                            await user.save();
                            await sock.sendMessage(jid, {
                                text: `🎉 أحسنت ${user.nickname}!\nالأنمي هو: ${g.answerVariants[0]}\n💰 +1 نقطة`
                            });
                        } else {
                            await sock.sendMessage(jid, {
                                text: `✅ إجابة صحيحة!\nالأنمي هو: ${g.answerVariants[0]}\nلكن لا يمكن احتساب النقاط لأنك غير مسجل.`
                            });
                        }

                        return true; // إجابة صحيحة
                    }

                    return false; // إجابة خاطئة
                },
                async () => {
                    // عند إنهاء الجولة، انتظر 3 ثواني ثم ابدأ جولة جديدة
                    const participants = activeGames[jid]?.participants;
                    activeGames[jid] = { 
                        state: 'interim', 
                        participants
                    };

                    await sock.sendMessage(jid, { text: "⏭️ جولة جديدة قادمة بعد 3 ثواني..." });
                    
                    setTimeout(async () => {
                        if (activeGames[jid] && activeGames[jid].state === 'interim') {
                            await startActualGame(sock, jid);
                        }
                    }, ROUND_DELAY);
                }
            );
        }

        return true;
    }

    return false;
}

// لوحة الترتيب الموحدة لجميع الألعاب
export async function showLeaderboard(sock, jid) {
    const users = await User.find({ kingdom_id: getKingdomIdFromGroupJid(jid) }).sort({ points: -1 }).limit(10);
    if (!users.length) {
        await sock.sendMessage(jid, { text: "لا يوجد لاعبين مسجلين بعد." });
        return;
    }

    let msg = "🏆 لوحة الترتيب الموحدة - أفضل اللاعبين:\n\n";
    users.forEach((u, i) => {
        msg += `${i + 1}. ${u.nickname} - 💰${u.points || 0}\n`;
    });

    await sock.sendMessage(jid, { text: msg });
}

// إيقاف اللعبة
export async function stopGuessAnime(sock, jid) {
    if (activeGames[jid]) {
        clearTimeout(activeGames[jid].timeout);
        clearTimeout(activeGames[jid].hintTimeout);
        clearAnswerQueue('guessAnime', jid);
        delete activeGames[jid];
        await sock.sendMessage(jid, { text: "🛑 تم إيقاف لعبة تخمين الأنمي!" });
    } else {
        await sock.sendMessage(jid, { text: "❌ لا توجد لعبة تخمين أنمي تعمل حالياً!" });
    }
}