import { dashboardReply } from '../services/dashboardTemplates.js';
import { extractAndSaveUserFromMention, getCleanMentionTextForUser, buildWelcomeFormMessage, recordSuccessfulWelcome } from "../commands/adminSystem.js";
import User from "../database/userModel.js";
import { getKingdomFromGroupJid, getKingdomIdFromGroupJid } from "../config.js";
import { pendingMentions } from "./handlerState.js";

async function isParticipantInGroup(sock, groupJid, participantJid) {
  if (!groupJid || !participantJid) return false;

  try {
    const metadata = await sock.groupMetadata(groupJid);
    return metadata.participants.some(participant => participant.id === participantJid);
  } catch (error) {
    console.warn(`Could not verify participant ${participantJid} in ${groupJid}:`, error.message);
    return false;
  }
}

// معالجة المنشن المعلقة - إذا كان هناك منشن في الرسالة
export async function handlePendingMention(sock, jid, sender, msg) {
  if (!(msg.message?.extendedTextMessage?.contextInfo?.mentionedJid && pendingMentions[jid])) return false;

  const mentionedJids = msg.message.extendedTextMessage.contextInfo.mentionedJid;
  const pendingData = pendingMentions[jid];

  if (mentionedJids.length === 0) return false;

  const mentionedJid = mentionedJids[0];
  // استخراج المنشن الحقيقي من النص
  const text = msg.message.extendedTextMessage.text || '';
  const mentionRegex = /(@\w+)/g;
  const mentions = text.match(mentionRegex);
  const realMention = mentions && mentions.length > 0 ? getCleanMentionTextForUser(mentions[0]) : getCleanMentionTextForUser(mentionedJid);

  // معالجة التبليغ عن الإساءة
  if (pendingData.action === 'report_mention') {
    // حفظ بيانات التبليغ والانتظار لسبب التبليغ
    pendingData.accusedJid = mentionedJid;
    pendingData.accusedMention = realMention;
    pendingData.action = 'awaiting_report_reason'; // تغيير الحالة

    await sock.sendMessage(jid, {
      text: dashboardReply('reply_f00173bca4450e6a')`📝 *تم تحديد الشخص المسيء: ${realMention}*\n\n📋 الآن، الرجاء إرسال سبب التبليغ:\n\n💡 (وصف مختصر للإساءة أو السلوك غير المناسب)`
    });

    return true;
  }

  const kingdom = getKingdomIdFromGroupJid(jid);
  const result = await extractAndSaveUserFromMention(sock, jid, mentionedJid, pendingData.nickname, kingdom);

  if (result) {
    // حفظ المنشن الحقيقي في البيانات المعلقة
    pendingData.mentionedJid = mentionedJid;
    pendingData.realMention = realMention;
    // تنفيذ الإجراء المعلق
    if (pendingData.action === 'welcoming') {
      const welcomeMessage = buildWelcomeFormMessage({
        nickname: result.nickname,
        user: result,
        userJid: pendingData.mentionedJid,
        moderatorName: pendingData.moderatorName,
        kingdom
      });

      // إذا كان هناك صورة، أرسل الترحيب مع الصورة
      if (pendingData.hasImage && pendingData.imageUrl) {
        try {
          // ✅ إرسال الصورة مع رسالة الترحيب
          await sock.sendMessage(jid, {
            image: { url: pendingData.imageUrl },
            caption: welcomeMessage
          });
          console.log(`✅ تم إرسال ترحيب مع صورة للعضو ${result.nickname}`);
        } catch (imageError) {
          console.error('⚠️ خطأ في إرسال الصورة، جاري الإرسال بدونها:', imageError.message);
          // إرسال بدون صورة كبديل
          await sock.sendMessage(jid, {
            text: welcomeMessage,
            mentions: [pendingData.mentionedJid]
          });
        }
      } else {
        // أرسل رسالة الترحيب (بدون صورة)
        await sock.sendMessage(jid, {
          text: welcomeMessage,
          mentions: [pendingData.mentionedJid]
        });
      }

      console.log(`✅ تم إرسال رسالة ترحيب للعضو ${result.nickname}`);
      if (pendingData.moderatorJid || pendingData.adminJid) {
        const kingdomData = getKingdomFromGroupJid(jid);
        const mainGroupJid = pendingData.mainGroupJid || kingdomData?.mainGroup;
        const sentToMainGroup = mainGroupJid && jid === mainGroupJid;
        const memberExistsInMain = sentToMainGroup
          ? await isParticipantInGroup(sock, mainGroupJid, pendingData.mentionedJid)
          : false;

        if (memberExistsInMain) {
          await recordSuccessfulWelcome(pendingData.moderatorJid || pendingData.adminJid, kingdom);
        }
      }
    } else if (pendingData.action === 'promotion') {
      // تنفيذ الترقية
      const kingdom = getKingdomIdFromGroupJid(jid);
      const { promoteModerator } = await import('../commands/adminSystem.js');
      await promoteModerator(sock, jid, result.nickname, pendingData.adminJid, pendingData.mentionedJid, kingdom);
    } else if (pendingData.action === 'assign_mention') {
      // معالجة تعيين المنشن
      const { handleAssignMention } = await import('../commands/adminSystem.js');
      await handleAssignMention(sock, jid, sender, mentionedJid, pendingData.nickname, pendingData.realMention);
    } else if (pendingData.action === 'change_mention') {
      // معالجة تغيير المنشن
      const { handleChangeMention } = await import('../commands/adminSystem.js');
      await handleChangeMention(sock, jid, sender, mentionedJid, pendingData.nickname, pendingData.realMention);
    } else if (pendingData.action === 'retrieveNickname') {
      // معالجة استرجاع/إنشاء اللقب للعضو المنشن عليه
      const { retrieveOrCreateNickname } = await import('../commands/adminSystem.js');
      await retrieveOrCreateNickname(sock, jid, mentionedJid);
    }
  }

  // حذف الحالة المعلقة
  delete pendingMentions[jid];
  return true;
}

