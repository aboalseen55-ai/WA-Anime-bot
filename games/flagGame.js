import Country from "../database/countryModel.js";
import User from "../database/userModel.js";
import stringSimilarity from "string-similarity";
import { getKingdomIdFromGroupJid } from "../config.js";
import axios from "axios";
import sharp from "sharp";
import { convertImageToJpeg } from "../utils/imageSearch.js";
import { enqueueAnswer, processAnswerQueue, clearAnswerQueue } from "../utils/answerQueue.js";

export const activeGames = {};
const MAX_TIME = 10000; // 10 ثواني
const HINT_TIME = 2000; // 2 ثانية
const ROUND_DELAY = 3000; // 3 ثواني تأخير بين الجولات

// قوائم الدول حسب التصنيف
const ARAB_COUNTRIES = [
    "الإمارات العربية المتحدة",
    "البحرين",
    "الجزائر",
    "جزر القمر",
    "جيبوتي",
    "مصر",
    "العراق",
    "الأردن",
    "الكويت",
    "لبنان",
    "ليبيا",
    "المغرب",
    "موريتانيا",
    "عمان",
    "فلسطين",
    "قطر",
    "المملكة العربية السعودية",
    "الصومال",
    "السودان",
    "سوريا",
    "تونس",
    "اليمن"
];

const FAMOUS_COUNTRIES = [
    "الولايات المتحدة الأمريكية", "المملكة المتحدة", "فرنسا", "ألمانيا", "إيطاليا",
    "إسبانيا", "اليابان", "جمهورية الصين الشعبية", "الهند", "روسيا", "كندا",
    "أستراليا", "البرازيل", "المكسيك", "الأرجنتين", "كوريا الجنوبية", "إندونيسيا",
    "تركيا", "هولندا", "بلجيكا", "السويد", "النرويج", "الدنمارك", "فنلندا",
    "اليونان", "البرتغال", "سويسرا", "النمسا", "بولندا", "أوكرانيا", "جمهورية التشيك",
    "المجر", "رومانيا", "بلغاريا", "صربيا", "كرواتيا", "سلوفينيا", "سلوفاكيا",
    "البوسنة والهرسك", "ألبانيا", "مقدونيا الشمالية", "كوسوفو", "الجبل الأسود",
    "مولدوفا", "جورجيا", "أرمينيا", "أذربيجان", "كازاخستان", "أوزبكستان", "تركمانستان",
    "قيرغيزستان", "طاجيكستان", "مصر", "المغرب", "تونس", "الجزائر", "السعودية",
    "الإمارات", "الكويت", "قطر", "عمان", "البحرين", "الأردن", "لبنان", "سوريا",
    "العراق", "اليمن", "فلسطين", "إسرائيل", "اليابان", "كوريا الجنوبية", "سنغافورة",
    "ماليزيا", "تايلاند", "فيتنام", "الفلبين", "باكستان", "بنغلاديش", "سريلانكا",
    "نيبال", "بوتان", "أفغانستان", "إيران", "العراق", "السعودية", "الكويت", "البحرين",
    "قطر", "الإمارات", "عمان", "اليمن", "الأردن", "لبنان", "سوريا", "فلسطين",
    "مصر", "ليبيا", "تونس", "الجزائر", "المغرب", "موريتانيا", "تشاد", "النيجر",
    "مالي", "بوركينا فاسو", "غينيا", "سيراليون", "ليبيريا", "ساحل العاج", "غانا",
    "توغو", "بنين", "نيجيريا", "الكاميرون", "أفريقيا الوسطى", "الغابون", "الكونغو",
    "الكونغو الديمقراطية", "أوغندا", "كينيا", "تنزانيا", "زامبيا", "زيمبابوي",
    "موزمبيق", "مدغشقر", "موريشيوس", "ناميبيا", "بوتسوانا", "ليسوتو", "إسواتيني",
    "جنوب أفريقيا", "أنغولا", "زامبيا", "ملاوي", "زيمبابوي", "بوتسوانا", "ناميبيا",
    "أنغولا", "موزمبيق", "مدغشقر", "موريشيوس", "سيشل", "جزر القمر", "الصين",
    "الهند", "إندونيسيا", "باكستان", "بنغلاديش", "اليابان", "الفلبين", "فيتنام",
    "كوريا الجنوبية", "تركيا", "إيران", "تايلاند", "ميانمار", "كوريا الشمالية",
    "أفغانستان", "العراق", "السعودية", "الإمارات", "الكويت", "قطر", "عمان", "البحرين",
    "الأردن", "لبنان", "سوريا", "فلسطين", "مصر", "ليبيا", "تونس", "الجزائر",
    "المغرب", "موريتانيا", "تشاد", "النيجر", "مالي", "بوركينا فاسو", "غينيا",
    "سيراليون", "ليبيريا", "ساحل العاج", "غانا", "توغو", "بنين", "نيجيريا",
    "الكاميرون", "أفريقيا الوسطى", "الغابون", "الكونغو", "الكونغو الديمقراطية",
    "أوغندا", "كينيا", "تنزانيا", "زامبيا", "زيمبابوي", "موزمبيق", "مدغشقر",
    "موريشيوس", "ناميبيا", "بوتسوانا", "ليسوتو", "إسواتيني", "جنوب أفريقيا",
    "أنغولا", "زامبيا", "ملاوي", "زيمبابوي", "بوتسوانا", "ناميبيا", "أنغولا",
    "موزمبيق", "مدغشقر", "موريشيوس", "سيشل", "جزر القمر"
];

