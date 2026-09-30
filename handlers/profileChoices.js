import { dashboardReply } from '../services/dashboardTemplates.js';
import { getDailyGameStats } from "../commands/adminSystem.js";
import User from "../database/userModel.js";
import { getKingdomIdFromGroupJid } from "../config.js";
import { pendingMentions } from "./handlerState.js";

// معالجة اختيارات الملف للأداريين (خيار بين معلومات والألعاب)
export async function handleProfileChoice(sock, jid, sender, text) {
  if (!(text === '1' || text === '2')) return false;

  // البحث عن حالة اختيار ملف شخص آخر في pendingMentions
  let profileChoiceKey = null;
  let profileData = null;

  if (pendingMentions) {
    for (const key in pendingMentions) {
      if (key.startsWith('profile_choice_') && pendingMentions[key].action === 'profile_choice') {
        profileChoiceKey = key;
        profileData = pendingMentions[key];
        break;
      }
    }
  }

  if (profileData && profileData.action === 'profile_choice') {
    if (text === '1') {
      // عرض المعلومات الأساسية
      try {
        const targetUser = await User.findOne({ jid: profileData.targetJid });
        if (targetUser) {
          const kingdom = getKingdomIdFromGroupJid(jid);
          const { getHighestRank, displayRank } = await import('../commands/rankSystem.js');
          const { ADMINS } = await import('../config.js');
          
          let roleEmoji = '👤';
          let roleText = 'عضو';
          if (targetUser.role === 'super_admin' || ADMINS.includes(targetUser.jid) || ADMINS.includes(targetUser.nickname)) {
            roleEmoji = '👑';
            roleText = 'أدمن رئيسي';
          } else if (targetUser.role === 'admin') {
            roleEmoji = '👑';
            roleText = 'أدمن';
          } else if (targetUser.role === 'moderator') {
            roleEmoji = '🔰';
            roleText = 'مشرف';
          }
          
          const rankStars = targetUser.rankStarsByKingdom?.[kingdom] || 0;
          const highestRank = getHighestRank(kingdom, rankStars);
          const kingdomRankDisplay = highestRank ? displayRank(kingdom, highestRank) : '❌ لا توجد رتبة';

          let message = dashboardReply('reply_60db564c72525f1b')`${roleEmoji} معلومات ${targetUser.nickname}\n`;
          message += dashboardReply('reply_2001c0b8598cc96d')`━━━━━━━━━━━━━━━━━\n`;
          message += dashboardReply('reply_2caada22edeff471')`📛 اللقب: ${targetUser.nickname}\n`;
          message += dashboardReply('reply_b7b24e6eb8ff39cd')`🎖️ الرتبة الإدارية: ${roleText}\n`;
          message += dashboardReply('reply_4b01dc17e4c5c9b8')`👑 رتبة المملكة: ${kingdomRankDisplay}\n`;
          message += dashboardReply('reply_915d7d05a5aa92c2')`✨ المستوى: ${targetUser.level || 0} (${targetUser.xp || 0} XP)\n`;
          message += dashboardReply('reply_1a58359ef430e494')`💰 النقاط: ${targetUser.points || 0}\n`;
          message += dashboardReply('reply_70052430aa8c3037')`🎖️ نجوم الرتب: ${rankStars}\n`;
          message += dashboardReply('reply_b21e9a811455a90c')`💰 العملات: ${targetUser.coins}\n`;
          message += dashboardReply('reply_855356fc4b7d9131')`🏦 البنك: ${targetUser.bankCoins || 0}\n`;
          message += dashboardReply('reply_3804823dac5811b4')`📊 إجمالي الرسائل: ${targetUser.totalMessages || 0}\n`;
          message += dashboardReply('reply_e2d874839b236d38')`📅 تاريخ الانضمام: ${targetUser.createdAt.toLocaleDateString('ar-EG')}\n`;

          if (targetUser.isBanned) {
            message += dashboardReply('reply_2b232273a1306537')`🚫 محظور - السبب: ${targetUser.banReason}\n`;
          }

          await sock.sendMessage(jid, { text: message });
        }
      } catch (error) {
        console.error('خطأ في عرض المعلومات:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_87bd76f679e89ee2')(['❌ حدث خطأ في عرض المعلومات!']) });
      }
    } else if (text === '2') {
      // عرض الألعاب المبدوءة اليوم
      try {
        const targetUser = await User.findOne({ jid: profileData.targetJid });
        if (targetUser) {
          const { gameStats, totalDuration, sessionCount } = getDailyGameStats(targetUser.jid, targetUser);
          
          if (sessionCount === 0) {
            await sock.sendMessage(jid, { 
              text: dashboardReply('reply_a1b55ebedab8924f')`📊 *الألعاب المبدوءة من قبل ${profileData.nickname}*\n\n✅ لم يبدأ أي لعبة اليوم`
            });
          } else {
            let report = dashboardReply('reply_559e912cbcfe1b93')`🎮 *الألعاب المبدوءة من قبل ${profileData.nickname}*\n\n`;
            report += dashboardReply('reply_acbe1b0d35a8d458')`📅 التاريخ: ${new Date().toLocaleDateString('ar-SA')}\n\n`;

            let gameIndex = 1;
            for (const [gameName, stats] of Object.entries(gameStats)) {
              const hours = Math.floor(stats.totalDuration / 3600);
              const minutes = Math.floor((stats.totalDuration % 3600) / 60);
              const seconds = stats.totalDuration % 60;

              let timeStr = '';
              if (hours > 0) timeStr += `${hours}س `;
              if (minutes > 0) timeStr += `${minutes}د `;
              if (seconds > 0 || timeStr === '') timeStr += `${seconds}ث`;

              report += dashboardReply('reply_f23f8a2807ccf4be')`${gameIndex}️⃣ *${gameName}*\n`;
              report += dashboardReply('reply_d38aee45698f524c')`   • عدد الجلسات: ${stats.count}\n`;
              report += dashboardReply('reply_fd32e654623a89ed')`   • الوقت الإجمالي: ${timeStr}\n\n`;
              gameIndex++;
            }

            // المجموع الكلي
            const totalHours = Math.floor(totalDuration / 3600);
            const totalMinutes = Math.floor((totalDuration % 3600) / 60);
            const totalSeconds = totalDuration % 60;

            let totalTimeStr = '';
            if (totalHours > 0) totalTimeStr += `${totalHours}س `;
            if (totalMinutes > 0) totalTimeStr += `${totalMinutes}د `;
            if (totalSeconds > 0 || totalTimeStr === '') totalTimeStr += `${totalSeconds}ث`;

            report += dashboardReply('reply_420ee8eba5c787a6')`⏱️ *الإجمالي*\n`;
            report += dashboardReply('reply_a781f3e20f4b732b')`   • إجمالي الجلسات: ${sessionCount}\n`;
            report += dashboardReply('reply_50d4de67b2bc3ae7')`   • الوقت الكلي: ${totalTimeStr}`;

            await sock.sendMessage(jid, { text: report });
          }
        }
      } catch (error) {
        console.error('خطأ في عرض الألعاب:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_7e6b5f8582959039')(['❌ حدث خطأ في عرض الألعاب!']) });
      }
    }

    // حذف الحالة المعلقة
    delete pendingMentions[profileChoiceKey];
    return true;
  }

  // معالجة ملفي (الملف الشخصي)
  const myProfileChoiceKey = `my_profile_choice_${sender}`;
  const myProfileData = pendingMentions[myProfileChoiceKey];

  if (myProfileData && myProfileData.action === 'my_profile_choice') {
    if (text === '1') {
      // عرض المعلومات الأساسية
      try {
        const { showUserStats } = await import('../commands/adminSystem.js');
        const kingdom = getKingdomIdFromGroupJid(jid);
        await showUserStats(sock, jid, myProfileData.nickname, kingdom);
      } catch (error) {
        console.error('خطأ في عرض المعلومات الأساسية:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_19814631abda7076')(['❌ حدث خطأ في عرض المعلومات الأساسية.']) });
      }
    } else if (text === '2') {
      // عرض الألعاب الخاصة بك
      try {
        const targetUser = await User.findOne({ jid: myProfileData.targetJid });
        if (targetUser) {
          const { gameStats, totalDuration, sessionCount } = getDailyGameStats(targetUser.jid, targetUser);
          
          if (sessionCount === 0) {
            await sock.sendMessage(jid, { 
              text: dashboardReply('reply_376b781a98e231c3')`📊 *جلسات الألعاب الخاصة بك*\n\n✅ لم تبدأ أي لعبة اليوم`
            });
          } else {
            let report = dashboardReply('reply_7ffad7424826c746')`🎮 *جلسات الألعاب الخاصة بك*\n\n`;
            report += dashboardReply('reply_acbe1b0d35a8d458')`📅 التاريخ: ${new Date().toLocaleDateString('ar-SA')}\n\n`;

            let gameIndex = 1;
            for (const [gameName, stats] of Object.entries(gameStats)) {
              const hours = Math.floor(stats.totalDuration / 3600);
              const minutes = Math.floor((stats.totalDuration % 3600) / 60);
              const seconds = stats.totalDuration % 60;

              let timeStr = '';
              if (hours > 0) timeStr += `${hours}س `;
              if (minutes > 0) timeStr += `${minutes}د `;
              if (seconds > 0 || timeStr === '') timeStr += `${seconds}ث`;

              report += dashboardReply('reply_f23f8a2807ccf4be')`${gameIndex}️⃣ *${gameName}*\n`;
              report += dashboardReply('reply_d38aee45698f524c')`   • عدد الجلسات: ${stats.count}\n`;
              report += dashboardReply('reply_fd32e654623a89ed')`   • الوقت الإجمالي: ${timeStr}\n\n`;
              gameIndex++;
            }

            // المجموع الكلي
            const totalHours = Math.floor(totalDuration / 3600);
            const totalMinutes = Math.floor((totalDuration % 3600) / 60);
            const totalSeconds = totalDuration % 60;

            let totalTimeStr = '';
            if (totalHours > 0) totalTimeStr += `${totalHours}س `;
            if (totalMinutes > 0) totalTimeStr += `${totalMinutes}د `;
            if (totalSeconds > 0 || totalTimeStr === '') totalTimeStr += `${totalSeconds}ث`;

            report += dashboardReply('reply_420ee8eba5c787a6')`⏱️ *الإجمالي*\n`;
            report += dashboardReply('reply_a781f3e20f4b732b')`   • إجمالي الجلسات: ${sessionCount}\n`;
            report += dashboardReply('reply_50d4de67b2bc3ae7')`   • الوقت الكلي: ${totalTimeStr}`;

            await sock.sendMessage(jid, { text: report });
          }
        }
      } catch (error) {
        console.error('خطأ في عرض الألعاب:', error);
        await sock.sendMessage(jid, { text: dashboardReply('reply_7e6b5f8582959039')(['❌ حدث خطأ في عرض الألعاب!']) });
      }
    }

    // حذف الحالة المعلقة
    delete pendingMentions[myProfileChoiceKey];
    return true;
  }

  return false;
}