// معالجة انتظار سبب التبليغ
export async function handleReportReason(sock, jid, sender, text, kingdom) {
  if (!(pendingMentions[jid] && pendingMentions[jid].action === 'awaiting_report_reason')) return false;

  const reportData = pendingMentions[jid];
  const reportReason = text.trim();

  if (!reportReason) {
    await sock.sendMessage(jid, {
      text: dashboardReply('reply_9992d425e73f89dc')(['❌ الرجاء إرسال سبب التبليغ بشكل صحيح!'])
    });
    return true;
  }

  // الحصول على بيانات المبلِّغ والمتهم
  const { KINGDOMS } = await import('../config.js');
  const kingdomData = KINGDOMS[kingdom];
  const adminGroupJid = kingdomData?.adminGroup;

  if (!adminGroupJid) {
    await sock.sendMessage(jid, {
      text: dashboardReply('reply_1515b798e522c0f3')(['❌ خطأ: لم يتم تحديد مجموعة الإدارة!'])
    });
    delete pendingMentions[jid];
    return true;
  }

  // الحصول على معلومات المبلِّغ
  const reporter = await User.findOne({ jid: sender, kingdom_id: kingdom });
  const reporterName = reporter?.nickname || sender.split('@')[0];

  // محاولة الحصول على معلومات المتهم
  const accused = await User.findOne({ jid: reportData.accusedJid, kingdom_id: kingdom });
  const accusedName = accused?.nickname || reportData.accusedMention || reportData.accusedJid.split('@')[0];

  // إنشاء رسالة التبليغ
  const reportMessage = dashboardReply('reply_83efd0a23755d397')`📢 *تبليغ جديد عن إساءة* 📢

━━━━━━━━━━━━━━━━━━━━━
👤 **المبلِّغ:**
   • الاسم: ${reporterName}
   • الرقم: ${reportData.reporterJid}

🚨 **الشخص المسيء:**
   • الاسم: ${accusedName}
   • المنشن: ${reportData.accusedMention}
   • الرقم: ${reportData.accusedJid}

📝 **سبب التبليغ:**
   ${reportReason}

⏰ **التاريخ والوقت:**
   ${new Date().toLocaleDateString('ar-SA')} - ${new Date().toLocaleTimeString('ar-SA')}
━━━━━━━━━━━━━━━━━━━━━

⚠️ هذا التبليغ يتطلب انتباه الأداريين!`;

  // إرسال رسالة التبليغ لمجموعة الإدارة
  try {
    await sock.sendMessage(adminGroupJid, {
      text: reportMessage,
      mentions: [reportData.accusedJid]
    });

    // تأكيد استلام التبليغ
    await sock.sendMessage(jid, {
      text: dashboardReply('reply_626e8423c26d6b59')`✅ *تم استلام تبليغك*\n\n🔔 تم إرسال التبليغ إلى الأداريين\n📋 سيتم النظر في الأمر في أقرب وقت\n\nشكراً لك على مساعدتك في الحفاظ على بيئة صحية! 🙏`
    });

    console.log(`📢 تبليغ جديد من ${reporterName} عن ${accusedName} - السبب: ${reportReason}`);
  } catch (error) {
    console.error('خطأ في إرسال التبليغ:', error);
    await sock.sendMessage(jid, {
      text: dashboardReply('reply_b800495d3ca38672')(['❌ حدث خطأ في إرسال التبليغ. الرجاء المحاولة لاحقاً.'])
    });
  }

  // حذف الحالة المعلقة
  delete pendingMentions[jid];
  return true;
}
