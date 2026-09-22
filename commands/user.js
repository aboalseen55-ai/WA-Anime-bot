import { dashboardReply } from '../services/dashboardTemplates.js';
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
      await sock.sendMessage(jid, { text: dashboardReply('reply_b506fc58ef1c1cc6')(["❌ لم تقم بتسجيل لقب بعد. استخدم /لقب لتسجيل لقبك"]) });
      return true;
    }

    const progress = formatLevelProgress(user);
    let message = dashboardReply('reply_8df34b51fb4f08f2')`✨ مستوى ${user.nickname}\n`;
    message += dashboardReply('reply_e9c24da67b9fb911')`━━━━━━━━━━━━━━━━━\n`;
    message += dashboardReply('reply_307c56c3f2ace444')`🏅 المستوى: ${progress.level}\n`;
    message += dashboardReply('reply_c8349dbcea8911ab')`✨ XP: ${progress.xp}\n`;
    message += dashboardReply('reply_fe818e48a8ec0f16')`📈 التقدم: ${progress.progressBar} ${progress.percent}%\n`;
    message += dashboardReply('reply_ba90089ddc119759')`⬆️ المتبقي للمستوى ${progress.level + 1}: ${progress.remaining} XP\n`;
    message += dashboardReply('reply_2d97b255615fee23')`💬 رسائل اليوم: ${user.dailyMessages || 0}\n`;
    message += dashboardReply('reply_fd9f6034ed2f7a3c')`📊 إجمالي الرسائل: ${user.totalMessages || 0}\n`;
    message += dashboardReply('reply_1112d50b86c4042f')`🗨️ XP المحادثة: ${user.chatXp || 0}\n`;
    message += dashboardReply('reply_2ba3022b2896836a')`🎮 XP الألعاب: ${user.gameXp || 0}`;

    await sock.sendMessage(jid, { text: message });
    return true;
  }

  if (command === "/ترتيب_المستوى" || command === "/ترتيب_اللفل" || command === "/اللفلات") {
    const users = await User.find({ kingdom_id: kingdom, xp: { $gt: 0 } })
      .sort({ xp: -1, totalMessages: -1 })
      .limit(10);

    if (!users.length) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_ff6b4a5dbf8aa2a6')(["لا يوجد ترتيب مستويات بعد."]) });
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
      await sock.sendMessage(jid, { text: dashboardReply('reply_0f67c7f9a8d87b14')(["❌ استخدم: /تعيين_منشن <لقب>"]) });
      return true;
    }
    let targetUser = await findUserByNickname(nick.trim(), kingdom);
    if (!targetUser) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_1a37a1912f9b8391')(["❌ لا يوجد مستخدم بهذا اللقب."]) });
      return true;
    }
    // تحقق من صلاحية الأدمن أو المشرف أو الأدمن الرئيسي في هذه المملكة
    const isSuperAdminUser = await isSuperAdminInKingdom(sender, kingdom);
    const isAdminOrMod = user && (user.role === 'admin' || user.role === 'moderator');
    if (!isAdminOrMod && !isSuperAdminUser) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_ea3525b2ba4de1d7')(["❌ فقط الأدمن أو المشرف يمكنهم تعيين أو تغيير منشن الأعضاء."]) });
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
          text: dashboardReply('reply_3d37fbbf090b7bc8')`❌ لم يتم العثور على ${targetUser.nickname} في قائمة المشاركين!`
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
      const successMessage = dashboardReply('reply_4cc139d433ea9551')`✅ تم ${action} منشن ${targetUser.nickname}!\n📣 المنشن الجديد: ${mentionText}`;
      await sock.sendMessage(jid, { text: successMessage });
      
      // إرسال رسالة إلى المستخدم يخبره بالمنشن الجديد
      const userNotification = `✅ تم تعيين منشنك:\n📣 ${mentionText}`;
      await sendMentionMessage(sock, jid, targetUser, userNotification);
      
    } catch (error) {
      console.error('❌ خطأ في استخراج بيانات المشاركين:', error);
      await sock.sendMessage(jid, { 
        text: dashboardReply('reply_26fcf97bffb56867')(['❌ حدث خطأ في الوصول لبيانات المجموعة!\n\nتأكد من أن البوت أدمن في المجموعة.'])
      });
    }
    return true;
  }

  // أمر خاص بالمطور: عرض كل بيانات المستخدم بناءً على اللقب
  if (command === "/devinfo" || command === "/مطور" || command === "/مطور_معلومات") {
    // تحقق من أن المرسل من قائمة المطورين
    if (!DEVELOPER_JIDS.includes(sender)) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_ca9a4d988be6f4cc')(["❌ هذا الأمر مخصّص للمطورين فقط."]) });
      return true;
    }

    const nick = args.slice(1).join(" ").trim();
    if (!nick) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_c90422a8a9c4098f')(["❌ استخدم: /devinfo <لقب_المستخدم>"]) });
      return true;
    }

    // حاول العثور على المستخدم عبر اللقب أولاً (عالمي)
    let targetUser = await User.findOne({ nickname: { $regex: nick, $options: 'i' } });
    if (!targetUser) {
      // كنقطة احتياط، استخدم الدالة المساعدة التي تقبل رقم أو لقب
      targetUser = await findUserByNicknameOrPhone(nick);
    }

    if (!targetUser) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_7afc7026e5ab24ca')`❌ لم يتم العثور على مستخدم باسم "${nick}"` });
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
      await sock.sendMessage(jid, { text: dashboardReply('reply_bab74d239a09385d')(["❌ اكتب لقب بعد الأمر\n/لقبي لقبك الجديد"]) });
      return true;
    }

    // التحقق من أن اللقب غير مستخدم من قبل
    const existingUser = await User.findOne({ nickname: nick, kingdom_id: kingdom });
    if (existingUser && existingUser.jid !== sender) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_430cbbd1ffe454b4')`❌ هذا اللقب مستخدم بالفعل من قبل شخص آخر!` });
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
      await sock.sendMessage(jid, { text: dashboardReply('reply_46480f679a31c2e2')`✅ تم تسجيل لقبك: ${nick}` });
    } else {
      // تغيير اللقب (يتطلب عملات إذا تم تغييره من قبل)
      // التحقق من أن اللقب الجديد غير مستخدم من قبل
      const existingUser = await User.findOne({ nickname: nick, kingdom_id: kingdom });
      if (existingUser && existingUser.jid !== sender) {
        await sock.sendMessage(jid, { text: dashboardReply('reply_430cbbd1ffe454b4')`❌ هذا اللقب مستخدم بالفعل من قبل شخص آخر!` });
        return true;
      }

      if (user.nicknameChanged) {
        if (user.coins < 50) {
          await sock.sendMessage(jid, { text: "❌ تحتاج إلى 50 عملة لتغيير اللقب!\n💰 عملاتك الحالية: " + user.coins });
          return true;
        }
        user.coins -= 50;
        await sock.sendMessage(jid, { text: dashboardReply('reply_0a35411ad0f4acf1')`💰 تم خصم 50 عملة لتغيير اللقب\n💰 رصيدك الآن: ${user.coins}` });
      }
      const oldNick = user.nickname;
      user.nickname = nick;
      user.whatsappName = msg?.pushName || user.whatsappName || 'صديق';
      user.nicknameChanged = true;
      await user.save();
      await sock.sendMessage(jid, { text: dashboardReply('reply_34f4ef0e702290a1')`✅ تم تغيير لقبك إلى: ${nick}` });
    }
    return true;
  }

  // معرفة الـ ID
  if (command === "/معرف") {
    if (user) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_f266661a19be7992')`🆔 لقبك: *${user.nickname}*\nID الخاص بك:\n${sender}` });
    } else {
      await sock.sendMessage(jid, { text: dashboardReply('reply_dc30d1ee7703cfca')`🆔 ID الخاص بك:\n${sender}\n\n⚠️ لم تقم بتسجيل لقب بعد. استخدم /لقب لتسجيل لقبك` });
    }
    return true;
  }

  // إعادة ضبط بيانات المستخدم وحذف نفسه
  if (command === "/اعادة") {
    if (!user) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_fdb8c280729493fc')(["❌ لا توجد بيانات لحذفها."]) });
      return true;
    }

    await User.deleteOne({ nickname: user.nickname, kingdom_id: kingdom });
    await sock.sendMessage(jid, { text: dashboardReply('reply_76dcfa37578c108d')(["✅ تم حذف بياناتك بالكامل، يمكنك إعادة التسجيل مجددًا."]) });
    return true;
  }

  // عرض الملف الشخصي - للأعضاء العاديين فقط
  if (command === "/ملفي") {
    // إعادة جلب البيانات لضمان الحصول على أحدث المعلومات من قاعدة البيانات
    user = await User.findOne({ jid: sender, kingdom_id: kingdom });
    
    if (!user) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_b506fc58ef1c1cc6')(["❌ لم تقم بتسجيل لقب بعد. استخدم /لقب لتسجيل لقبك"]) });
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

    let message = dashboardReply('reply_b151e67b637f02c1')`${roleEmoji} ملفك الشخصي\n`;
    message += dashboardReply('reply_e9c24da67b9fb911')`━━━━━━━━━━━━━━━━━\n`;
    message += dashboardReply('reply_235bf1bab2728de3')`📛 اللقب: ${user.nickname}\n`;
    message += dashboardReply('reply_51fbf500268a631f')`🎖️ الرتبة الإدارية: ${roleText}\n`;
    message += dashboardReply('reply_4f1612dc415d0f3d')`👑 رتبة المملكة: ${kingdomRankDisplay}\n`;
    message += dashboardReply('reply_7445371c678332b5')`✨ المستوى: ${user.level || 0} (${user.xp || 0} XP)\n`;
    message += dashboardReply('reply_4d8b7c89e1da55f7')`💰 النقاط: ${user.points || 0}\n`;
    message += dashboardReply('reply_b7dcedfbe59da5b4')`🎖️ نجوم الرتب: ${user.rankStarsByKingdom?.[kingdom] || 0}\n`;
    message += dashboardReply('reply_fd0d8b2dd2c18c1b')`💰 العملات: ${user.coins}\n`;
    message += dashboardReply('reply_a14f1730add346b9')`🏦 البنك: ${user.bankCoins || 0}\n`;
    message += dashboardReply('reply_e296e2690edf37e2')`💬 الرسائل اليومية: ${user.dailyMessages || 0}\n`;
    message += dashboardReply('reply_fd9f6034ed2f7a3c')`📊 إجمالي الرسائل: ${user.totalMessages || 0}\n`;
    message += dashboardReply('reply_a2dbc74b4a5b56e4')`📅 تاريخ الانضمام: ${user.createdAt.toLocaleDateString('ar-EG')}\n`;

    if (user.isBanned) {
      message += dashboardReply('reply_ac8a80de90a13f27')`🚫 محظور - السبب: ${user.banReason}\n`;
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
      await sock.sendMessage(jid, { text: dashboardReply('reply_c948977a152a031f')(["❌ استخدام: /إيداع <المبلغ>"]) });
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
      await sock.sendMessage(jid, { text: dashboardReply('reply_76f0f22db8d354b5')(["❌ استخدام: /سحب <المبلغ>"]) });
      return true;
    }
    await withdrawFromBank(sock, jid, sender, amount);
    return true;
  }

  if (command === "/تحويل") {
    const recipientNick = args[1];
    const amount = parseInt(args[2]);
    if (!recipientNick || isNaN(amount)) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_58553de26c89afd1')(["❌ استخدام: /تحويل <لقب المستلم> <المبلغ>"]) });
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
      await sock.sendMessage(jid, { text: dashboardReply('reply_b78c991b95509301')(["❌ استخدم: /منشن <لقب>"]) });
      return true;
    }
    const targetUser = await findUserByNickname(nick.trim(), kingdom);
    if (!targetUser) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_1a37a1912f9b8391')(["❌ لا يوجد مستخدم بهذا اللقب."]) });
      return true;
    }
    await sendMentionMessage(sock, jid, targetUser);
    return true;
  }

  // أمر تسجيل عيد الميلاد
  if (command === "/تسجيل_عيد_ميلاد") {
    const dateStr = args.slice(1).join(" ");
    if (!dateStr) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_d5b5dd33541ec9c2')(["❌ استخدم: /تسجيل_عيد_ميلاد <تاريخ الميلاد> (مثال: 15/08/2000)"]) });
      return true;
    }
    const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const match = dateStr.match(dateRegex);
    if (!match) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_71e128b43e50700d')(["❌ صيغة التاريخ غير صحيحة. استخدم: DD/MM/YYYY"]) });
      return true;
    }
    const day = parseInt(match[1]);
    const month = parseInt(match[2]);
    const year = parseInt(match[3]);
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > new Date().getFullYear()) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_d2434807f52a2eaf')(["❌ تاريخ غير صحيح."]) });
      return true;
    }
    const birthDate = new Date(year, month - 1, day);
    if (!user) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_38d0f10015fc2164')(["❌ يرجى تسجيل لقبك أولاً باستخدام /لقب"]) });
      return true;
    }
    user.birthDate = birthDate;
    await user.save();
    await sock.sendMessage(jid, { text: dashboardReply('reply_4bec0a779ae96fc9')`✅ تم تسجيل عيد ميلادك: ${day}/${month}/${year}` });
    return true;
  }

  // أمر للبحث عن لقب مستخدم من خلال المنشن
  if (command === "/من") {
    const query = args.slice(1).join(" ").trim();
    if (!query || !query.startsWith('@')) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_550862de7846358e')(["❌ استخدم: /من @<رقم> أو @<lid>@lid\n💡 أمثلة: /من @962791234567 أو /من @123@lid"]) });
      return true;
    }

    try {
      const lookup = classifyIdentifier(query);

      if (lookup.identifierType === 'lid_jid' || lookup.identifierType === 'raw_lid') {
        const targetUser = await User.findOne({ lid: lookup.lid, kingdom_id: kingdom });
        if (!targetUser) {
          await sock.sendMessage(jid, { text: dashboardReply('reply_488e8e8d1042d4ab')`❌ لم يتم العثور على مستخدم بالـ lid "${lookup.lid}"` });
          return true;
        }
        var targetUserResolved = targetUser;
      } else if (lookup.identifierType === 'phone_jid') {
        let targetUser = await User.findOne({ jid: lookup.jid, kingdom_id: kingdom });
        if (!targetUser) {
          targetUser = await User.findOne({ phoneNumber: lookup.phoneNumber, kingdom_id: kingdom });
        }
        if (!targetUser) {
          await sock.sendMessage(jid, { text: dashboardReply('reply_0deca06b67f1349a')`❌ لم يتم العثور على مستخدم برقم "${lookup.phoneNumber}"` });
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
          await sock.sendMessage(jid, { text: dashboardReply('reply_f102573240b0b2ce')`❌ لم يتم العثور على مستخدم بالمنشن أو اللقب "${query}"` });
          return true;
        }
        var targetUserResolved = targetUser;
      }

      // جمع معلومات المستخدم
      const t = targetUserResolved;
      let userInfo = dashboardReply('reply_ceb587b0139a486f')`👤 *معلومات المستخدم*\n━━━━━━━━━━━━━━━━━━━━━\n\n📝 *اللقب:* ${t.nickname}\n📞 *رقم الواتس:* +${t.phoneNumber || 'غير مسجل'}`;

      // إن وجد lid، أضفه
      if (t.lid) userInfo += dashboardReply('reply_4b463ecad5d7ca70')`\n🔗 *lid:* ${t.lid}`;

      // إضافة معلومات الترتيب إذا كانت موجودة
      const targetRankStars = t.rankStarsByKingdom?.[kingdom] || 0;
      const targetKingdomRank = t.kingdomRankByKingdom?.[kingdom];
      if (targetRankStars > 0 || targetKingdomRank) {
        userInfo += dashboardReply('reply_c244108efe06b6f1')`\n🎖️ *الترتيب:* `;
        if (targetKingdomRank) {
          userInfo += dashboardReply('reply_d4e9c53f4dcf4d9f')`المستوى ${targetKingdomRank}`;
        }
        if (targetRankStars > 0) {
          userInfo += dashboardReply('reply_b11b14f2ff126153')` - ${targetRankStars} ⭐`;
        }
      }

      // إضافة النقاط
      if (t.points !== undefined) {
        userInfo += dashboardReply('reply_3bde4635b3cf37c7')`\n💰 *النقاط:* ${t.points}`;
      }
      userInfo += dashboardReply('reply_682c57476fbe3475')`\n✨ *المستوى:* ${t.level || 0} (${t.xp || 0} XP)`;
      userInfo += dashboardReply('reply_bfe3a892e524fabe')`\n📊 *إجمالي الرسائل:* ${t.totalMessages || 0}`;

      // إضافة البنك
      if (t.bankBalance !== undefined) {
        userInfo += dashboardReply('reply_ea6f281c283c85f4')`\n🏦 *البنك:* ${t.bankBalance}`;
      }

      // إضافة الدور إذا كان أدمن أو مشرف
      if (t.role) {
        const roleEmoji = t.role === 'admin' ? '👑' : t.role === 'moderator' ? '🛡️' : '👤';
        const roleName = t.role === 'admin' ? 'أدمن' : t.role === 'moderator' ? 'مشرف' : 'عضو';
        userInfo += dashboardReply('reply_a67f9297da4c2cfd')`\n${roleEmoji} *الدور:* ${roleName}`;
      }

      userInfo += dashboardReply('reply_a5ecaa55670778e4')`\n━━━━━━━━━━━━━━━━━━━━━`;

      await sock.sendMessage(jid, { text: userInfo });
    } catch (error) {
      console.error("خطأ في البحث عن المستخدم:", error);
      await sock.sendMessage(jid, { text: dashboardReply('reply_42dd28cced8600e1')(["❌ حدث خطأ أثناء البحث"]) });
    }
    return true;
  }

  // أمر المعايدة بعيد الميلاد
  if (command === "/معايدة") {
    const nick = args.slice(1).join(" ");
    if (!nick) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_67c272f61d679f58')(["❌ استخدم: /معايدة <لقب>"]) });
      return true;
    }
    const targetUser = await findUserByNickname(nick.trim(), kingdom);
    if (!targetUser) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_1a37a1912f9b8391')(["❌ لا يوجد مستخدم بهذا اللقب."]) });
      return true;
    }
    if (!targetUser.birthDate) {
      await sock.sendMessage(jid, { text: dashboardReply('reply_b1d19b8fd1644fbf')`❌ ${targetUser.nickname} لم يسجل تاريخ ميلاده بعد.` });
      return true;
    }
    const today = new Date();
    const birthDay = targetUser.birthDate.getDate();
    const birthMonth = targetUser.birthDate.getMonth();
    if (today.getDate() === birthDay && today.getMonth() === birthMonth) {
      const birthdayMessage = `🎉 **عيد ميلاد سعيد!** 🎂\n\n${getCleanMentionTextForUser(targetUser)}، نتمنى لك عاماً مليئاً بالسعادة والنجاح! 🎈✨\n\nمن جميع أعضاء المجموعة 💕`;
      await sendMentionMessage(sock, jid, targetUser, birthdayMessage);
    } else {
      await sock.sendMessage(jid, { text: dashboardReply('reply_c0a5e90cc6240b26')`❌ اليوم ليس عيد ميلاد ${targetUser.nickname}.` });
    }
    return true;
  }

  // إذا لم يتم التعرف على الأمر، نعيد false ليتم التعامل معه كأمر غير معروف
  return false;
}
