import User from "../database/userModel.js";
import { getKingdomIdFromGroupJid } from "../config.js";

// نظام تتبع آخر رد على كل شخص (Timeout: 2 دقيقة قبل الرد مرة أخرى)
const lastReplyTime = new Map(); // key: jid, value: timestamp
const REPLY_TIMEOUT = 2 * 60 * 1000; // 2 دقيقة

// رسائل متنوعة للحب والإعجاب
const loveReplies = [
  "حبك أقوى من أي شيء 💚",
  "شكراً يا غالي 🥰",
  "أنت أفضل صديق 👑",
  "بحبك كمان 💕",
  "أنت نور حياتي ✨",
  "ما في أحلى منك 🌟",
  "أنت الأفضل محتج تعرفه 💫",
  "شكراً على الحب يا غالي 💕",
];

// رسائل للترحيب العام
const greetingReplies = [
  "كيفك أنت بالذات؟ 😊",
  "مشتاق لك يا صديق! 👋",
  "دايم بخير معك حولي 🌟",
  "أحلى ما اشوفك تحكي معي! 💬",
  "كل يوم أتمنى أشوفك 😊",
];

// رسائل للرد على الشكر
const thankReplies = [
  "ما تشكر على الواجب 😊",
  "لو احتجت حاجة أنا هنا 💪",
  "كل شيء من أجلك يا غالي 🌟",
  "شكراً أنت على كل شيء 💕",
  "في خدمتك دايماً ✨",
];

// رسائل للرد على الحزن
const sadReplies = [
  "لا تحزن يا غالي، أنا معك 💚",
  "كل شيء بيمر... أنا هنا 💪",
  "ما تنسى إني بجانبك دايماً 🤝",
  "الأحزان مؤقتة يا صديق 🌈",
  "أنت قوي يا غالي، أنت قادر 💪",
];

// رسائل للرد على الفرح والإثارة
const happyReplies = [
  "فرحتك فرحتي يا غالي! 🎉",
  "ماشاء الله بتاع الحظ! 🌟",
  "يارب تحقق أحلامك كلها! ✨",
  "أنت تستاهل كل الفرح يا غالي 💕",
  "يارب يكون هذا بداية أحلى! 🎊",
];

// رسائل عشوائية للرد على كلام عام
const randomReplies = [
  "هذا صحيح تماماً! 👍",
  "أنا معك بـ 100% 🤝",
  "نقطة ذهبية! ✨",
  "ما قلت أحلى منك 😄",
  "واقعياً أنت محق 🎯",
  "أحسنت التعبير! 💯",
  "ليتك دايم كذا يا ذكي 🧠",
];

/**
 * معالجة الردود على الرسائل (Reply)
 * فقط الردود العشوائية تكون على ردود البوت
 */
