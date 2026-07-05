import User from "../database/userModel.js";
import { showBankBalance, depositToBank, withdrawFromBank, getPhoneFromJID, extractAndSaveUserFromMention, isSuperAdminInKingdom, isAdmin, isModerator, findUserByNickname } from "./adminSystem.js";
import { getHighestRank, displayRank } from "./rankSystem.js";
import { pendingMentions } from "../handlers/messageHandler.js";
import { ADMINS, getKingdomIdFromGroupJid } from "../config.js";

// دالة موحدة لإرسال رسالة بمنشن
async function sendMentionMessage(sock, jid, targetUser, customMessage = null) {
  const mention = targetUser.mention || `@${targetUser.jid.split('@')[0]}`;
  const messageText = customMessage || `📣 منشن ${targetUser.nickname}: ${mention}`;
  
  await sock.sendMessage(jid, {
    text: messageText,
    mentions: [targetUser.jid]
  });
}

export async function userCommands(sock, jid, sender, text, msg) {
  const trimmedText = text.trim();
  const args = trimmedText.split(" ");
  const command = args[0];
  const kingdom = getKingdomIdFromGroupJid(jid);
  let user = await User.findOne({ jid: sender, kingdom_id: kingdom });

  // أمر تعيين أو تغيير المنشن (للأدمن والمشرفين فقط)
  if (command === "/تعيين_منشن" || command === "/تغيير_منشن") {
    const nick = args[1];
    if (!nick) {
      await sock.sendMessage(jid, { text: "❌ استخدم: /تعيين_منشن <لقب>" });
      return true;
    }
    let targetUser = await findUserByNickname(nick.trim(), kingdom);
    if (!targetUser) {
      await sock.sendMessage(jid, { text: "❌ لا يوجد مستخدم بهذا اللقب." });
      return true;
    }
    // تحقق من صلاحية الأدمن أو المشرف أو الأدمن الرئيسي في هذه المملكة
    const isSuperAdminUser = await isSuperAdminInKingdom(sender, kingdom);
    const isAdminOrMod = user && (user.role === 'admin' || user.role === 'moderator');
    if (!isAdminOrMod && !isSuperAdminUser) {
      await sock.sendMessage(jid, { text: "❌ فقط الأدمن أو المشرف يمكنهم تعيين أو تغيير منشن الأعضاء." });
      return true;
    }
    
    // الحصول على بيانات المشاركين في المجموعة
    try {
      const groupMetadata = await sock.groupMetadata(jid);
      const participants = groupMetadata.participants;
      
      // البحث عن المشارك برقمه
      let foundParticipant = null;
      const targetPhone = targetUser.phoneNumber;
      
      for (const participant of participants) {
        if (participant.id.includes(targetPhone)) {
          foundParticipant = participant;
          break;
        }
      }
      
      if (!foundParticipant) {
        await sock.sendMessage(jid, { 
          text: `❌ لم يتم العثور على ${targetUser.nickname} في قائمة المشاركين!` 
        });
        return true;
      }
      
      // استخراج JID والمنشن من بيانات المشارك
      const participantJid = foundParticipant.id;
      const phoneNumber = participantJid.split('@')[0];
      const mentionText = `@${phoneNumber}`;
      
      // تحديث بيانات المستخدم بالمنشن الجديد
      targetUser.mention = mentionText;
      targetUser.libId = null;
      await targetUser.save();
      
      // رسالة نجاح مع عرض المنشن الجديد
      const action = command === "/تعيين_منشن" ? "تعيين" : "تغيير";
      const successMessage = `✅ تم ${action} منشن ${targetUser.nickname}!\n📣 المنشن الجديد: ${mentionText}`;
      await sock.sendMessage(jid, { text: successMessage });
      
      // إرسال رسالة إلى المستخدم يخبره بالمنشن الجديد
      const userNotification = `✅ تم تعيين منشنك:\n📣 ${mentionText}`;
      await sendMentionMessage(sock, jid, targetUser, userNotification);
      
    } catch (error) {
      console.error('❌ خطأ في استخراج بيانات المشاركين:', error);
      await sock.sendMessage(jid, { 
        text: '❌ حدث خطأ في الوصول لبيانات المجموعة!\n\nتأكد من أن البوت أدمن في المجموعة.' 
      });
    }
    return true;
  }

  // أمر المستخدم لتسجيل أو تغيير لقبه الخاص
  if (command === "/لقبي") {
    const nick = args.slice(1).join(" ");
    if (!nick) {
      await sock.sendMessage(jid, { text: "❌ اكتب لقب بعد الأمر\n/لقبي لقبك الجديد" });
      return true;
    }

    // التحقق من أن اللقب غير مستخدم من قبل
    const existingUser = await User.findOne({ nickname: nick, kingdom_id: kingdom });
    if (existingUser && existingUser.jid !== sender) {
      await sock.sendMessage(jid, { text: `❌ هذا اللقب مستخدم بالفعل من قبل شخص آخر!` });
      return true;
    }

    if (!user) {
      // تسجيل المستخدم لأول مرة (مجاني)
      const phoneNumber = getPhoneFromJID(sender);
      const whatsappName = msg?.pushName || 'صديق';
      user = new User({ 
        jid: sender, 
        kingdom_id: kingdom,
        nickname: nick, 
        phoneNumber: phoneNumber, 
        whatsappName: whatsappName,
        libId: null
      });
      await user.save();
      await sock.sendMessage(jid, { text: `✅ تم تسجيل لقبك: ${nick}` });
    } else {
      // تغيير اللقب (يتطلب عملات إذا تم تغييره من قبل)
      // التحقق من أن اللقب الجديد غير مستخدم من قبل
      const existingUser = await User.findOne({ nickname: nick, kingdom_id: kingdom });
      if (existingUser && existingUser.jid !== sender) {
        await sock.sendMessage(jid, { text: `❌ هذا اللقب مستخدم بالفعل من قبل شخص آخر!` });
        return true;
      }

      if (user.nicknameChanged) {
        if (user.coins < 50) {
          await sock.sendMessage(jid, { text: "❌ تحتاج إلى 50 عملة لتغيير اللقب!\n💰 عملاتك الحالية: " + user.coins });
          return true;
        }
        user.coins -= 50;
        await sock.sendMessage(jid, { text: `💰 تم خصم 50 عملة لتغيير اللقب\n💰 رصيدك الآن: ${user.coins}` });
      }
      const oldNick = user.nickname;
      user.nickname = nick;
      user.whatsappName = msg?.pushName || user.whatsappName || 'صديق';
      user.nicknameChanged = true;
      await user.save();
      await sock.sendMessage(jid, { text: `✅ تم تغيير لقبك إلى: ${nick}` });
    }
    return true;
  }

  // معرفة الـ ID
  if (command === "/معرف") {
    if (user) {
      await sock.sendMessage(jid, { text: `🆔 لقبك: *${user.nickname}*\nID الخاص بك:\n${sender}` });
    } else {
      await sock.sendMessage(jid, { text: `🆔 ID الخاص بك:\n${sender}\n\n⚠️ لم تقم بتسجيل لقب بعد. استخدم /لقب لتسجيل لقبك` });
    }
    return true;
  }

  // إعادة ضبط بيانات المستخدم وحذف نفسه
  if (command === "/اعادة") {
    if (!user) {
      await sock.sendMessage(jid, { text: "❌ لا توجد بيانات لحذفها." });
      return true;
    }

    await User.deleteOne({ nickname: user.nickname, kingdom_id: kingdom });
    await sock.sendMessage(jid, { text: "✅ تم حذف بياناتك بالكامل، يمكنك إعادة التسجيل مجددًا." });
    return true;
  }

  // عرض الملف الشخصي - للأعضاء العاديين فقط
  if (command === "/ملفي") {
    // إعادة جلب البيانات لضمان الحصول على أحدث المعلومات من قاعدة البيانات
    user = await User.findOne({ jid: sender, kingdom_id: kingdom });
    
    if (!user) {
      await sock.sendMessage(jid, { text: "❌ لم تقم بتسجيل لقب بعد. استخدم /لقب لتسجيل لقبك" });
      return true;
    }

    // تخطي الأدمنز والمشرفين (نسختهم في adminCommands.js)
    const isSuperAdminUser = await isSuperAdminInKingdom(sender, kingdom);
    const isAdminUser = await isAdmin(sender, kingdom);
    const isModeratorUser = await isModerator(sender, kingdom);

    if (isSuperAdminUser || isAdminUser || isModeratorUser) {
      return true;
    }

    // للعضو العادي فقط
    let roleEmoji = '👤';
    let roleText = 'عضو';
    
    // الحصول على رتبة المملكة (النظام الجديد: تلقائي بالنجوم فقط)
    const kingdomRank = user.kingdomRankByKingdom?.[kingdom];
    const kingdomRankDisplay = kingdomRank ? displayRank(kingdom, kingdomRank) : '❌ لا توجد رتبة';

    let message = `${roleEmoji} ملفك الشخصي\n`;
    message += `━━━━━━━━━━━━━━━━━\n`;
    message += `📛 اللقب: ${user.nickname}\n`;
    message += `🎖️ الرتبة الإدارية: ${roleText}\n`;
    message += `👑 رتبة المملكة: ${kingdomRankDisplay}\n`;
    message += `💰 النقاط: ${user.points || 0}\n`;
    message += `🎖️ نجوم الرتب: ${user.rankStarsByKingdom?.[kingdom] || 0}\n`;
    message += `💰 العملات: ${user.coins}\n`;
    message += `🏦 البنك: ${user.bankCoins || 0}\n`;
    message += `� الرسائل اليومية: 💬 ${user.dailyMessages || 0}\n`;
    message += `�📅 تاريخ الانضمام: ${user.createdAt.toLocaleDateString('ar-EG')}\n`;

    if (user.isBanned) {
      message += `🚫 محظور - السبب: ${user.banReason}\n`;
    }

    await sock.sendMessage(jid, { text: message });
    return true;
  }

  // أوامر البنك
  if (command === "/بنك") {
    // إعادة جلب البيانات لضمان الحصول على أحدث المعلومات
    user = await User.findOne({ jid: sender, kingdom_id: kingdom });
    await showBankBalance(sock, jid, sender);
    return true;
  }

  if (command === "/إيداع") {
    const amount = parseInt(args[1]);
    if (isNaN(amount)) {
      await sock.sendMessage(jid, { text: "❌ استخدام: /إيداع <المبلغ>" });
      return true;
    }
    // إعادة جلب البيانات لضمان الحصول على أحدث المعلومات
    user = await User.findOne({ jid: sender, kingdom_id: kingdom });
    await depositToBank(sock, jid, sender, amount);
    return true;
  }

  if (command === "/سحب") {
    const amount = parseInt(args[1]);
    if (isNaN(amount)) {
      await sock.sendMessage(jid, { text: "❌ استخدام: /سحب <المبلغ>" });
      return true;
    }
    await withdrawFromBank(sock, jid, sender, amount);
    return true;
  }

  if (command === "/تحويل") {
    const recipientNick = args[1];
    const amount = parseInt(args[2]);
    if (!recipientNick || isNaN(amount)) {
      await sock.sendMessage(jid, { text: "❌ استخدام: /تحويل <لقب المستلم> <المبلغ>" });
      return true;
    }
    const { transferCoinsBetweenUsers } = await import('./adminSystem.js');
    await transferCoinsBetweenUsers(sock, jid, sender, recipientNick.trim(), amount);
    return true;
  }

  // أمر عرض المنشن للقب معين
  if (command === "/منشن") {
    const nick = args.slice(1).join(" ");
    if (!nick) {
      await sock.sendMessage(jid, { text: "❌ استخدم: /منشن <لقب>" });
      return true;
    }
    const targetUser = await findUserByNickname(nick.trim(), kingdom);
    if (!targetUser) {
      await sock.sendMessage(jid, { text: "❌ لا يوجد مستخدم بهذا اللقب." });
      return true;
    }
    await sendMentionMessage(sock, jid, targetUser);
    return true;
  }

  // أمر تسجيل عيد الميلاد
  if (command === "/تسجيل_عيد_ميلاد") {
    const dateStr = args.slice(1).join(" ");
    if (!dateStr) {
      await sock.sendMessage(jid, { text: "❌ استخدم: /تسجيل_عيد_ميلاد <تاريخ الميلاد> (مثال: 15/08/2000)" });
      return true;
    }
    const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const match = dateStr.match(dateRegex);
    if (!match) {
      await sock.sendMessage(jid, { text: "❌ صيغة التاريخ غير صحيحة. استخدم: DD/MM/YYYY" });
      return true;
    }
    const day = parseInt(match[1]);
    const month = parseInt(match[2]);
    const year = parseInt(match[3]);
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > new Date().getFullYear()) {
      await sock.sendMessage(jid, { text: "❌ تاريخ غير صحيح." });
      return true;
    }
    const birthDate = new Date(year, month - 1, day);
    if (!user) {
      await sock.sendMessage(jid, { text: "❌ يرجى تسجيل لقبك أولاً باستخدام /لقب" });
      return true;
    }
    user.birthDate = birthDate;
    await user.save();
    await sock.sendMessage(jid, { text: `✅ تم تسجيل عيد ميلادك: ${day}/${month}/${year}` });
    return true;
  }

  // أمر للبحث عن لقب مستخدم من خلال المنشن
  if (command === "/من") {
    const query = args.slice(1).join(" ").trim();
    if (!query || !query.startsWith('@')) {
      await sock.sendMessage(jid, { text: "❌ استخدم: /من @<رقم> أو @<libId>@lib\n💡 أمثلة: /من @962791234567 أو /من @123@lib" });
      return true;
    }

    try {
      // إزالة الـ @ البداية
      const token = query.substring(1).trim();

      // 1) حالة lib: @123@lib أو 123@lib
      const libMatch = token.match(/^(\d+)@lib$/i);
      if (libMatch) {
        const libId = libMatch[1];
        const targetUser = await User.findOne({ libId: libId, kingdom_id: kingdom });
        if (!targetUser) {
          await sock.sendMessage(jid, { text: `❌ لم يتم العثور على مستخدم بالـ libId "${libId}"` });
          return true;
        }
        // عرض المعلومات
        var targetUserResolved = targetUser;
      } else if (/^\d+$/.test(token)) {
        // 2) رقم فقط: حاول البحث عبر JID ثم عبر حقل phoneNumber
        const phoneNumber = token;
        const userJid = phoneNumber + '@s.whatsapp.net';
        let targetUser = await User.findOne({ jid: userJid, kingdom_id: kingdom });
        if (!targetUser) {
          targetUser = await User.findOne({ phoneNumber: { $regex: phoneNumber, $options: 'i' }, kingdom_id: kingdom });
        }
        if (!targetUser) {
          await sock.sendMessage(jid, { text: `❌ لم يتم العثور على مستخدم برقم "${phoneNumber}"` });
          return true;
        }
        var targetUserResolved = targetUser;
      } else {
        // 3) غير رقمي: قد يكون منشن مسجل في الحقل `mention` أو قد يكون لقب
        // حاول البحث أولاً في حقل mention كما ورد (مع @)
        const mentionLookup = query.startsWith('@') ? query : `@${query}`;
        let targetUser = await User.findOne({ mention: mentionLookup, kingdom_id: kingdom });
        if (!targetUser) {
          // كطيفة ثانية، استخدم البحث العام باللقب أو رقم عبر الدالة المساعدة
          const { findUserByNicknameOrPhone } = await import('./adminSystem.js');
          targetUser = await findUserByNicknameOrPhone(query, kingdom);
        }
        if (!targetUser) {
          await sock.sendMessage(jid, { text: `❌ لم يتم العثور على مستخدم بالمنشن أو اللقب "${query}"` });
          return true;
        }
        var targetUserResolved = targetUser;
      }

      // جمع معلومات المستخدم
      const t = targetUserResolved;
      let userInfo = `👤 *معلومات المستخدم*\n━━━━━━━━━━━━━━━━━━━━━\n\n📝 *اللقب:* ${t.nickname}\n📞 *رقم الواتس:* +${t.phoneNumber || 'غير مسجل'}`;

      // إن وجد libId، أضفه
      if (t.libId) userInfo += `\n🔗 *libId:* ${t.libId}`;

      // إضافة معلومات الترتيب إذا كانت موجودة
      const targetRankStars = t.rankStarsByKingdom?.[kingdom] || 0;
      const targetKingdomRank = t.kingdomRankByKingdom?.[kingdom];
      if (targetRankStars > 0 || targetKingdomRank) {
        userInfo += `\n🎖️ *الترتيب:* `;
        if (targetKingdomRank) {
          userInfo += `المستوى ${targetKingdomRank}`;
        }
        if (targetRankStars > 0) {
          userInfo += ` - ${targetRankStars} ⭐`;
        }
      }

      // إضافة النقاط
      if (t.points !== undefined) {
        userInfo += `\n💰 *النقاط:* ${t.points}`;
      }

      // إضافة البنك
      if (t.bankBalance !== undefined) {
        userInfo += `\n🏦 *البنك:* ${t.bankBalance}`;
      }

      // إضافة الدور إذا كان أدمن أو مشرف
      if (t.role) {
        const roleEmoji = t.role === 'admin' ? '👑' : t.role === 'moderator' ? '🛡️' : '👤';
        const roleName = t.role === 'admin' ? 'أدمن' : t.role === 'moderator' ? 'مشرف' : 'عضو';
        userInfo += `\n${roleEmoji} *الدور:* ${roleName}`;
      }

      userInfo += `\n━━━━━━━━━━━━━━━━━━━━━`;

      await sock.sendMessage(jid, { text: userInfo });
    } catch (error) {
      console.error("خطأ في البحث عن المستخدم:", error);
      await sock.sendMessage(jid, { text: "❌ حدث خطأ أثناء البحث" });
    }
    return true;
  }

  // أمر المعايدة بعيد الميلاد
  if (command === "/معايدة") {
    const nick = args.slice(1).join(" ");
    if (!nick) {
      await sock.sendMessage(jid, { text: "❌ استخدم: /معايدة <لقب>" });
      return true;
    }
    const targetUser = await findUserByNickname(nick.trim(), kingdom);
    if (!targetUser) {
      await sock.sendMessage(jid, { text: "❌ لا يوجد مستخدم بهذا اللقب." });
      return true;
    }
    if (!targetUser.birthDate) {
      await sock.sendMessage(jid, { text: `❌ ${targetUser.nickname} لم يسجل تاريخ ميلاده بعد.` });
      return true;
    }
    const today = new Date();
    const birthDay = targetUser.birthDate.getDate();
    const birthMonth = targetUser.birthDate.getMonth();
    if (today.getDate() === birthDay && today.getMonth() === birthMonth) {
      const birthdayMessage = `🎉 **عيد ميلاد سعيد!** 🎂\n\n${targetUser.mention || `@${targetUser.jid.split('@')[0]}`}، نتمنى لك عاماً مليئاً بالسعادة والنجاح! 🎈✨\n\nمن جميع أعضاء المجموعة 💕`;
      await sendMentionMessage(sock, jid, targetUser, birthdayMessage);
    } else {
      await sock.sendMessage(jid, { text: `❌ اليوم ليس عيد ميلاد ${targetUser.nickname}.` });
    }
    return true;
  }

  // إذا لم يتم التعرف على الأمر، نعيد false ليتم التعامل معه كأمر غير معروف
  return false;
}
