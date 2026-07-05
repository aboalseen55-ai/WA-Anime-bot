import User from "../database/userModel.js";
import { getKingdomIdFromGroupJid } from "../config.js";
import { classifyIdentifier } from "../commands/adminSystem.js";

export async function handleGreetings(sock, jid, sender, text, msg) {
  if (!msg) return;

  const kingdom = getKingdomIdFromGroupJid(jid);
  let user = await User.findOne({ jid: sender, kingdom_id: kingdom });

  if (!user) {
    const name = msg.pushName || "صديق";
    
    // التحقق من أن اللقب غير موجود، وإذا كان موجوداً نضيف رقم عشوائي
    let nickname = name;
    let existingUser = await User.findOne({ nickname, kingdom_id: kingdom });
    let counter = 1;
    while (existingUser) {
      nickname = `${name}#${counter}`;
      existingUser = await User.findOne({ nickname, kingdom_id: kingdom });
      counter++;
    }

    const identifier = classifyIdentifier(sender);
    user = new User({
      jid: identifier.jid || sender,
      kingdom_id: kingdom,
      nickname: nickname,
      phoneNumber: identifier.identifierType === 'phone_jid' ? identifier.phoneNumber : null,
      lid: identifier.identifierType === 'lid_jid' || identifier.identifierType === 'raw_lid' ? identifier.lid : null,
      rawLid: identifier.identifierType === 'raw_lid' ? identifier.rawLid : null,
      identifierType: identifier.identifierType,
      countryCode: identifier.countryCode,
      countryName: identifier.countryName,
      mention: identifier.mention
    });

    await user.save();
  }

  const nickname = user.nickname || msg.pushName || "صديق";

  // ردود عفوية ومرحة
  const funnyGreetings = [
    `مرحباً يا ${nickname}! 👋 كيف حالك اليوم؟`,
    `أهلاً وسهلاً يا ${nickname}! وينك من زمان؟`,
    `نورتنا يا ${nickname}! ✨`,
    `مرحباً بك يا ${nickname}! 🌟`,
    `أهلاً يا ${nickname}! جاهز للعب؟`,
    `نورت يا ${nickname}! 👋`,
    `أهلاً وسهلاً يا ${nickname}!`,
    `مرحباً يا ${nickname}! كيف المزاج؟`,
    `نورتنا يا ${nickname}! ✨`,
    `أهلاً يا ${nickname}!`
  ];

  const funnyGoodbyes = [
    `مع السلامة يا ${nickname}! 👋`,
    `وداعاً يا ${nickname}! أشوفك قريباً`,
    `مع السلامة يا ${nickname}!`,
    `وداعاً يا ${nickname}!`,
    `أشوفك على خير يا ${nickname}!`,
    `مع السلامة يا ${nickname}!`,
    `وداعاً يا ${nickname}!`,
    `أشوفك قريباً يا ${nickname}!`
  ];

  const funnyReplies = [
    `أهلاً يا ${nickname}! كيف يمكنني مساعدتك؟`,
    `مرحباً يا ${nickname}! أنا هنا للمساعدة`,
    `نعم يا ${nickname}؟`,
    `أهلاً يا ${nickname}!`,
    `مرحباً يا ${nickname}!`,
    `أنا هنا يا ${nickname}!`,
    `نعم يا ${nickname}؟`
  ];

  // تحيات وترحيب
  if (/(السلام عليكم|مرحبا|أهلا|هلا|هاي|hi|hello|yo|يا هلا|هلا والله|هلاو|هلاوي|هلا وغلا)/i.test(text)) {
    const reply = funnyGreetings[Math.floor(Math.random() * funnyGreetings.length)];
    await sock.sendMessage(jid, { text: reply });
    return;
  }

  // صباحيات
  if (/(صباح الخير|صباحو|صباح النور|morning|good morning)/i.test(text)) {
    const reply = [
      `صباح الخير يا ${nickname}! 🌼`,
      `صباح النور يا ${nickname}!`,
      `صباحك سعيد يا ${nickname}!`,
      `صباح الخير يا ${nickname}!`
    ];
    await sock.sendMessage(jid, { text: reply[Math.floor(Math.random() * reply.length)] });
    return;
  }

  // مسائيات
  if (/(مساء الخير|مساء النور|evening|good evening|مساءو)/i.test(text)) {
    const reply = [
      `مساء الخير يا ${nickname}! 🌙`,
      `مساء النور يا ${nickname}!`,
      `مساءك سعيد يا ${nickname}!`,
      `مساء الخير يا ${nickname}!`
    ];
    await sock.sendMessage(jid, { text: reply[Math.floor(Math.random() * reply.length)] });
    return;
  }

  // وداعيات
  if (/(مع السلامة|وداعا|باي|bye|الى اللقاء|أشوفك|اشوفك|تصبح على خير|تصبحين على خير|تصبحوا على خير)/i.test(text)) {
    const reply = funnyGoodbyes[Math.floor(Math.random() * funnyGoodbyes.length)];
    await sock.sendMessage(jid, { text: reply });
    return;
  }

  // إذا أحد كتب "ضحكني" أو "نكتة"
  if (/(ضحكني|نكتة|نكت|joke|ضحك)/i.test(text)) {
    const jokes = [
      `مرة واحد ذهب للبقالة... نسي ليش دخل!`,
      `ليه الكمبيوتر ما يقدر يرقص؟ لأنه عنده معالج!`,
      `مرة دجاجة دخلت المكتبة... قالت: كوك كوك كتاب!`,
      `واحد ذهب للدكتور قاله: عندي مشكلة بالنسيان... الدكتور قاله: من متى؟ قال: من متى إيش؟`,
      `مرة واحد ذهب يشتري ساعة... رجع بالوقت!`
    ];
    await sock.sendMessage(jid, { text: jokes[Math.floor(Math.random() * jokes.length)] });
    return;
  }

  // ردود عفوية إذا ذكر البوت أو كلمة "بوت"
  if (/(بوت|bot|يا بوت|البوت)/i.test(text)) {
    const reply = funnyReplies[Math.floor(Math.random() * funnyReplies.length)];
    await sock.sendMessage(jid, { text: reply });
    return;
  }
}