export async function handleQuotedMessageReply(sock, jid, sender, text, msg) {
  try {
    const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMessage) return false; // لا يوجد رد على رسالة

    // الرسالة هي رد على رسالة (من أي شخص كان)
    // نتأكد من وجود محتوى الرسالة المقتبسة
    const quotedText = quotedMessage.conversation || quotedMessage.extendedTextMessage?.text || quotedMessage.caption || '';
    if (!quotedText) return false;

    // التحقق من timeout
    const now = Date.now();
    const lastReply = lastReplyTime.get(sender) || 0;
    
    if (now - lastReply < REPLY_TIMEOUT) {
      // لم ينقضِ الوقت الكافي، لا نرد الآن
      return true;
    }

    const kingdom = getKingdomIdFromGroupJid(jid);
    const user = await User.findOne({ jid: sender, kingdom_id: kingdom });
    const nickname = user?.nickname || msg.pushName || "صديق";

    let reply = '';
    const textLower = text.toLowerCase().trim();
    
    // الكشف عن نوع الرسالة والرد المناسب
    if (/(أحبك|بحبك|حبيبي|حبيب|دار الحب|باحبك)/i.test(textLower)) {
      reply = loveReplies[Math.floor(Math.random() * loveReplies.length)];
    } 
    else if (/(شكراً|شكرا|تسلم|تسلمت|ميرسي|شكرك)/i.test(textLower)) {
      reply = thankReplies[Math.floor(Math.random() * thankReplies.length)];
    }
    else if (/(حزين|حزن|ضايق|مكتئب|حزينة|حزينين|أحس بـ|أحس ب)/i.test(textLower)) {
      reply = sadReplies[Math.floor(Math.random() * sadReplies.length)];
    }
    else if (/(فرحان|مسرور|مبسوط|سعيد|فرح|يا رب|قش|ماشاء)/i.test(textLower)) {
      reply = happyReplies[Math.floor(Math.random() * happyReplies.length)];
    }
    else {
      // رد عشوائي عام (فقط عند الرد على رسالة)
      reply = randomReplies[Math.floor(Math.random() * randomReplies.length)];
    }

    if (reply) {
      // حفظ وقت الرد الأخير
      lastReplyTime.set(sender, now);
      
      await sock.sendMessage(jid, {
        text: reply,
        mentions: [sender]
      });
      
      console.log(`✅ رد على رسالة من ${nickname}: ${reply}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error('❌ خطأ في معالجة الرد على الرسالة:', error.message);
    return false;
  }
}

/**
 * تحديث التحيات بتنوع أكبر + دعم timeout
 */
export async function handleAdvancedGreetings(sock, jid, sender, text, msg) {
  try {
    const kingdom = getKingdomIdFromGroupJid(jid);
    const user = await User.findOne({ jid: sender, kingdom_id: kingdom });
    const nickname = user?.nickname || msg.pushName || "صديق";

    // التحقق من timeout للترحيب
    const now = Date.now();
    const greetingKey = `greeting_${sender}`;
    const lastGreeting = lastReplyTime.get(greetingKey) || 0;
    
    if (now - lastGreeting < 30 * 60 * 1000) { // 30 دقيقة timeout للترحيب
      return false; // لم ينقضِ الوقت الكافي
    }

    // تحيات الصباح
    if (/(صباح الخير|صباحو|صباح النور|morning|good morning)/i.test(text)) {
      const replies = [
        `صباح الخير يا ${nickname}! 🌼 نورت اليوم!`,
        `صباح الورد يا ${nickname}! ☀️`,
        `صباح النور يا ${nickname}! كيفك؟`,
        `صباحك سعيد يا ${nickname}! 🌸`,
      ];
      const reply = replies[Math.floor(Math.random() * replies.length)];
      await sock.sendMessage(jid, { text: reply });
      lastReplyTime.set(greetingKey, now);
      return true;
    }

    // تحيات المساء
    if (/(مساء الخير|مساء النور|evening|good evening|مساءو)/i.test(text)) {
      const replies = [
        `مساء الخير يا ${nickname}! 🌙 كيف قضيت يومك؟`,
        `مساء النور يا ${nickname}! ⭐`,
        `مساءك سعيد يا ${nickname}! 🌟`,
        `مساء الخير يا ${nickname}! نورت الليل!`,
      ];
      const reply = replies[Math.floor(Math.random() * replies.length)];
      await sock.sendMessage(jid, { text: reply });
      lastReplyTime.set(greetingKey, now);
      return true;
    }

    // رسائل الترحيب العامة
    if (/(السلام عليكم|مرحبا|أهلا|هلا|هاي|hi|hello|yo|يا هلا|هلا والله|هلاو|هلاوي|هلا وغلا)/i.test(text)) {
      const replies = [
        `مرحباً يا ${nickname}! 👋 وحشتنا!`,
        `أهلاً وسهلاً يا ${nickname}!`,
        `نورتنا يا ${nickname}! 🌟`,
        `مرحباً يا ${nickname}! كيف حالك؟`,
        `أهلاً يا ${nickname}! جاهز للعب؟`,
        `نورت يا ${nickname}! 💫`,
        `السلام عليكم يا ${nickname}! 🍀`,
      ];
      const reply = replies[Math.floor(Math.random() * replies.length)];
      await sock.sendMessage(jid, { text: reply });
      lastReplyTime.set(greetingKey, now);
      return true;
    }

    // وداعيات
    if (/(مع السلامة|وداعا|باي|bye|الى اللقاء|أشوفك|اشوفك|تصبح على خير|تصبحين على خير|تصبحوا على خير)/i.test(text)) {
      const replies = [
        `مع السلامة يا ${nickname}! 👋 أشوفك قريباً!`,
        `وداعاً يا ${nickname}! كن بكل خير!`,
        `مع السلامة يا ${nickname}! 🍀`,
        `أشوفك على خير يا ${nickname}!`,
        `وداعاً يا ${nickname}! تصبح على خير!`,
      ];
      const reply = replies[Math.floor(Math.random() * replies.length)];
      await sock.sendMessage(jid, { text: reply });
      lastReplyTime.set(greetingKey, now);
      return true;
    }

    return false;
  } catch (error) {
    console.error('❌ خطأ في التحيات المحسنة:', error.message);
    return false;
  }
}

/**
 * مسح التايم أوت القديمة (اختياري - تشغيل كل ساعة)
 */
export function cleanupOldTimeouts() {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  
  for (const [key, timestamp] of lastReplyTime.entries()) {
    if (now - timestamp > oneDayMs) {
      lastReplyTime.delete(key);
    }
  }
  
  console.log(`🧹 تم تنظيف ${lastReplyTime.size} سجل قديم`);
}

// تشغيل تنظيف التايم أوت كل ساعة
setInterval(cleanupOldTimeouts, 60 * 60 * 1000);
