import { classifyIdentifier, getMentionFromJID } from "../commands/adminSystem.js";
import User from "../database/userModel.js";
import { featureEnabled } from '../services/botControls.js';
import { buildLevelUpMessage, trackChatActivity } from "../utils/xpSystem.js";

// ============================================
// 📊 تتبع الرسائل اليومية في القروب الأساسي
// ============================================
// ترجع معرف المملكة إذا أمكن تحديده
export async function trackMainGroupActivity(sock, msg, jid, sender, text) {
  let kingdom;
  let kingdomData;

  try {
    const { getKingdomIdFromGroupJid } = await import('../config.js');
    const { KINGDOMS } = await import('../config.js');
    kingdom = getKingdomIdFromGroupJid(jid);
    kingdomData = KINGDOMS[kingdom];


    // تتبع الرسائل من المجموعة الرئيسية فقط
    if (featureEnabled('tracking') && kingdomData && kingdomData.mainGroup === jid && !msg.key.fromMe) {
      try {
        let user = await User.findOne({ jid: sender, kingdom_id: kingdom });

        if (!user) {
          console.log(`[DEBUG] المستخدم غير موجود: ${sender}، جاري الإنشاء...`);
          const identifier = classifyIdentifier(sender);
          user = new User({
            jid: identifier.jid || sender,
            kingdom_id: kingdom,
            nickname: sender.split('@')[0],
            phoneNumber: identifier.identifierType === 'phone_jid' ? identifier.phoneNumber : null,
            lid: identifier.identifierType === 'lid_jid' || identifier.identifierType === 'raw_lid' ? identifier.lid : null,
            rawLid: identifier.identifierType === 'raw_lid' ? identifier.rawLid : null,
            identifierType: identifier.identifierType,
            countryCode: identifier.countryCode,
            countryName: identifier.countryName,
            mention: getMentionFromJID(identifier.jid || sender),
            dailyMessages: 1,
            lastMessageResetDate: new Date()
          });
        } else {
          // تحديث الرسائل اليومية
          user.dailyMessages = (user.dailyMessages || 0) + 1;
          user.lastMessageResetDate = new Date();
        }

        const xpResult = trackChatActivity(user, text, new Date());

        // ✅ حفظ فوري للبيانات
        await user.save();
        console.log(`📊 [${user.nickname}] رسائل اليوم: ${user.dailyMessages} | XP: ${user.xp || 0} | Level: ${user.level || 0}`);

        if (xpResult.leveledUp) {
          await sock.sendMessage(jid, {
            text: buildLevelUpMessage(user, xpResult),
            mentions: [user.jid]
          });
        }

      } catch (error) {
        console.error('❌ خطأ في تتبع الرسائل اليومية:', error.message);
      }
    }
  } catch (importError) {
    console.error('❌ خطأ في استيراد البيانات:', importError.message);
  }

  return kingdom;
}
