/**
 * نظام معالجة الإجابات الخطي
 * يضمن معالجة الإجابات واحدة تلو الأخرى بدون تداخل
 */

const answerQueues = {}; // قوائم الانتظار لكل لعبة في كل مجموعة
const processingGames = {}; // تتبع ما إذا كانت لعبة قيد المعالجة

/**
 * إضافة إجابة إلى قائمة الانتظار
 * @param {string} gameType - نوع اللعبة (flagGame, guessAnime, etc)
 * @param {string} jid - معرّف المجموعة
 * @param {object} response - بيانات الإجابة {sender, text, timestamp}
 * @returns {boolean} true إذا كانت أول إجابة وتحتاج معالجة، false إذا كانت هناك معالجة قيد التقدم
 */
export function enqueueAnswer(gameType, jid, response) {
    const key = `${gameType}-${jid}`;
    
    if (!answerQueues[key]) {
        answerQueues[key] = [];
    }
    
    // إذا لم تكن هناك معالجة قيد التقدم، سنعلّمها الآن
    const isFirstAnswer = !processingGames[key];
    if (isFirstAnswer) {
        processingGames[key] = true; // عيّن الآن قبل الإضافة إلى القائمة
    }
    
    answerQueues[key].push({
        sender: response.sender,
        text: response.text,
        timestamp: Date.now()
    });
    
    // إرجع true إذا كانت أول إجابة (المرة الأولى التي نرى فيها هذه اللعبة)
    return isFirstAnswer;
}

/**
 * معالجة قائمة الانتظار خطياً
 * @param {string} gameType - نوع اللعبة
 * @param {string} jid - معرّف المجموعة
 * @param {function} processor - دالة معالجة الإجابة (async)
 * @param {function} onRoundComplete - يُستدعى عند انتهاء الجولة الصحيحة (async)
 */
export async function processAnswerQueue(gameType, jid, processor, onRoundComplete) {
    const key = `${gameType}-${jid}`;
    
    // لا نحتاج إلى فحص processingGames[key] هنا لأن enqueueAnswer قد عيّنتها بالفعل
    // فقط تأكد من أنها موجودة
    if (!processingGames[key]) {
        return;
    }
    
    try {
        const queue = answerQueues[key];
        if (!queue || queue.length === 0) {
            return;
        }
        
        // معالجة الإجابات واحدة تلو الأخرى
        while (queue.length > 0) {
            const answer = queue.shift();
            
            // معالجة الإجابة
            const isCorrect = await processor(answer.sender, answer.text);
            
            // إذا كانت الإجابة صحيحة، توقف المعالجة
            if (isCorrect) {
                // استدعِ callback إنهاء الجولة
                if (onRoundComplete) {
                    await onRoundComplete();
                }
                
                // امسح باقي قائمة الانتظار
                answerQueues[key] = [];
                
                break;
            }
        }
    } finally {
        processingGames[key] = false;
    }
}

/**
 * مسح قائمة الانتظار عند إيقاف اللعبة
 * @param {string} gameType - نوع اللعبة
 * @param {string} jid - معرّف المجموعة
 */
export function clearAnswerQueue(gameType, jid) {
    const key = `${gameType}-${jid}`;
    answerQueues[key] = [];
    processingGames[key] = false;
}

/**
 * الحصول على حجم قائمة الانتظار (لأغراض التصحيح)
 * @param {string} gameType - نوع اللعبة
 * @param {string} jid - معرّف المجموعة
 */
export function getQueueSize(gameType, jid) {
    const key = `${gameType}-${jid}`;
    return answerQueues[key] ? answerQueues[key].length : 0;
}
