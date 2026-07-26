import User from "../database/userModel.js";
import { showBankBalance, depositToBank, withdrawFromBank, classifyIdentifier, isSuperAdminInKingdom, isAdmin, isModerator, findUserByNickname, findUserByNicknameOrPhone, getCleanMentionTextForUser } from "./adminSystem.js";
import { getHighestRank, displayRank } from "./rankSystem.js";
import { pendingMentions } from "../handlers/messageHandler.js";
import { ADMINS, getKingdomIdFromGroupJid, DEVELOPER_JIDS } from "../config.js";
import { formatLevelProgress } from "../utils/xpSystem.js";

// دالة موحدة لإرسال رسالة بمنشن
async function sendMentionMessage(sock, jid, targetUser, customMessage = null) {
  const mention = getCleanMentionTextForUser(targetUser);
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

  if (command === "/مستواي" || command === "/مستوى" || command === "/لفلي") {
    if (!user) {
      await sock.sendMessage(jid, { text: "❌ لم تقم بتسجيل لقب بعد. استخدم /لقب لتسجيل لقبك" });
      return true;
    }

    const progress = formatLevelProgress(user);
    let message = `✨ مستوى ${user.nickname}\n`;
    message += `━━━━━━━━━━━━━━━━━\n`;
    message += `🏅 المستوى: ${progress.level}\n`;
    message += `✨ XP: ${progress.xp}\n`;
    message += `📈 التقدم: ${progress.progressBar} ${progress.percent}%\n`;
    message += `⬆️ المتبقي للمستوى ${progress.level + 1}: ${progress.remaining} XP\n`;
    message += `💬 رسائل اليوم: ${user.dailyMessages || 0}\n`;
    message += `📊 إجمالي الرسائل: ${user.totalMessages || 0}\n`;
    message += `🗨️ XP المحادثة: ${user.chatXp || 0}\n`;
    message += `🎮 XP الألعاب: ${user.gameXp || 0}`;

    await sock.sendMessage(jid, { text: message });
    return true;
  }

  if (command === "/ترتيب_المستوى" || command === "/ترتيب_اللفل" || command === "/اللفلات") {
    const users = await User.find({ kingdom_id: kingdom, xp: { $gt: 0 } })
      .sort({ xp: -1, totalMessages: -1 })
      .limit(10);

    if (!users.length) {
      await sock.sendMessage(jid, { text: "لا يوجد ترتيب مستويات بعد." });
      return true;
    }

    let message = `🏆 ترتيب المستويات\n`;
    message += `━━━━━━━━━━━━━━━━━\n`;
    users.forEach((member, index) => {
      message += `${index + 1}. ${member.nickname} - Lv.${member.level || 0} | ${member.xp || 0} XP\n`;
    });

    await sock.sendMessage(jid, { text: message.trim() });
    return true;
  }

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
      const identifier = classifyIdentifier(participantJid);
      const mentionText = getCleanMentionTextForUser(participantJid);
      
      // تحديث بيانات المستخدم بالمنشن الجديد
      targetUser.mention = mentionText;
      targetUser.jid = identifier.jid || participantJid;
      targetUser.phoneNumber = identifier.identifierType === 'phone_jid' ? identifier.phoneNumber : null;
      targetUser.lid = identifier.identifierType === 'lid_jid' || identifier.identifierType === 'raw_lid' ? identifier.lid : null;
      targetUser.rawLid = identifier.identifierType === 'raw_lid' ? identifier.rawLid : null;
      targetUser.identifierType = identifier.identifierType;
      targetUser.countryCode = identifier.countryCode;
      targetUser.countryName = identifier.countryName;
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

  // أمر خاص بالمطور: عرض كل بيانات المستخدم بناءً على اللقب
  if (command === "/devinfo" || command === "/مطور" || command === "/مطور_معلومات") {
    // تحقق من أن المرسل من قائمة المطورين
    if (!DEVELOPER_JIDS.includes(sender)) {
      await sock.sendMessage(jid, { text: "❌ هذا الأمر مخصّص للمطورين فقط." });
      return true;
    }

    const nick = args.slice(1).join(" ").trim();
    if (!nick) {
      await sock.sendMessage(jid, { text: "❌ استخدم: /devinfo <لقب_المستخدم>" });
      return true;
    }

    // حاول العثور على المستخدم عبر اللقب أولاً (عالمي)
    let targetUser = await User.findOne({ nickname: { $regex: nick, $options: 'i' } });
    if (!targetUser) {
      // كنقطة احتياط، استخدم الدالة المساعدة التي تقبل رقم أو لقب
      targetUser = await findUserByNicknameOrPhone(nick);
    }

    if (!targetUser) {
      await sock.sendMessage(jid, { text: `❌ لم يتم العثور على مستخدم باسم "${nick}"` });
      return true;
    }

    // تجميع كل المعلومات المتاحة
    const t = targetUser;
    let info = `📋 *معلومات كاملة عن المستخدم*\n━━━━━━━━━━━━━━━━━━━━━\n`;
    info += `🔖 *اللقب:* ${t.nickname || 'غير متوفر'}\n`;
    info += `🆔 *JID:* ${t.jid || 'غير مسجل'}\n`;
    info += `🔗 *منشن:* ${getCleanMentionTextForUser(t) || 'غير مسجل'}\n`;
    info += `📞 *رقم الهاتف:* ${t.phoneNumber || 'غير مسجل'}\n`;
    info += `🪪 *lid:* ${t.lid || 'غير مسجل'}\n`;
    info += `🧾 *اسم واتساب:* ${t.whatsappName || 'غير متوفر'}\n`;
    info += `👤 *الدور:* ${t.role || 'غير محدد'}\n`;
    info += `💰 *نقاط:* ${t.points ?? 0}    💸 *عملات:* ${t.coins ?? 0}    🏦 *بنك:* ${t.bankCoins ?? 0}\n`;
    info += `✨ *المستوى:* ${t.level ?? 0}    XP: ${t.xp ?? 0}\n`;
    info += `📊 *الرسائل اليومية:* ${t.dailyMessages ?? 0}    الكلية: ${t.totalMessages ?? 0}\n`;
    info += `⏱️ *تاريخ الإنشاء:* ${t.createdAt ? new Date(t.createdAt).toLocaleString() : 'N/A'}\n`;
    info += `🚫 *محظور؟* ${t.isBanned ? 'نعم' : 'لا'}    ${t.isBanned ? ` (بسبب: ${t.banReason || 'غير معروف'})` : ''}\n`;

    // رتب وممالك
    info += `\n🏰 *الرتب والنجوم حسب المملكة:*\n`;
    const kingdoms = Object.keys(t.rankStarsByKingdom || {});
    if (kingdoms.length === 0) {
      info += `- لا توجد بيانات رتوب للمستخدم\n`;
    } else {
      for (const k of kingdoms) {
        const stars = t.rankStarsByKingdom?.[k] ?? 0;
        const kr = t.kingdomRankByKingdom?.[k] || 'غير محدد';
        info += `- ${k}: ${kr} - ${stars} ⭐\n`;
      }
    }

    // مجموع المجموعات والانضمامات
    info += `\n👥 *مجموعات:* ${Array.isArray(t.groups) ? t.groups.join(', ') || 'لا يوجد' : 'لا يوجد'}\n`;

    // إرسال الرسالة مع منشن إن وُجد JID
    const sendOpts = { text: info };
    if (t.jid) sendOpts.mentions = [t.jid];
    await sock.sendMessage(jid, sendOpts);
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
      const identifier = classifyIdentifier(sender);
      const whatsappName = msg?.pushName || 'صديق';
      user = new User({ 
        jid: identifier.jid || sender, 
        kingdom_id: kingdom,
        nickname: nick, 
        phoneNumber: identifier.identifierType === 'phone_jid' ? identifier.phoneNumber : null,
        lid: identifier.identifierType === 'lid_jid' || identifier.identifierType === 'raw_lid' ? identifier.lid : null,
        rawLid: identifier.identifierType === 'raw_lid' ? identifier.rawLid : null,
        identifierType: identifier.identifierType,
        countryCode: identifier.countryCode,
        countryName: identifier.countryName,
        whatsappName: whatsappName
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
    message += `✨ المستوى: ${user.level || 0} (${user.xp || 0} XP)\n`;
    message += `💰 النقاط: ${user.points || 0}\n`;
    message += `🎖️ نجوم الرتب: ${user.rankStarsByKingdom?.[kingdom] || 0}\n`;
    message += `💰 العملات: ${user.coins}\n`;
    message += `🏦 البنك: ${user.bankCoins || 0}\n`;
    message += `💬 الرسائل اليومية: ${user.dailyMessages || 0}\n`;
    message += `📊 إجمالي الرسائل: ${user.totalMessages || 0}\n`;
    message += `📅 تاريخ الانضمام: ${user.createdAt.toLocaleDateString('ar-EG')}\n`;

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
      await sock.sendMessage(jid, { text: "❌ استخدم: /من @<رقم> أو @<lid>@lid\n💡 أمثلة: /من @962791234567 أو /من @123@lid" });
      return true;
    }

    try {
      const lookup = classifyIdentifier(query);

      if (lookup.identifierType === 'lid_jid' || lookup.identifierType === 'raw_lid') {
        const targetUser = await User.findOne({ lid: lookup.lid, kingdom_id: kingdom });
        if (!targetUser) {
          await sock.sendMessage(jid, { text: `❌ لم يتم العثور على مستخدم بالـ lid "${lookup.lid}"` });
          return true;
        }
        var targetUserResolved = targetUser;
      } else if (lookup.identifierType === 'phone_jid') {
        let targetUser = await User.findOne({ jid: lookup.jid, kingdom_id: kingdom });
        if (!targetUser) {
          targetUser = await User.findOne({ phoneNumber: lookup.phoneNumber, kingdom_id: kingdom });
        }
        if (!targetUser) {
          await sock.sendMessage(jid, { text: `❌ لم يتم العثور على مستخدم برقم "${lookup.phoneNumber}"` });
          return true;
        }
        var targetUserResolved = targetUser;
      } else {
        const mentionLookup = query.startsWith('@') ? query : `@${query}`;
        let targetUser = await User.findOne({ mention: mentionLookup, kingdom_id: kingdom });
        if (!targetUser) {
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

      // إن وجد lid، أضفه
      if (t.lid) userInfo += `\n🔗 *lid:* ${t.lid}`;

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
      userInfo += `\n✨ *المستوى:* ${t.level || 0} (${t.xp || 0} XP)`;
      userInfo += `\n📊 *إجمالي الرسائل:* ${t.totalMessages || 0}`;

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
      const birthdayMessage = `🎉 **عيد ميلاد سعيد!** 🎂\n\n${getCleanMentionTextForUser(targetUser)}، نتمنى لك عاماً مليئاً بالسعادة والنجاح! 🎈✨\n\nمن جميع أعضاء المجموعة 💕`;
      await sendMentionMessage(sock, jid, targetUser, birthdayMessage);
    } else {
      await sock.sendMessage(jid, { text: `❌ اليوم ليس عيد ميلاد ${targetUser.nickname}.` });
    }
    return true;
  }

  // إذا لم يتم التعرف على الأمر، نعيد false ليتم التعامل معه كأمر غير معروف
  return false;
}
