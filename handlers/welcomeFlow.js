import { dashboardReply } from '../services/dashboardTemplates.js';
import { buildWelcomeFormMessage, recordSuccessfulWelcome } from "../commands/adminSystem.js";
import { pendingMentions } from "./handlerState.js";

function findPendingByPrefix(prefix, action) {
  for (const key in pendingMentions) {
    if (key.startsWith(prefix) && pendingMentions[key].action === action) {
      return [key, pendingMentions[key]];
    }
  }
  return [null, null];
}

// معالجة اختيار صورة الترحيب (1️⃣ 2️⃣ 3️⃣ 4️⃣)
export async function handleWelcomeImageChoice(sock, jid, text) {
  if (!(text === '1' || text === '2' || text === '3' || text === '4')) return false;

  // البحث عن حالة اختيار الصور
  const [welcomeImagesKey, welcomeImagesData] = findPendingByPrefix('welcome_images_', 'welcome_images');
  if (!welcomeImagesData) return false;

  const selectedIndex = parseInt(text) - 1;
  
  if (selectedIndex < 0 || selectedIndex >= welcomeImagesData.imageBuffers.length) {
    await sock.sendMessage(jid, {
      text: dashboardReply('reply_9a93ad4c91b9475d')`❌ اختيار غير صحيح! الرجاء اختيار رقم بين 1️⃣ و ${welcomeImagesData.imageBuffers.length}️⃣`
    });
    return true;
  }

  const selectedImageBuffer = welcomeImagesData.imageBuffers[selectedIndex];
  const mainGroupJid = welcomeImagesData.mainGroupJid;
  const receptionGroupJid = welcomeImagesData.receptionGroupJid;
  
  console.log(`✅ تم اختيار الصورة ${parseInt(text)} للعضو ${welcomeImagesData.nickname}`);
  
  // التحقق من وجود العضو في المجموعة الأساسية
  try {
    const mainGroupMetadata = await sock.groupMetadata(mainGroupJid);
    const memberJids = mainGroupMetadata.participants.map(p => p.id);
    const memberExists = memberJids.includes(welcomeImagesData.userJid);

    if (!memberExists) {
      // إعلام الأدمن بعدم وجود العضو في المجموعة الأساسية
      const errorMessage = dashboardReply('reply_14489fb3a13a28e4')`❌ *خطأ في الترحيب*

لم يتم العثور على العضو *${welcomeImagesData.nickname}* في المجموعة الأساسية.

يُرجى التأكد من انضمام العضو إلى المجموعة الأساسية أولاً.`;

      await sock.sendMessage(receptionGroupJid, {
        text: errorMessage,
        mentions: [welcomeImagesData.moderatorJid]
      });

      console.warn(`⚠️ العضو ${welcomeImagesData.nickname} غير موجود في المجموعة الأساسية`);
      delete pendingMentions[welcomeImagesKey];
      return true;
    }

    const welcomeMessage = buildWelcomeFormMessage({
      nickname: welcomeImagesData.nickname,
      user: {
        jid: welcomeImagesData.userJid,
        mention: welcomeImagesData.mentionText
      },
      userJid: welcomeImagesData.userJid,
      moderatorName: welcomeImagesData.moderatorName,
      kingdom: welcomeImagesData.kingdom
    });

    try {
      // إرسال الترحيب مع الصورة المختارة إلى المجموعة الأساسية
      await sock.sendMessage(mainGroupJid, {
        image: selectedImageBuffer,
        caption: welcomeMessage,
        mentions: [welcomeImagesData.userJid]
      });
      console.log(`✅ تم إرسال ترحيب مع الصورة المختارة للعضو ${welcomeImagesData.nickname} إلى المجموعة الأساسية`);

      // تأكيد للأدمن في مجموعة الاستقبال بنجاح الترحيب
      await sock.sendMessage(receptionGroupJid, {
        text: dashboardReply('reply_f370b48298e1394c')`✅ *تم إرسال رسالة الترحيب بنجاح للعضو ${welcomeImagesData.nickname} إلى المجموعة الأساسية* ✨`,
        mentions: [welcomeImagesData.moderatorJid]
      });
      await recordSuccessfulWelcome(welcomeImagesData.moderatorJid, welcomeImagesData.kingdom);
    } catch (error) {
      console.error('❌ خطأ في إرسال الترحيب مع الصورة:', error.message);
      
      try {
        // محاولة الإرسال بدون صورة كبديل
        await sock.sendMessage(mainGroupJid, {
          text: welcomeMessage,
          mentions: [welcomeImagesData.userJid]
        });
        console.log(`⚠️ تم إرسال ترحيب بدون صورة للعضو ${welcomeImagesData.nickname} إلى المجموعة الأساسية`);

        await sock.sendMessage(receptionGroupJid, {
          text: dashboardReply('reply_28bc138e3781317c')`⚠️ *تم إرسال الترحيب بدون صورة للعضو ${welcomeImagesData.nickname}*\n\n📌 السبب: ${error.message}`,
          mentions: [welcomeImagesData.moderatorJid]
        });
        await recordSuccessfulWelcome(welcomeImagesData.moderatorJid, welcomeImagesData.kingdom);
      } catch (textError) {
        await sock.sendMessage(receptionGroupJid, {
          text: dashboardReply('reply_8661ce481a0428cf')`❌ *خطأ في إرسال رسالة الترحيب للعضو ${welcomeImagesData.nickname}*\n\n📌 الخطأ: ${textError.message}`,
          mentions: [welcomeImagesData.moderatorJid]
        });
      }
    }
  } catch (metadataError) {
    console.error('❌ خطأ في الحصول على بيانات المجموعة الأساسية:', metadataError.message);
    
    await sock.sendMessage(receptionGroupJid, {
      text: dashboardReply('reply_7b6d42379b05cc83')`❌ *خطأ في الترحيب - لم يتمكن من الوصول إلى المجموعة الأساسية*\n\n📌 الخطأ: ${metadataError.message}`,
      mentions: [welcomeImagesData.moderatorJid]
    });
  }

  // حذف الحالة المعلقة
  delete pendingMentions[welcomeImagesKey];
  return true;
}

