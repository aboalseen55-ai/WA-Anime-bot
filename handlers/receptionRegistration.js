import { dashboardReply } from '../services/dashboardTemplates.js';
import { classifyIdentifier, getMentionFromJID, buildWorkWelcomeFormMessage } from "../commands/adminSystem.js";
import User from "../database/userModel.js";
import { getKingdomIdFromGroupJid } from "../config.js";
import { extractReceptionOnboardingInfo, isReceptionGreetingOnly, resolveMainGroupInviteLink } from "../utils/receptionOnboarding.js";
import { userCommands } from "../commands/user.js";
import { handleAdminCommands } from "../commands/adminCommands.js";
import { awaitingNicknameRegistration, nicknameRegistrationStages } from "./handlerState.js";

async function validateReceptionNickname(sock, jid, sender, nickname, kingdom) {
  if (!nickname || nickname.length < 2) {
    await sock.sendMessage(jid, {
      text: dashboardReply('reply_c0d242e1eeaa3b8f')(['اكتب لقب أو اسم أوضح شوي.']),
      mentions: [sender]
    });
    return false;
  }

  if (nickname.length > 30) {
    await sock.sendMessage(jid, {
      text: dashboardReply('reply_0fd3742cf18df010')(['اللقب طويل. خليه 30 حرف أو أقل.']),
      mentions: [sender]
    });
    return false;
  }

  const existingUser = await User.findOne({
    nickname: { $regex: `^${nickname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: 'i' },
    kingdom_id: kingdom
  });

  if (existingUser && existingUser.jid !== sender) {
    await sock.sendMessage(jid, {
      text: dashboardReply('reply_7cc75f67f1bb0f71')(['هذا اللقب مستخدم. جرّب لقب ثاني.']),
      mentions: [sender]
    });
    return false;
  }

  return true;
}

async function removeFromReceptionGroup(sock, receptionJid, sender) {
  try {
    await sock.groupParticipantsUpdate(receptionJid, [sender], "remove");
    return true;
  } catch (error) {
    console.warn(`⚠️ تعذر إخراج العضو من الاستقبال ${sender}: ${error.message}`);
    return false;
  }
}

async function completeReceptionRegistration(sock, jid, sender, msg, userStage, enteringSource) {
  const kingdom = getKingdomIdFromGroupJid(jid);
  let user = await User.findOne({ jid: sender, kingdom_id: kingdom });
  const whatsappName = msg.pushName || 'صديق';
  const originalNickname = userStage.nickname;

  if (!user) {
    const identifier = classifyIdentifier(sender);
    user = new User({
      jid: identifier.jid || sender,
      kingdom_id: kingdom,
      nickname: originalNickname,
      phoneNumber: identifier.identifierType === 'phone_jid' ? identifier.phoneNumber : null,
      lid: identifier.identifierType === 'lid_jid' || identifier.identifierType === 'raw_lid' ? identifier.lid : null,
      rawLid: identifier.identifierType === 'raw_lid' ? identifier.rawLid : null,
      identifierType: identifier.identifierType,
      countryCode: identifier.countryCode,
      countryName: identifier.countryName,
      mention: getMentionFromJID(identifier.jid || sender),
      whatsappName,
      enteringSource
    });
  } else {
    user.nickname = originalNickname;
    user.whatsappName = whatsappName;
    user.enteringSource = enteringSource;
  }

  await user.save();
  console.log(`✅ تم تسجيل مستخدم جديد: ${originalNickname} (${sender}) - من طرف: ${enteringSource}`);

  awaitingNicknameRegistration.delete(sender);
  delete nicknameRegistrationStages[sender];

  const { KINGDOMS } = await import('../config.js');
  const kingdomData = KINGDOMS[kingdom];
  const kingdomName = kingdomData?.name || 'المملكة';
  const inviteLink = await resolveMainGroupInviteLink(sock, kingdomData);

  await sock.sendMessage(jid, {
    text: dashboardReply('reply_8b9dba8ac6f6ce21')`تم تسجيلك يا ${originalNickname}. أرسلت لك رابط القروب الأساسي على الخاص.`,
    mentions: [sender]
  });

  if (inviteLink) {
    try {
      await sock.sendMessage(sender, {
        text: dashboardReply('reply_0d387407a1af16d8')`أهلًا ${originalNickname}.\nهذا رابط دخول ${kingdomName}:\n${inviteLink}`
      });
    } catch (error) {
      console.warn(`⚠️ تعذر إرسال رابط الدعوة للخاص ${sender}: ${error.message}`);
      await sock.sendMessage(jid, {
        text: dashboardReply('reply_46687aa97fe57087')`تم التسجيل، لكن ما قدرت أرسل الرابط على الخاص. افتح الخاص للبوت أو تواصل مع الإدارة.`,
        mentions: [sender]
      });
    }
  } else {
    await sock.sendMessage(jid, {
      text: dashboardReply('reply_2f64b979601e2b17')`تم التسجيل، لكن رابط القروب الأساسي غير مضبوط في بيانات المملكة.`,
      mentions: [sender]
    });
  }

  const removed = await removeFromReceptionGroup(sock, jid, sender);
  if (!removed) {
    await sock.sendMessage(jid, {
      text: dashboardReply('reply_fe59138dd97f6adc')`تم التسجيل، لكن لم أستطع إخراج العضو من الاستقبال. تأكد أن البوت أدمن.`,
      mentions: [sender]
    });
  }

  try {
    const workGroupJid = kingdomData?.workGroup;

    if (workGroupJid) {
      const formMessage = buildWorkWelcomeFormMessage({
        nickname: originalNickname,
        status: 'جديد ⭐',
        enteringSource,
        moderatorName: 'غير محدد',
        kingdom
      });

      await sock.sendMessage(workGroupJid, { text: formMessage });
      console.log(`✅ تم إرسال إنجاز استقبال العضو إلى مجموعة الوورك: ${originalNickname}`);
    } else {
      console.log(`ℹ️ لا توجد مجموعة وورك محددة للمملكة: ${kingdom}`);
    }
  } catch (workError) {
    console.error(`⚠️ خطأ في إرسال إنجاز الوورك: ${workError.message}`);
  }
}

// معالجة تسجيل اللقب للمستخدمين الجدد في مجموعة الاستقبال - نظام متعدد المراحل
export async function handleReceptionRegistration(sock, jid, sender, text, msg) {
  if (!awaitingNicknameRegistration.has(sender)) return false;

  // حتى لو كان المستخدم في مرحلة التسجيل، دع الأوامر تعمل (مثل /أوامر، /التفاعل)
  if (text.startsWith('/')) {
    await userCommands(sock, jid, sender, text, msg);
    await handleAdminCommands(sock, jid, text, sender, msg);
    return true;
  }

  const { getKingdomFromGroupJid } = await import('../config.js');
  const kingdom = getKingdomFromGroupJid(jid);
  const receptionJid = kingdom?.receptionGroup || jid;

  // التحقق من أن الرسالة في مجموعة الاستقبال
  if (jid !== receptionJid) {
    await sock.sendMessage(jid, { text: dashboardReply('reply_8772d83c4c95b3d7')(['❌ يرجى إرسال ردك في مجموعة الاستقبال فقط.']) });
    return true;
  }

  const userStage = nicknameRegistrationStages[sender];

  // دعم الجلسات القديمة التي بدأت قبل تحديث التسلسل
  if (userStage && userStage.stage === 'welcome') {
    console.log(`✅ مرحلة الترحيب: تم استقبال رد من ${sender}`);
    nicknameRegistrationStages[sender].stage = 'sourceInput';

    await sock.sendMessage(jid, {
      text: dashboardReply('reply_161c2cb267140ae2')(['تمام، مين اللي جابك أو من طرف مين دخلت؟']),
      mentions: [sender]
    });
    return true;
  }

  // ============================================
  // المرحلة الأولى: سؤال من طرف من
  // ============================================
  if (userStage && userStage.stage === 'sourceInput') {
    console.log(`🔗 مرحلة مصدر الدخول: تم استقبال الرد من ${sender}`);

    const info = await extractReceptionOnboardingInfo(text);
    const enteringSource = info.source || text.trim();

    if (!info.source && isReceptionGreetingOnly(text)) {
      await sock.sendMessage(jid, {
        text: dashboardReply('reply_4cc2a281ba758cdb')(['أهلًا فيك. مين اللي دخلت من طرفه؟']),
        mentions: [sender]
      });
      return true;
    }

    if (!enteringSource || enteringSource.length < 2) {
      await sock.sendMessage(jid, {
        text: dashboardReply('reply_d56094136e92b65c')(['اكتب اسم الشخص اللي دخلت من طرفه.']),
        mentions: [sender]
      });
      return true;
    }

    if (enteringSource.length > 50) {
      await sock.sendMessage(jid, {
        text: dashboardReply('reply_2438bd567579a3cc')(['الاسم طويل شوي. اكتب اسم الشخص فقط.']),
        mentions: [sender]
      });
      return true;
    }

    nicknameRegistrationStages[sender].enteringSource = enteringSource;

    if (info.nickname) {
      const kingdom = getKingdomIdFromGroupJid(jid);
      if (!(await validateReceptionNickname(sock, jid, sender, info.nickname, kingdom))) return true;
      nicknameRegistrationStages[sender].stage = 'nicknameConfirmation';
      nicknameRegistrationStages[sender].nickname = info.nickname;
      await sock.sendMessage(jid, {
        text: dashboardReply('reply_56397e6127002150')`لقبك هو: ${info.nickname}\nاكتبه مرة ثانية للتأكيد.`,
        mentions: [sender]
      });
      return true;
    }

    nicknameRegistrationStages[sender].stage = 'nicknameInput';
    await sock.sendMessage(jid, {
      text: dashboardReply('reply_a099bd0f5cec76de')(['تمام. شو اللقب اللي تحب نسجلك فيه؟']),
      mentions: [sender]
    });
    return true;
  }

  // ============================================
  // المرحلة الثانية: استقبال اللقب
  // ============================================
  if (userStage && userStage.stage === 'nicknameInput') {
    console.log(`📝 مرحلة إدخال اللقب: تم استقبال لقب من ${sender}`);

    const info = await extractReceptionOnboardingInfo(text);
    const nickname = info.nickname || text.trim();
    const kingdom = getKingdomIdFromGroupJid(jid);
    if (!info.nickname && isReceptionGreetingOnly(text)) {
      await sock.sendMessage(jid, {
        text: dashboardReply('reply_9b00bb3b05002ee8')(['أهلًا. شو اللقب اللي نسجلك فيه؟']),
        mentions: [sender]
      });
      return true;
    }
    if (!(await validateReceptionNickname(sock, jid, sender, nickname, kingdom))) return true;

    if (info.source && !nicknameRegistrationStages[sender].enteringSource) {
      nicknameRegistrationStages[sender].enteringSource = info.source;
    }

    // الانتقال للمرحلة الثالثة: طلب التأكيد
    nicknameRegistrationStages[sender].stage = 'nicknameConfirmation';
    nicknameRegistrationStages[sender].nickname = nickname;

    const confirmationMessage = dashboardReply('reply_963a34dadd51d07c')`لقبك هو: ${nickname}
اكتبه مرة ثانية للتأكيد.`;

    await sock.sendMessage(jid, {
      text: confirmationMessage,
      mentions: [sender]
    });
    return true;
  }

  // ============================================
  // المرحلة الثالثة: تأكيد اللقب (إعادة كتابة)
  // ============================================
  if (userStage && userStage.stage === 'nicknameConfirmation') {
    console.log(`✔️ مرحلة التأكيد: تم استقبال تأكيد من ${sender}`);
    
    const confirmedNickname = text.trim();
    const originalNickname = userStage.nickname;

    // التحقق من أن الإجابة مطابقة للقب الأصلي
    if (confirmedNickname.toLowerCase() === originalNickname.toLowerCase()) {
      const enteringSource = userStage.enteringSource;
      if (enteringSource) {
        await completeReceptionRegistration(sock, jid, sender, msg, userStage, enteringSource);
        return true;
      }

      nicknameRegistrationStages[sender].stage = 'enteringSource';
      nicknameRegistrationStages[sender].nickname = originalNickname;

      const sourceMessage = dashboardReply('reply_e83278986b94ad29')`تمام. مين اللي جابك أو من طرف مين دخلت؟`;

      await sock.sendMessage(jid, {
        text: sourceMessage,
        mentions: [sender]
      });
      return true;

    } else {
      // ❌ التأكيد خاطئ - إعادة العملية من البداية
      nicknameRegistrationStages[sender].stage = 'nicknameInput';
      delete nicknameRegistrationStages[sender].nickname;

      const retryMessage = dashboardReply('reply_e0ed501711b642c5')`ما طابق اللقب.
اكتب لقبك من جديد.`;

      await sock.sendMessage(jid, {
        text: retryMessage,
        mentions: [sender]
      });
      return true;
    }
  }

  // ============================================
  // المرحلة الرابعة: استقبال مصدر الدخول
  // ============================================
  if (userStage && userStage.stage === 'enteringSource') {
    console.log(`🔗 مرحلة مصدر الدخول: تم استقبال الرد من ${sender}`);

    const info = await extractReceptionOnboardingInfo(text);
    const enteringSource = info.source || text.trim();

    if (!info.source && isReceptionGreetingOnly(text)) {
      await sock.sendMessage(jid, {
        text: dashboardReply('reply_4cc2a281ba758cdb')(['أهلًا فيك. مين اللي دخلت من طرفه؟']),
        mentions: [sender]
      });
      return true;
    }

    if (!enteringSource || enteringSource.length < 2) {
      await sock.sendMessage(jid, {
        text: dashboardReply('reply_d56094136e92b65c')(['اكتب اسم الشخص اللي دخلت من طرفه.']),
        mentions: [sender]
      });
      return true;
    }

    if (enteringSource.length > 50) {
      await sock.sendMessage(jid, {
        text: dashboardReply('reply_2438bd567579a3cc')(['الاسم طويل شوي. اكتب اسم الشخص فقط.']),
        mentions: [sender]
      });
      return true;
    }

    await completeReceptionRegistration(sock, jid, sender, msg, userStage, enteringSource);

    return true;
  }

  return false;
}
