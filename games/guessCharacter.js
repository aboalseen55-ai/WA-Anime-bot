import User from "../database/userModel.js";
import stringSimilarity from "string-similarity";
import { getKingdomIdFromGroupJid } from "../config.js";
import { enqueueAnswer, processAnswerQueue, clearAnswerQueue } from "../utils/answerQueue.js";
import { getCleanMentionTextForUser } from "../commands/adminSystem.js";
import { awardGameXp } from "../utils/xpSystem.js";

export const activeCharacterGames = {};
const MAX_TIME = 20000; // 20 ثانية
const HINT_TIME = 10000; // 10 ثواني
const ROUND_DELAY = 3000; // 3 ثواني تأخير بين الجولات

// متغيرات لإدارة حالة الانتظار لاختيار الوضع
export const characterGameWaiting = {};

// قاعدة بيانات الشخصيات الشهيرة
const CHARACTERS_DB = [
    {
        name: "ناروتو أوزوماكي",
        englishName: "Naruto Uzumaki",
        anime: "ناروتو",
        description: "فتى أشقر مرح يحلم بأن يصبح هوكاجي قرية الورق المخفية. يتميز بطاقته الخارقة وشخصيته الإيجابية الدائمة.",
        hints: ["يحب الرامين", "علامة على وجهه", "ذيل الثعلب التسعة"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/2/284121.jpg"
    },
    {
        name: "ساسكي أوتشيها",
        englishName: "Sasuke Uchiha",
        anime: "ناروتو",
        description: "فتى أسود الشعر ينتمي لعشيرة أوتشيها. يسعى للانتقام من شقيقه الأكبر ويتميز بمهاراته في النينجا.",
        hints: ["عشيرة أوتشيها", "علامة المشاركة على جبهته", "يسعى للانتقام"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/7/284129.jpg"
    },
    {
        name: "إدوارد إلريك",
        englishName: "Edward Elric",
        anime: "فول ميتال ألكيميست",
        description: "ألكيميست شاب ذو شعر أشقر يرتدي معطف أحمر. فقد ذراعه وساقه في محاولة لإحياء والدته.",
        hints: ["ألكيميست", "شعر أشقر", "يبحث عن حجر الفلاسفة"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/9/72533.jpg"
    },
    {
        name: "ألفونس إلريك",
        englishName: "Alphonse Elric",
        anime: "فول ميتال ألكيميست",
        description: "شقيق إدوارد الأصغر الذي يعيش داخل درع مدرع. يتميز بقوته الجسدية وشخصيته الطيبة.",
        hints: ["يعيش في درع", "شقيق إدوارد", "روح في جسد معدني"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/5/72827.jpg"
    },
    {
        name: "مونوكي كيدا",
        englishName: "Monkey D. Luffy",
        anime: "ون بيس",
        description: "قبطان قراصنة قبعة القش يحلم بأن يصبح ملك القراصنة. يتميز بقوته المطاطية وقدرته على التمدد.",
        hints: ["قبعة القش", "قوة المطاط", "يبحث عن الكنوز"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/9/310307.jpg"
    },
    {
        name: "رورونوا زورو",
        englishName: "Roronoa Zoro",
        anime: "ون بيس",
        description: "سياف ماهر يستخدم ثلاث سيوف في نفس الوقت. يهدف لأن يصبح أقوى سياف في العالم.",
        hints: ["ثلاث سيوف", "أخضر الشعر", "يضيع دائماً"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/3/122943.jpg"
    },
    {
        name: "إيتشيغو كوروساكي",
        englishName: "Ichigo Kurosaki",
        anime: "بليتش",
        description: "فتى أسود الشعر يعمل كشينيغامي بديل. يحمي العالم من الأرواح الشريرة بسيفه.",
        hints: ["شينيغامي", "شعر برتقالي", "يحمي من الهولو"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/7/83880.jpg"
    },
    {
        name: "غوكو",
        englishName: "Goku",
        anime: "دراغون بول",
        description: "محارب قوي يحب القتال والتدريب. يأكل دائماً ويتميز بقوته الهائلة وشخصيته البسيطة.",
        hints: ["يحب القتال", "ذيل قرد", "يأكل كثيراً"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/2/268727.jpg"
    },
    {
        name: "فيجيتا",
        englishName: "Vegeta",
        anime: "دراغون بول",
        description: "أمير السايان المتغطرس الذي يسعى دائماً لتجاوز غوكو. يتميز بقوته وكبريائه.",
        hints: ["أمير السايان", "أزرق الشعر", "منافس غوكو"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/6/95011.jpg"
    },
    {
        name: "تانجيرو كامادو",
        englishName: "Tanjiro Kamado",
        anime: "قاتل الشياطين",
        description: "فتى يرتدي قبعة من الخيزران يعمل كقاتل شياطين. يحمي أخته المصابة بمرض غامض.",
        hints: ["قبعة خيزران", "يشم الروائح", "يحمي أخته"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/12/503795.jpg"
    },
    {
        name: "نيزوكو كامادو",
        englishName: "Nezuko Kamado",
        anime: "قاتل الشياطين",
        description: "أخت تانجيرو التي تحولت إلى شيطان لكنها تحافظ على بشريتها. تعيش في صندوق ظهر أخيها.",
        hints: ["تعيش في صندوق", "شيطان لطيف", "أخت تانجيرو"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/10/503797.jpg"
    },
    {
        name: "ليفاي أكرمان",
        englishName: "Levi Ackerman",
        anime: "هجوم العمالقة",
        description: "أقوى جندي في فيلق الاستطلاع. يتميز بمهاراته القتالية العالية وشخصيته الجادة.",
        hints: ["أقوى الجنود", "يحب النظافة", "قصير القامة"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/10/249225.jpg"
    },
    {
        name: "إرين ييغر",
        englishName: "Eren Yeager",
        anime: "هجوم العمالقة",
        description: "فتى يريد قتل جميع العمالقة بعد أن دمروا مدينته. يتميز بقوته وإصراره.",
        hints: ["يكره العمالقة", "يحمل سراً", "صديق ميكاسا"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/15/249235.jpg"
    },
    {
        name: "ميكاسا أكرمان",
        englishName: "Mikasa Ackerman",
        anime: "هجوم العمالقة",
        description: "فتاة قوية تحمي إرين دائماً. تتميز بمهاراتها القتالية وولائها لصديقها.",
        hints: ["تحمي إرين", "منديل أحمر", "أقوى الجنود"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/9/249227.jpg"
    },
    {
        name: "كانيكي كين",
        englishName: "Kaneki Ken",
        anime: "طوكيو غول",
        description: "فتى تحول إلى غول بعد زرع أعضاء غول في جسده. يعاني من صراع بين بشريته ووحشيته.",
        hints: ["غول أسود", "قناع أفعى", "يحب الكتب"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/4/261429.jpg"
    },
    {
        name: "توتورو",
        englishName: "Totoro",
        anime: "قريبي توتورو",
        description: "روح غابة كبيرة وودية تشبه الدب. يساعد الأطفال ويحب المطر والأمطار.",
        hints: ["روح غابة", "أبيض كبير", "يحب المطر"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/13/151811.jpg"
    },
    {
        name: "أش كاش",
        englishName: "Ash Ketchum",
        anime: "بوكيمون",
        description: "مدرب بوكيمون شاب يسافر حول العالم ليصبح أفضل مدرب. يرافقه صديقه البيكاتشو.",
        hints: ["مدرب بوكيمون", "قبعة حمراء", "صديق البيكاتشو"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/6/350239.jpg"
    },
    {
        name: "سانجي",
        englishName: "Sanji",
        anime: "ون بيس",
        description: "طباخ السفينة الذي يحترم النساء كثيراً. يتميز بسرعته في الركل ومهاراته في الطبخ.",
        hints: ["طباخ ماهر", "يحترم النساء", "يركل بسرعة"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/1/122951.jpg"
    },
    {
        name: "نايمور",
        englishName: "Nami",
        anime: "ون بيس",
        description: "ملاحة السفينة ورسامة الخرائط الماهرة. تتميز بذكائها وحبها للمال.",
        hints: ["رسامة خرائط", "تحب المال", "ملاحة ماهرة"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/6/122953.jpg"
    },
    {
        name: "روبين نيكو",
        englishName: "Nico Robin",
        anime: "ون بيس",
        description: "أثريولوجية السفينة التي تبحث عن تاريخ العالم. تتميز بذكائها وهدوئها.",
        hints: ["أثريولوجية", "تبحث عن التاريخ", "هادئة وذكية"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/4/122955.jpg"
    },
    {
        name: "كاكاشي هاتاكي",
        englishName: "Kakashi Hatake",
        anime: "ناروتو",
        description: "معلم ناروتو وساسكي المشهور بقراءة كتبه الإباحية. يتميز بمشاركته الشهيرة.",
        hints: ["معلم ناروتو", "يحب الكتب الإباحية", "مشاركة على وجهه"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/7/284127.jpg"
    },
    {
        name: "هيناتا هيوغا",
        englishName: "Hinata Hyuga",
        anime: "ناروتو",
        description: "زوجة ناروتو الخجولة والقوية. تتميز بعيونها البيضاء الخاصة وعشيرة هيوغا.",
        hints: ["زوجة ناروتو", "خجولة جداً", "عيون بيضاء"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/6/284125.jpg"
    },
    {
        name: "ليغواي",
        englishName: "Light Yagami",
        anime: "ديث نوت",
        description: "طالب عبقري يجد دفتر الموت ويصبح قاتل متسلسل. يسعى لخلق عالم مثالي.",
        hints: ["يجد دفتر الموت", "طالب عبقري", "يسعى لعالم مثالي"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/6/45967.jpg"
    },
    {
        name: "إل لويت",
        englishName: "L Lawliet",
        anime: "ديث نوت",
        description: "محقق عبقري يطارد حامل دفتر الموت. يتميز بذكائه الفائق وعاداته الغريبة.",
        hints: ["محقق عبقري", "يطارد حامل الدفتر", "عادات غريبة"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/5/45969.jpg"
    },
    {
        name: "إيزوكو ميدوريا",
        englishName: "Izuku Midoriya",
        anime: "ماي هيرو أكاديميا",
        description: "فتى يريد أن يصبح بطل خارق رغم عدم وجود قوة لديه. يتميز بذكائه وإصراره.",
        hints: ["يريد أن يصبح بطل", "بدون قوة خارقة", "ذكي ومثابر"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/11/285391.jpg"
    },
    {
        name: "كاتسوكي باكوغو",
        englishName: "Katsuki Bakugo",
        anime: "ماي هيرو أكاديميا",
        description: "صديق إيزوكو المغرور والقوي. يتميز بانفجاراته وشخصيته المتفجرة.",
        hints: ["مغرور جداً", "انفجارات قوية", "صديق إيزوكو"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/10/285393.jpg"
    },
    {
        name: "كيريتو",
        englishName: "Kirito",
        anime: "سورد آرت أونلاين",
        description: "لاعب عبقري في ألعاب الفيديو يصبح محاصر في عالم افتراضي. يتميز بمهاراته القتالية.",
        hints: ["لاعب عبقري", "محاصر في لعبة", "سياف ماهر"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/7/206851.jpg"
    },
    {
        name: "أسونا يوكي",
        englishName: "Asuna Yuuki",
        anime: "سورد آرت أونلاين",
        description: "صديقة كيريتو في العالم الافتراضي. تتميز بسرعتها ومهاراتها في القتال.",
        hints: ["صديقة كيريتو", "سريعة جداً", "ماهرة في القتال"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/5/206853.jpg"
    },
    {
        name: "يوجي إيتادوري",
        englishName: "Yuji Itadori",
        anime: "جوجوتسو كايسن",
        description: "طالب مدرسي يأكل إصبع سكونن ويصبح حامل للشيطان الأقوى. يتميز بقوته الجسدية.",
        hints: ["يأكل إصبع سكونن", "طالب مدرسي", "قوي جسدياً"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/13/459661.jpg"
    },
    {
        name: "ميغومي فوشيغورو",
        englishName: "Megumi Fushiguro",
        anime: "جوجوتسو كايسن",
        description: "زميل يوجي الذي يستدعي الشياطين باستخدام دمه. يتميز بجديته ومهاراته السحرية.",
        hints: ["يستدعي الشياطين", "جدي وهادئ", "زميل يوجي"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/15/459663.jpg"
    },
    {
        name: "دينجي",
        englishName: "Denji",
        anime: "تشينسو مان",
        description: "فتى فقير يتحول جسده إلى هجين مع منشار كهربائي. يحلم بأن يصبح غني.",
        hints: ["منشار كهربائي", "فقير جداً", "يحلم بالثراء"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/10/477429.jpg"
    },
    {
        name: "بوwer",
        englishName: "Power",
        anime: "تشينسو مان",
        description: "شيطان الدم الذي يعمل كمساعد لدينجي. تتميز بغبائها وحبها للقطط.",
        hints: ["شيطان الدم", "تحب القطط", "غبية جداً"],
        imageUrl: "https://cdn.myanimelist.net/images/characters/12/477431.jpg"
    }
];

// بدء اللعبة
export async function startGuessCharacter(sock, jid, sender) {
    if (activeCharacterGames[jid]) {
        await sock.sendMessage(jid, { text: "🎮 هناك لعبة تعمل حالياً!" });
        return;
    }

    // التحقق من صلاحية المرسل (مشرف أو مالك)
    const isAdmin = await checkAdmin(sock, jid, sender);
    if (!isAdmin) {
        await sock.sendMessage(jid, { text: "❌ هذا الأمر متاح للمشرفين فقط!" });
        return;
    }

    // إرسال رسالة اختيار الوضع
    await sock.sendMessage(jid, {
        text: `🎭 لعبة تخمين الشخصيات\n\nاختر وضع اللعبة:\n1️⃣ لجميع الأعضاء\n2️⃣ لشخصين محددين\n3️⃣ شرح اللعبة\n\nأرسل الرقم المطلوب\n📌 لإيقاف اللعبة في أي وقت، استخدم /وقف`
    });

    // وضع حالة الانتظار
    characterGameWaiting[jid] = {
        sender: sender,
        timeout: setTimeout(async () => {
            await sock.sendMessage(jid, { text: "⏱ انتهى وقت الاختيار!" });
            delete characterGameWaiting[jid];
        }, 30000) // 30 ثانية للاختيار
    };
}

// دالة التعامل مع ردود اختيار الوضع
export async function handleGuessCharacterResponse(sock, jid, sender, text) {
    const waiting = characterGameWaiting[jid];
    if (!waiting || waiting.sender !== sender) return;

    // التحقق من الصلاحيات
    const { getKingdomIdFromGroupJid } = await import('../config.js');
    const { isModerator } = await import('../commands/adminSystem.js');
    const kingdom = getKingdomIdFromGroupJid(jid);
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
        clearTimeout(waiting.timeout);
        delete characterGameWaiting[jid];
        await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمن يمكنهم بدء الألعاب!' });
        return;
    }

    clearTimeout(waiting.timeout);
    delete characterGameWaiting[jid];

    const choice = text.trim();

    if (choice === '1') {
        // وضع جميع الأعضاء
        await startActualCharacterGame(sock, jid, null);
    } else if (choice === '2') {
        // وضع شخصين محددين
        await sock.sendMessage(jid, {
            text: `👥 وضع لشخصين محددين\n\nأرسل اسم اللاعب الأول (اللقب):`
        });

        characterGameWaiting[jid] = {
            sender: sender,
            mode: 'two_players',
            timeout: setTimeout(async () => {
                await sock.sendMessage(jid, { text: "⏱ انتهى وقت اختيار المشاركين!" });
                delete characterGameWaiting[jid];
            }, 30000)
        };
    } else if (choice === '3') {
        // شرح اللعبة
        await showCharacterGameExplanation(sock, jid);
        // إعادة عرض القائمة
        delete characterGameWaiting[jid];
        await startGuessCharacter(sock, jid, sender);
    } else {
        await sock.sendMessage(jid, { text: "❌ اختيار غير صحيح! أرسل 1 أو 2 أو 3 فقط." });
    }
}

// دالة التعامل مع اختيار المشاركين للوضع الثنائي
export async function handleCharacterPlayersSelection(sock, jid, sender, text) {
    const waiting = characterGameWaiting[jid];
    if (!waiting || waiting.sender !== sender || waiting.mode !== 'two_players') return;

    // التحقق من الصلاحيات
    const { getKingdomIdFromGroupJid } = await import('../config.js');
    const { isModerator } = await import('../commands/adminSystem.js');
    const kingdom = getKingdomIdFromGroupJid(jid);
    const userIsModerator = await isModerator(sender, kingdom);
    if (!userIsModerator) {
        clearTimeout(waiting.timeout);
        delete characterGameWaiting[jid];
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
        delete characterGameWaiting[jid];
        await startActualCharacterGame(sock, jid, players);
    }
}

// دالة لعرض شرح لعبة تخمين الشخصيات
async function showCharacterGameExplanation(sock, jid) {
    const explanation = `
╔════════════════════════════════════╗
║  🎭 شرح لعبة تخمين الشخصيات         ║
╚════════════════════════════════════╝

*🎮 أهداف اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
خمّن الشخصية من الوصف والتلميحات والصورة!

*📋 قواعد اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ تعرض عليك صورة ووصف لشخصية من الأنمي
✅ اكتب اسم الشخصية بطريقة تقريبية
✅ لديك 20 ثانية للإجابة
✅ بعد 10 ثواني سيظهر تلميح إضافي
✅ التطابق التقريبي بنسبة عالية
✅ كل إجابة صحيحة = +10 نقاط

*🎭 أنماط اللعبة:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1️⃣ النمط الجماعي**
   • جميع الأعضاء يحاولون الإجابة
   • أول إجابة صحيحة تفوز بالنقاط
   • أجواء مشوقة ومنافسة حادة

**2️⃣ النمط الثنائي**
   • منافسة بين لاعبين محددين
   • سريعة ومركزة جداً
   • من يكون الأسرع يفوز

*💡 نصائح للفوز:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ اقرأ الوصف بعناية
✅ اركز على التفاصيل المميزة
⚡ كن سريعاً - الوقت محدود
🎯 استخدم التلميحات بحكمة
🏆 كل شخصية مختلفة = فرصة جديدة

جاهز للعب؟ اختر النمط! 🚀`;

    await sock.sendMessage(jid, { text: explanation });
}

// دالة بدء اللعبة الفعلية
async function startActualCharacterGame(sock, jid, players) {
    // حذف state interim والتأكد من بدء جولة جديدة
    const existingGame = activeCharacterGames[jid];
    if (existingGame && existingGame.state === 'interim') {
        delete existingGame.state;
        delete existingGame.startingNewRound;
    }

    // اختيار شخصية عشوائية
    const character = CHARACTERS_DB[Math.floor(Math.random() * CHARACTERS_DB.length)];

    activeCharacterGames[jid] = {
        character,
        players: players, // null للجميع، أو مصفوفة لشخصين محددين
        answerVariants: [
            character.name,
            character.englishName,
            // إضافة اختصارات شائعة
            ...generateCharacterShortcuts(character.name)
        ],
        startTime: Date.now(),
        hintSent: false,
        timeout: null,
        hintTimeout: null,
        answered: false,
        usedHints: [] // تتبع التلميحات المستخدمة
    };

    // إرسال الرسالة الأولية مع الوصف
    // استخدام نفس منطق /منشن - الحصول على المنشن المحفوظ أو استخدام الرقم
    const playerText = players ? `\n👥 المشاركون: ${players.map(p => getCleanMentionTextForUser(p)).join(' و ')}` : '\n👥 جميع الأعضاء مدعوون للمشاركة';
    const messageOptions = {
        text: `🎭 لعبة تخمين الشخصيات${playerText}\n⏱ لديك 20 ثانية\n💡 سيظهر تلميح بعد 10 ثواني\n\n📝 الوصف: ${character.description}\n📌 أرسل /وقف لإيقاف اللعبة`
    };
    if (players) {
        messageOptions.mentions = players.map(p => p.jid);
    }
    await sock.sendMessage(jid, messageOptions);

    // تلميح بعد 10 ثواني
    activeCharacterGames[jid].hintTimeout = setTimeout(async () => {
        const game = activeCharacterGames[jid];
        if (game && !game.hintSent) {
            game.hintSent = true;
            const randomHint = character.hints[Math.floor(Math.random() * character.hints.length)];
            game.usedHints.push(randomHint);
            await sock.sendMessage(jid, {
                text: `💡 تلميح: ${randomHint}`
            });
        }
    }, 5000); // 5 ثواني للتلميح الأول

    // تلميح إضافي بعد 15 ثانية
    setTimeout(async () => {
        const game = activeCharacterGames[jid];
        if (game && !game.answered) {
            const remainingHints = character.hints.filter(h => !Array.isArray(game.usedHints) || !game.usedHints.includes(h));
            if (remainingHints.length > 0) {
                const randomHint = remainingHints[Math.floor(Math.random() * remainingHints.length)];
                if (!Array.isArray(game.usedHints)) game.usedHints = [];
                game.usedHints.push(randomHint);
                await sock.sendMessage(jid, {
                    text: `💡 تلميح إضافي: ${randomHint}`
                });
            }
        }
    }, 10000); // 10 ثواني للتلميح الثاني

    // انتهاء الوقت بعد 20 ثانية
    activeCharacterGames[jid].timeout = setTimeout(async () => {
        const game = activeCharacterGames[jid];
        if (game && !game.answered) {
            await sock.sendMessage(jid, {
                text: `⏱ انتهى الوقت!\nالإجابة الصحيحة: ${character.name}\nمن أنمي: ${character.anime}`
            });
            clearTimeout(game.hintTimeout);
            // إخطار بالجولة القادمة
            await sock.sendMessage(jid, { text: "⏭️ جولة جديدة قادمة بعد 3 ثواني..." });
            
            const participants = game.players;
            
            // تعيين الحالة إلى "interim" لمنع التداخل
            activeCharacterGames[jid] = { 
                state: 'interim',
                players: participants
            };
            
            setTimeout(async () => {
                // التحقق من أن الحالة لا تزال "interim"
                if (activeCharacterGames[jid] && activeCharacterGames[jid].state === 'interim') {
                    await startActualCharacterGame(sock, jid, participants);
                }
            }, ROUND_DELAY);
        }
    }, MAX_TIME);
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

// دالة لتوليد اختصارات للشخصيات
function generateCharacterShortcuts(name) {
    const shortcuts = [];
    const parts = name.split(' ');

    // اختصار الأسماء الشائعة
    if (name.includes('ناروتو')) shortcuts.push('ناروتو');
    if (name.includes('ساسكي')) shortcuts.push('ساسكي');
    if (name.includes('إدوارد')) shortcuts.push('إد', 'إدوارد');
    if (name.includes('ألفونس')) shortcuts.push('أل', 'ألفونس');
    if (name.includes('مونوكي')) shortcuts.push('لوتشيا', 'لوفي', 'مونكي');
    if (name.includes('رورونوا')) shortcuts.push('زورو');
    if (name.includes('إيتشيغو')) shortcuts.push('إيتشيغو', 'ايتشيغو');
    if (name.includes('تانجيرو')) shortcuts.push('تانجيرو');
    if (name.includes('نيزوكو')) shortcuts.push('نيزوكو');
    if (name.includes('ليفاي')) shortcuts.push('ليفاي');
    if (name.includes('إرين')) shortcuts.push('إرين');
    if (name.includes('ميكاسا')) shortcuts.push('ميكاسا');
    if (name.includes('كانيكي')) shortcuts.push('كانيكي');
    if (name.includes('توتورو')) shortcuts.push('توتورو');
    if (name.includes('أش')) shortcuts.push('أش');
    if (name.includes('غوكو')) shortcuts.push('غوكو', 'سون غوكو');
    if (name.includes('فيجيتا')) shortcuts.push('فيجيتا', 'فيجيتاه');
    if (name.includes('نايمور')) shortcuts.push('نايمي', 'نيمي');
    if (name.includes('روبين')) shortcuts.push('روبين', 'نيكو روبين');
    if (name.includes('كاكاشي')) shortcuts.push('كاكاشي');
    if (name.includes('هيناتا')) shortcuts.push('هيناتا');
    if (name.includes('ليغواي')) shortcuts.push('لايت', 'ليغواي');
    if (name.includes('إل')) shortcuts.push('إل', 'إل لويت');
    if (name.includes('إيزوكو')) shortcuts.push('ديكو', 'إيزوكو', 'ميدوريا');
    if (name.includes('كاتسوكي')) shortcuts.push('باكوغو', 'كاتسوكي');
    if (name.includes('كيريتو')) shortcuts.push('كيريتو');
    if (name.includes('أسونا')) shortcuts.push('أسونا');
    if (name.includes('يوجي')) shortcuts.push('يوجي', 'إيتادوري');
    if (name.includes('ميغومي')) shortcuts.push('ميغومي', 'فوشيغورو');
    if (name.includes('دينجي')) shortcuts.push('دينجي');
    if (name.includes('بوwer')) shortcuts.push('بوwer', 'باور');

    return shortcuts;
}

// التحقق من الإجابة
export async function checkCharacterGuess(sock, jid, sender, text) {
    const game = activeCharacterGames[jid];
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
    if (game.players && !game.players.includes(sender)) {
        return; // المرسل غير مسموح له بالمشاركة
    }

    // أضف الإجابة إلى قائمة الانتظار
    const shouldProcessQueue = enqueueAnswer('guessCharacter', jid, { sender, text });

    // معالجة قائمة الانتظار فقط إذا كانت هذه أول إجابة
    if (shouldProcessQueue) {
        await processAnswerQueue('guessCharacter', jid, 
            async (answerSender, answerText) => {
                const g = activeCharacterGames[jid];
                if (!g || !g.answerVariants) return false;

                const guess = answerText.toLowerCase();

                // fuzzy match
                const match = Array.isArray(g.answerVariants) && g.answerVariants.length > 0 && g.answerVariants.some(a =>
                    stringSimilarity.compareTwoStrings(a.toLowerCase(), guess) > 0.7
                );

                if (match) {
                    // إجابة صحيحة - عيِّن الحالة فوراً لمنع معالجة إضافية
                    g.state = 'interim';
                    g.answered = true;
                    
                    // البحث عن المستخدم
                    const kingdom = getKingdomIdFromGroupJid(jid);
                    const userByJid = await User.findOne({ jid: answerSender, kingdom_id: kingdom });

                    if (!userByJid) {
                        await sock.sendMessage(jid, {
                            text: `✅ إجابة صحيحة!\nالإجابة: ${g.character.name}\nمن أنمي: ${g.character.anime}\nلكن لا يمكن احتساب النقاط لأنك غير مسجل.`
                        });
                    } else {
                        const user = await User.findOne({ nickname: userByJid.nickname, kingdom_id: kingdom });
                        user.points = (user.points || 0) + 1;
                        const xpResult = awardGameXp(user, 1);
                        await user.save();

                        await sock.sendMessage(jid, {
                            text: `✅ إجابة صحيحة!\nالإجابة: ${g.character.name}\nمن أنمي: ${g.character.anime}\n+1 نقطة\n✨ +${xpResult.awardedXp} XP${xpResult.leveledUp ? `\n🏅 وصلت للمستوى ${xpResult.newLevel}!` : ""}\nمجموع نقاطك: 💰${user.points}`
                        });
                    }

                    return true; // إجابة صحيحة
                }

                return false; // إجابة خاطئة
            },
            async () => {
                // عند إنهاء الجولة، انتظر 3 ثواني ثم ابدأ جولة جديدة
                const g = activeCharacterGames[jid];
                if (!g) return;

                const participants = g.players;
                activeCharacterGames[jid] = { 
                    state: 'interim', 
                    players: participants
                };

                await sock.sendMessage(jid, { text: "⏭️ جولة جديدة قادمة بعد 3 ثواني..." });
                
                setTimeout(async () => {
                    if (activeCharacterGames[jid] && activeCharacterGames[jid].state === 'interim') {
                        await startActualCharacterGame(sock, jid, participants);
                    }
                }, ROUND_DELAY);
            }
        );
    }
}

export { CHARACTERS_DB };

// إيقاف اللعبة
export async function stopGuessCharacter(sock, jid) {
    if (activeCharacterGames[jid]) {
        clearTimeout(activeCharacterGames[jid].timeout);
        clearTimeout(activeCharacterGames[jid].hintTimeout);
        clearAnswerQueue('guessCharacter', jid);
        delete activeCharacterGames[jid];
        await sock.sendMessage(jid, { text: "🛑 تم إيقاف لعبة تخمين الشخصيات!" });
    } else {
        await sock.sendMessage(jid, { text: "❌ لا توجد لعبة تخمين شخصيات تعمل حالياً!" });
    }
}