// دالة لعرض شرح اللعبة
async function showGameExplanation(sock, jid) {
    const explanation = `
╔════════════════════════════════════╗
║  🚩 شرح لعبة الأعلام                ║
╚════════════════════════════════════╝

*🎮 أهداف اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
خمّن اسم الدولة من صورة علمها وحقق نقاط!

*📋 قواعد اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ ستُعرض عليك صورة علم دولة معينة
✅ اكتب اسم الدولة بالعربية
✅ لديك 10 ثواني فقط ⏱️⚡
✅ بعد 2 ثانية سيظهر تلميح
✅ أول إجابة صحيحة تحسم الجولة

*🎭 أنماط اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**🌍 تصنيف الدول:**
   • الدول العربية: دول الوطن العربي والعالم العربي
   • الدول المعروفة: الدول الأكثر شهرة عالمياً
   • جميع الدول: كل الدول المتاحة في اللعبة

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
👀 انتبه لألوان وتصميم العلم
⚡ كن سريعاً - الوقت محدود!
🎯 حاول التخمين قبل انتهاء الوقت
💰 كل إجابة صحيحة = +2 نقاط

*📊 النقاط:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ إجابة صحيحة = +2 نقاط 🎉
⚡ الإجابة السريعة = جميلة!

جاهز للعب؟ اختر النمط! 🚀`;

    await sock.sendMessage(jid, { text: explanation });
}