// معالجة تأكيد الترحيب (1 للموافقة، 2 للإلغاء)
export async function handleWelcomeConfirmation(sock, jid, text) {
  if (!(text === '1' || text === '2')) return false;

  // البحث عن حالة تأكيد الترحيب
  const [welcomeConfirmKey, welcomeData] = findPendingByPrefix('welcome_confirm_', 'welcome_confirm');
  if (!welcomeData) return false;

  if (text === '1') {
    // الموافقة على الترحيب
    console.log(`✅ تم الموافقة على ترحيب ${welcomeData.nickname}`);
    
    const mainGroupJid = welcomeData.mainGroupJid;
    const receptionGroupJid = welcomeData.receptionGroupJid;

    // التحقق من وجود العضو في المجموعة الأساسية
    try {
      const mainGroupMetadata = await sock.groupMetadata(mainGroupJid);
      const memberJids = mainGroupMetadata.participants.map(p => p.id);
      const memberExists = memberJids.includes(welcomeData.userJid);

      if (!memberExists) {
        // إعلام الأدمن بعدم وجود العضو في المجموعة الأساسية
        const errorMessage = dashboardReply('reply_bb87d374deafddc7')`❌ *خطأ في الترحيب*

لم يتم العثور على العضو *${welcomeData.nickname}* في المجموعة الأساسية.

يُرجى التأكد من انضمام العضو إلى المجموعة الأساسية أولاً.`;

        await sock.sendMessage(receptionGroupJid, {
          text: errorMessage,
          mentions: [welcomeData.moderatorJid]
        });

        console.warn(`⚠️ العضو ${welcomeData.nickname} غير موجود في المجموعة الأساسية`);
        delete pendingMentions[welcomeConfirmKey];
        return true;
      }

      const welcomeMessage = buildWelcomeFormMessage({
        nickname: welcomeData.nickname,
        user: {
          jid: welcomeData.userJid,
          mention: welcomeData.mentionText
        },
        userJid: welcomeData.userJid,
        moderatorName: welcomeData.moderatorName,
        kingdom: welcomeData.kingdom
      });

      try {
        // أرسل رسالة الترحيب إلى المجموعة الأساسية
        await sock.sendMessage(mainGroupJid, {
          text: welcomeMessage,
          mentions: [welcomeData.userJid]
        });
        console.log(`✅ تم إرسال رسالة ترحيب بدون صورة للعضو ${welcomeData.nickname} إلى المجموعة الأساسية`);

        // تأكيد للأدمن في مجموعة الاستقبال بنجاح الترحيب
        await sock.sendMessage(receptionGroupJid, {
          text: dashboardReply('reply_92cfbfd5459d2bde')`✅ *تم إرسال رسالة الترحيب بنجاح للعضو ${welcomeData.nickname} إلى المجموعة الأساسية* ✨`,
          mentions: [welcomeData.moderatorJid]
        });
        await recordSuccessfulWelcome(welcomeData.moderatorJid, welcomeData.kingdom);
      } catch (error) {
        console.error('❌ خطأ في إرسال الترحيب:', error.message);
        await sock.sendMessage(receptionGroupJid, {
          text: dashboardReply('reply_f9fb7e4ce5429843')`❌ *خطأ في إرسال رسالة الترحيب للعضو ${welcomeData.nickname}*\n\n📌 الخطأ: ${error.message}`,
          mentions: [welcomeData.moderatorJid]
        });
      }
    } catch (metadataError) {
      console.error('❌ خطأ في الحصول على بيانات المجموعة الأساسية:', metadataError.message);
      
      await sock.sendMessage(receptionGroupJid, {
        text: dashboardReply('reply_7b6d42379b05cc83')`❌ *خطأ في الترحيب - لم يتمكن من الوصول إلى المجموعة الأساسية*\n\n📌 الخطأ: ${metadataError.message}`,
        mentions: [welcomeData.moderatorJid]
      });
    }
  } else if (text === '2') {
    // الرفض والإلغاء
    await sock.sendMessage(jid, {
      text: dashboardReply('reply_63cc3d123854a8fc')`❌ *تم إلغاء ترحيب العضو ${welcomeData.nickname}*`
    });
    console.log(`❌ تم إلغاء ترحيب ${welcomeData.nickname}`);
  }

  // حذف الحالة المعلقة
  delete pendingMentions[welcomeConfirmKey];
  return true;
}
