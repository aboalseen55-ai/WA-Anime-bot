import { dashboardReply } from '../services/dashboardTemplates.js';

// نظام الحالات - لتتبع الرسائل المرسلة للتشجيع على الوصول لـ 50 عضو
const milestoneMessagesSent = new Set();

// دالة للتحقق من عدد الأعضاء وإرسال رسالة التشجيع
export async function checkAndSendMilestoneMessage(sock, jid, kingdom) {
  try {
    // التحقق من تفعيل الرسائل التحفيزية
    const { ENABLE_MOTIVATIONAL_MESSAGES } = await import('../config.js');
    if (!ENABLE_MOTIVATIONAL_MESSAGES) {
      return; // الرسائل التحفيزية معطلة
    }

    // التحقق من أن هذا القروب الأساسي للمملكة
    const { KINGDOMS } = await import('../config.js');
    const kingdomData = KINGDOMS[kingdom];
    if (!kingdomData || kingdomData.mainGroup !== jid) {
      return; // ليس القروب الأساسي
    }

    // عد أعضاء القروب
    const groupMetadata = await sock.groupMetadata(jid);
    const memberCount = groupMetadata.participants.length;

    // إرسال رسائل تشجيع قبل الوصول لـ 50 عضو
    await sendMotivationalMessages(sock, jid, memberCount, kingdom);

    // إذا وصلنا إلى 50 عضو، أرسل الرسالة النهائية
    if (memberCount >= 50) {
      if (!milestoneMessagesSent.has(`${kingdom}_50_members`)) {
        const encouragementMessage = dashboardReply('reply_8e51e477ff1bb8b7')`🎉 *مبروك! وصلتم إلى 50 عضو!*

تفاعل جميل من الجميع، وشغل مرتب من الإدارة.

استمروا بنفس الهدوء والحضور الحلو.`;

        await sock.sendMessage(jid, { text: encouragementMessage });
        milestoneMessagesSent.add(`${kingdom}_50_members`);
        console.log(`✅ تم إرسال رسالة الوصول لـ 50 عضو لمملكة ${kingdom}`);
      }
    }
  } catch (error) {
    console.error('خطأ في إرسال رسالة التشجيع:', error);
  }
}

// دالة إرسال رسائل التحفيز قبل الوصول لـ 50 عضو
async function sendMotivationalMessages(sock, jid, memberCount, kingdom) {
  // التحقق من تفعيل الرسائل التحفيزية
  const { ENABLE_MOTIVATIONAL_MESSAGES } = await import('../config.js');
  if (!ENABLE_MOTIVATIONAL_MESSAGES) {
    return; // الرسائل التحفيزية معطلة
  }

  const motivationalMilestones = [
    { count: 40, messageKey: '40_members' },
    { count: 45, messageKey: '45_members' },
    { count: 48, messageKey: '48_members' },
    { count: 49, messageKey: '49_members' }
  ];

  for (const milestone of motivationalMilestones) {
    if (memberCount === milestone.count && !milestoneMessagesSent.has(`${kingdom}_${milestone.messageKey}`)) {
      const remaining = 50 - memberCount;
      const message = getMotivationalMessage(memberCount, remaining, kingdom);
      await sock.sendMessage(jid, { text: message });
      milestoneMessagesSent.add(`${kingdom}_${milestone.messageKey}`);
      console.log(`✅ تم إرسال رسالة التحفيز لـ ${memberCount} عضو لمملكة ${kingdom}`);
      break; // أرسل رسالة واحدة فقط في كل مرة
    }
  }
}

// دالة إنشاء رسالة التحفيز
function getMotivationalMessage(currentCount, remaining, kingdom) {
  const messages = {
    40: `🎉 وصلتم إلى 40 عضو.

باقي ${remaining} للوصول إلى 50.
استمروا بهدوء، التفاعل واضح.`,

    45: `👏 وصلتم إلى 45 عضو.

باقي ${remaining} فقط.
شغل جميل من الجميع.`,

    48: `✨ وصلتم إلى 48 عضو.

باقي ${remaining}.
قريبين جدًا، استمروا.`,

    49: `🎯 وصلتم إلى 49 عضو.

باقي عضو واحد للوصول إلى 50.
خطوة بسيطة وتكتمل.`
  };

  return messages[currentCount] || '';
}