// التحقق من الإجابة
export async function checkGuess(sock, jid, sender, text) {
    const game = activeGames[jid];
    if (!game) return;

    // إذا كانت الحالة interim (انتظار جولة جديدة)، أتجاهل الرسائل
    if (game.state === 'interim') {
        return;
    }

    // إذا تم الإجابة على هذه الجولة بالفعل، تجاهل أي إجابات إضافية
    if (game.answered) {
        return;
    }

    // التحقق من وجود answerVariants
    if (!game.answerVariants || !Array.isArray(game.answerVariants)) {
        return; // اللعبة غير جاهزة بعد
    }

    // التحقق من المشاركين المسموح لهم
    if (game.mode === 'duo' && game.players) {
        const kingdom = getKingdomIdFromGroupJid(jid);
        const userByJid = await User.findOne({ jid: sender, kingdom_id: kingdom });
        const playerNickname = userByJid?.nickname || sender.split("@")[0];

        if (!game.players.includes(playerNickname)) {
            return; // ليس من اللاعبين المسموح لهم
        }
    }

    // أضف الإجابة إلى قائمة الانتظار
    const shouldProcessQueue = enqueueAnswer('flagGame', jid, { sender, text });

    // معالجة قائمة الانتظار فقط إذا كانت هذه أول إجابة
    if (shouldProcessQueue) {
        await processAnswerQueue('flagGame', jid,
        async (answerSender, answerText) => {
            const g = activeGames[jid];
            if (!g || !g.answerVariants) return false;

            const guess = answerText.toLowerCase().trim();

            // fuzzy match: إذا التشابه > 0.75 يعتبر صحيح
            const match = g.answerVariants.some(a =>
                stringSimilarity.compareTwoStrings(a.toLowerCase(), guess) > 0.75
            );

            if (match) {
                    // إجابة صحيحة - عيِّن الحالة فوراً لمنع معالجة إضافية
                    g.state = 'interim';
                    g.answered = true;

                const kingdom = getKingdomIdFromGroupJid(jid);
                const userByJid = await User.findOne({ jid: answerSender, kingdom_id: kingdom });

                if (!userByJid) {
                    await sock.sendMessage(jid, {
                        text: `✅ إجابة صحيحة!\nالدولة: ${g.answerVariants[0]}\nلكن لا يمكن احتساب النقاط لأنك غير مسجل.`
                    });
                } else {
                    const user = await User.findOne({ nickname: userByJid.nickname, kingdom_id: kingdom });
                    user.points = (user.points || 0) + 2; // نقطتين
                    await user.save();
                    await sock.sendMessage(jid, {
                        text: `✅ إجابة صحيحة!\nالدولة: ${g.answerVariants[0]}\n+2 نقاط\nمجموع نقاطك: 💰${user.points}`
                    });
                }

                return true; // إجابة صحيحة
            }

            return false; // إجابة خاطئة
        },
        async () => {
            // عند إنهاء الجولة، انتظر 3 ثواني ثم ابدأ جولة جديدة
            const g = activeGames[jid];
            if (!g) return;

            clearTimeout(g.timeout);
            clearTimeout(g.hintTimeout);

            const participants = g.participants;
            const mode = g.mode;
            const players = g.players;

            activeGames[jid] = {
                state: 'interim',
                participants,
                mode,
                players,
                category: g.category
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
}

// بدء اللعبة
export async function startFlagGame(sock, jid) {
    if (activeGames[jid]) {
        await sock.sendMessage(jid, { text: "🎮 هناك لعبة تعمل حالياً!" });
        return;
    }

    // إرسال خيارات تصنيف الدول
    await sock.sendMessage(jid, {
        text: `🚩 اختر تصنيف الدول للعبة الأعلام:\n\n🌍 1️⃣ الدول العربية فقط\n⭐ 2️⃣ الدول المعروفة فقط\n🌐 3️⃣ جميع دول العالم\n\n📚 4️⃣ شرح اللعبة\n\nأرسل الرقم المطلوب.\n📌 لإيقاف اللعبة في أي وقت استخدم الأمر /وقف` }
    );

    // انتظار الرد
    activeGames[jid] = {
        state: 'waiting_for_category',
        participants: null
    };
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

    // اختيار دولة عشوائية من DB حسب التصنيف المختار
    let query = { flagUrl: { $exists: true, $ne: "" } };
    
    if (game.category === 'arab') {
        query.arabicName = { $in: ARAB_COUNTRIES };
    } else if (game.category === 'famous') {
        query.arabicName = { $in: FAMOUS_COUNTRIES };
    }
    // إذا كان 'all' فلا نحتاج لإضافة شرط إضافي

    const count = await Country.countDocuments(query);
    if (!count) {
        const categoryName = game.category === 'arab' ? 'العربية' : game.category === 'famous' ? 'المعروفة' : 'جميع';
        await sock.sendMessage(jid, { text: `❌ لا توجد أعلام متاحة للدول ${categoryName} في قاعدة البيانات.` });
        delete activeGames[jid];
        return;
    }

    const rand = Math.floor(Math.random() * count);
    const country = await Country.findOne(query).skip(rand);

    if (!country || !country.flagUrl) {
        await sock.sendMessage(jid, { text: "❌ فشل اختيار دولة" });
        delete activeGames[jid];
        return;
    }

    // إعداد الإجابات (الاسم العربي والمرادفات)
    const answerVariants = [country.arabicName];
    
    // إضافة المرادفات إذا كانت موجودة
    if (country.aliases && Array.isArray(country.aliases)) {
        answerVariants.push(...country.aliases);
    }

    // تحديث activeGames
    activeGames[jid] = {
        answerVariants,
        countryArabicName: country.arabicName,
        countryEnglishName: country.englishName,
        startTime: Date.now(),
        hintSent: false,
        timeout: null,
        hintTimeout: null,
        answered: false,
        participants: game.participants,
        mode: game.mode || 'all',
        category: game.category || 'all'
    };

    // إرسال الرسالة الأولية مع الصورة
    try {
        // محاولة تحويل الصورة إلى JPEG أولاً
        const jpegBuffer = await convertImageToJpeg(country.flagUrl);
        if (jpegBuffer) {
            await sock.sendMessage(jid, {
                image: jpegBuffer,
                caption: `🚩 لعبة الأعلام\n⏱ لديك 10 ثواني\n💡 سيظهر تلميح بعد 2 ثانية`
            });
        } else {
            // إذا فشل التحويل، حاول إرسال الصورة من الرابط مباشرة
            await sock.sendMessage(jid, {
                image: { url: country.flagUrl },
                caption: `🚩 لعبة الأعلام\n⏱ لديك 10 ثواني\n💡 سيظهر تلميح بعد 2 ثانية`
            });
        }
    } catch (imageError) {
        // إذا فشل إرسال الصورة من الرابط، حاول تحميل الصورة أولاً
        try {
            console.log(`⚠️  محاولة تحميل الصورة: ${country.arabicName}`);
            const imageResponse = await axios.get(country.flagUrl, {
                responseType: 'arraybuffer',
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            });
            
            // حاول تحويلها إلى JPEG
            const jpegBuffer = await sharp(imageResponse.data)
                .jpeg({ quality: 85 })
                .toBuffer();
            
            await sock.sendMessage(jid, {
                image: jpegBuffer,
                caption: `🚩 لعبة الأعلام\n⏱ لديك 10 ثواني\n💡 سيظهر تلميح بعد 2 ثانية`
            });
            console.log(`✅ تم إرسال صورة: ${country.arabicName}`);
        } catch (downloadError) {
            // إذا فشل تحميل الصورة أيضاً، أرسل رسالة نصية فقط
            console.log(`❌ فشل إرسال صورة ${country.arabicName}:`, downloadError.message);
            await sock.sendMessage(jid, {
                text: `🚩 لعبة الأعلام - ${country.englishName}\n⏱ لديك 10 ثواني\n💡 سيظهر تلميح بعد 2 ثانية\n\n(لم تتمكن من تحميل صورة العلم من الإنترنت)`
            });
        }
    }

    // تلميح بعد 2 ثانية (أول وآخر حرف)
    if (activeGames[jid]) {
        activeGames[jid].hintTimeout = setTimeout(async () => {
            const game = activeGames[jid];
            if (game && !game.hintSent) {
                game.hintSent = true;
                const countryName = country.arabicName;
                const firstChar = countryName[0];
                const lastChar = countryName[countryName.length - 1];
                const hint = `${firstChar}${'.'.repeat(countryName.length - 2)}${lastChar}`;
                
                await sock.sendMessage(jid, {
                    text: `💡 تلميح: ${hint}`
                });
            }
        }, HINT_TIME);
    }

    // انتهاء الوقت بعد 10 ثواني
    if (activeGames[jid]) {
        activeGames[jid].timeout = setTimeout(async () => {
            const game = activeGames[jid];
            if (game && !game.answered) {
                await sock.sendMessage(jid, {
                    text: `⏱ انتهى الوقت!\nالدولة هي: ${country.arabicName}`
                });
                clearTimeout(game.hintTimeout);

                // إخطار بالجولة القادمة
                await sock.sendMessage(jid, { text: "⏭️ جولة جديدة قادمة بعد 3 ثواني..." });
                
                // حفظ إعدادات اللعبة قبل إعادة التعيين
                const participants = game.participants;
                const mode = game.mode || 'all';
                const players = game.players;
                
                // تعيين الحالة إلى "interim" لمنع التداخل
                activeGames[jid] = { 
                    state: 'interim', 
                    participants, 
                    mode,
                    players
                };
                
                setTimeout(async () => {
                    // التحقق من أن الحالة لا تزال "interim"
                    if (activeGames[jid] && activeGames[jid].state === 'interim') {
                        await startActualGame(sock, jid);
                    }
                }, ROUND_DELAY); // تأخير 3 ثواني
            }
        }, MAX_TIME);
    }
}

// معالجة ردود اللعبة
export async function handleFlagGameResponse(sock, jid, sender, text) {
    const game = activeGames[jid];
    if (!game) return false;

    // إذا كانت الحالة interim (انتظار جولة جديدة)، أتجاهل الرسائل
    if (game.state === 'interim') {
        return false; // لا نعتبرها معالجة نهائية للعبة
    }

    if (game.state === 'waiting_for_category') {
        if (text === '1') {
            // الدول العربية
            game.category = 'arab';
            game.state = 'waiting_for_mode';
            await sock.sendMessage(jid, {
                text: `🚩 اختر نوع لعبة الأعلام (الدول العربية):\n\n1️⃣ للجميع في المجموعة\n2️⃣ بين شخصين محددين\n3️⃣ شرح اللعبة\n\nأرسل الرقم المطلوب.` }
            );
        } else if (text === '2') {
            // الدول المعروفة
            game.category = 'famous';
            game.state = 'waiting_for_mode';
            await sock.sendMessage(jid, {
                text: `🚩 اختر نوع لعبة الأعلام (الدول المعروفة):\n\n1️⃣ للجميع في المجموعة\n2️⃣ بين شخصين محددين\n3️⃣ شرح اللعبة\n\nأرسل الرقم المطلوب.` }
            );
        } else if (text === '3') {
            // جميع الدول
            game.category = 'all';
            game.state = 'waiting_for_mode';
            await sock.sendMessage(jid, {
                text: `🚩 اختر نوع لعبة الأعلام (جميع الدول):\n\n1️⃣ للجميع في المجموعة\n2️⃣ بين شخصين محددين\n3️⃣ شرح اللعبة\n\nأرسل الرقم المطلوب.` }
            );
        } else if (text === '4') {
            // شرح اللعبة
            await showGameExplanation(sock, jid);
            // إعادة عرض القائمة
            delete activeGames[jid];
            await startFlagGame(sock, jid);
        } else {
            await sock.sendMessage(jid, { text: '❌ اختر 1 أو 2 أو 3 أو 4 فقط.' });
        }
        return true;
    }

    if (game.state === 'waiting_for_mode') {
        if (text === '1') {
            // للجميع
            game.participants = null; // null يعني الجميع
            game.mode = 'all';
            await startActualGame(sock, jid);
        } else if (text === '2') {
            // بين شخصين
            game.state = 'waiting_for_player1';
            game.mode = 'duo';
            await sock.sendMessage(jid, { text: '👤 أرسل اسم اللاعب الأول (اللقب):' });
        } else if (text === '3') {
            // شرح اللعبة
            await showGameExplanation(sock, jid);
            // إعادة عرض القائمة
            delete activeGames[jid];
            await startFlagGame(sock, jid);
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
        game.player1Name = user.nickname;
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
        game.player2Name = user.nickname;
        game.players = [game.player1Name, game.player2Name];
        game.state = undefined; // تنظيف الحالة
        await startActualGame(sock, jid);
        return true;
    }

    // التحقق من الإجابة (في جميع الحالات)
    if (game.answered) return false;

    // التحقق من وجود answerVariants
    if (!game.answerVariants || !Array.isArray(game.answerVariants)) {
        return false; // اللعبة غير جاهزة بعد
    }

    // معالجة الإجابة
    await checkGuess(sock, jid, sender, text);

    return true;
}
