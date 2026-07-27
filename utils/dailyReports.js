import User from "../database/userModel.js";
import { KINGDOMS } from "../config.js";
import { sendAdminsDailyReports, resetDailyGameStats } from "../commands/adminSystem.js";

const DEFAULT_REPORT_TIME_ZONE = process.env.DAILY_REPORT_TIME_ZONE || "Asia/Amman";
const REPORT_HOUR = Number(process.env.DAILY_REPORT_HOUR ?? 0);
const REPORT_MINUTE = Number(process.env.DAILY_REPORT_MINUTE ?? 0);

export function getKingdomReportTimeZone(kingdomData = {}) {
  return kingdomData.timeZone || kingdomData.timezone || DEFAULT_REPORT_TIME_ZONE;
}

function getTimeZoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - date.getTime();
}

function zonedTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  const firstUtc = utcGuess - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(new Date(firstUtc), timeZone);
  return new Date(utcGuess - secondOffset);
}

export function getNextDailyReportDate(timeZone = DEFAULT_REPORT_TIME_ZONE) {
  const now = new Date();
  const parts = getTimeZoneParts(now, timeZone);
  const hour = Number.isFinite(REPORT_HOUR) ? REPORT_HOUR : 0;
  const minute = Number.isFinite(REPORT_MINUTE) ? REPORT_MINUTE : 0;
  let target = zonedTimeToUtc(parts.year, parts.month, parts.day, hour, minute, 0, timeZone);

  if (target <= now) {
    target = zonedTimeToUtc(parts.year, parts.month, parts.day + 1, hour, minute, 0, timeZone);
  }

  return target;
}

/**
 * إنشاء تقرير يومي شامل للمملكة
 * ويُرسل للقروب الأساسي حتى يرى الأعضاء النشاط العام
 */
export async function generateDailyReport(sock, kingdom = 'clover') {
  try {
    const kingdomData = KINGDOMS[kingdom];
    if (!kingdomData) {
      console.error(`❌ مملكة ${kingdom} غير موجودة`);
      return;
    }

    const mainGroupJid = kingdomData.mainGroup;
    if (!mainGroupJid) {
      console.warn(`⚠️ لا يوجد قروب أساسي للمملكة ${kingdom}؛ لن يتم إرسال تقرير النشاط العام.`);
      return;
    }

    // جلب جميع المستخدمين في المملكة
    const users = await User.find({ kingdom_id: kingdom }).sort({ dailyMessages: -1, dailyGameAnswers: -1 });

    if (users.length === 0) {
      console.log(`⚠️ لا توجد مستخدمين في المملكة ${kingdom}`);
      return;
    }

    // بناء التقرير
    let reportMessage = `*📊 تقرير اليوم لمملكة ${kingdomData.name}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*📅 التاريخ:* ${new Date().toLocaleDateString('ar-EG')}

*👥 نشاط الأعضاء:*
*━━━━━━━━━━━━━━━━━━━━*`;

    // أفضل 10 مستخدمين نشاطاً
    const topUsers = users.filter(u => u.dailyMessages > 0).slice(0, 10);
    
    if (topUsers.length === 0) {
      reportMessage += `

⚠️ لم يكن هناك نشاط اليوم`;
    } else {
      reportMessage += `

*🏆 أكثر الأعضاء تفاعلاً:*
`;
      
      topUsers.forEach((user, index) => {
        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        reportMessage += `${emoji} *${user.nickname}* - 💬 ${user.dailyMessages} رسالة\n`;
      });
    }

    const topGamePlayers = users
      .filter(u => (Number(u.dailyGameAnswers) || 0) > 0)
      .sort((a, b) => {
        const answersDiff = (Number(b.dailyGameAnswers) || 0) - (Number(a.dailyGameAnswers) || 0);
        if (answersDiff !== 0) return answersDiff;
        return (Number(b.dailyGameXp) || 0) - (Number(a.dailyGameXp) || 0);
      })
      .slice(0, 10);

    if (topGamePlayers.length > 0) {
      reportMessage += `

*🎮 ترتيب الألعاب:*
`;

      topGamePlayers.forEach((user, index) => {
        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const answers = Number(user.dailyGameAnswers) || 0;
        const gameXp = Number(user.dailyGameXp) || 0;
        reportMessage += `${emoji} *${user.nickname}* - ✅ ${answers} إجابة | ✨ ${gameXp} XP\n`;
      });
    }

    // إحصائيات عامة
    const totalMessages = users.reduce((sum, u) => sum + u.dailyMessages, 0);
    const activeUsersCount = users.filter(u => u.dailyMessages > 0).length;
    const averageMessages = activeUsersCount > 0 ? Math.round(totalMessages / activeUsersCount) : 0;
    const totalGameAnswers = users.reduce((sum, u) => sum + (Number(u.dailyGameAnswers) || 0), 0);
    const activeGamePlayersCount = users.filter(u => (Number(u.dailyGameAnswers) || 0) > 0).length;
    const totalDailyGameXp = users.reduce((sum, u) => sum + (Number(u.dailyGameXp) || 0), 0);

    reportMessage += `

*📈 الإحصائيات العامة:*
━━━━━━━━━━━━━━━━━━━━
• إجمالي الرسائل: 💬 ${totalMessages}
• المستخدمين النشطين: 👥 ${activeUsersCount}
• متوسط الرسائل: 📊 ${averageMessages}
• إجابات الألعاب: ✅ ${totalGameAnswers}
• لاعبو الألعاب: 🎮 ${activeGamePlayersCount}
• XP الألعاب اليوم: ✨ ${totalDailyGameXp}

🔄 تم تجديد العدادات لليوم الجديد!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 شكراً على نشاطكم المستمر! 🌟`;

    await sock.sendMessage(mainGroupJid, { text: reportMessage });
    console.log(`✅ تم إرسال تقرير النشاط اليومي للمملكة ${kingdom} إلى القروب الأساسي`);

  } catch (error) {
    console.error('❌ خطأ في إنشاء التقرير اليومي:', error.message);
  }
}

async function runKingdomDailyReports(sock, kingdomId) {
  const kingdomData = KINGDOMS[kingdomId];
  if (!kingdomData) return;
  const timeZone = getKingdomReportTimeZone(kingdomData);

  if (kingdomData.adminGroup) {
    await sendAdminsDailyReports(sock, kingdomData.adminGroup, kingdomId, timeZone);
  } else {
    console.warn(`⚠️ لا يوجد قروب إدارة للمملكة ${kingdomId}؛ لن يتم إرسال تقرير الإدارة.`);
  }

  await generateDailyReport(sock, kingdomId);
  await resetDailyGameStats(kingdomId, timeZone);
}

/**
 * جدولة التقرير اليومي باستخدام setTimeout
 * يُرسل كل يوم عند 12:00 منتصف الليل حسب توقيت المملكة
 */
export function scheduleDailyReports(sock) {
  try {
    function scheduleNextReport(kingdomId) {
      const kingdomData = KINGDOMS[kingdomId];
      if (!kingdomData) return;

      const timeZone = getKingdomReportTimeZone(kingdomData);
      const nextReport = getNextDailyReportDate(timeZone);
      const timeUntilReport = Math.max(1000, nextReport.getTime() - Date.now());

      console.log(`✅ التقرير اليومي التالي لمملكة ${kingdomId} في ${nextReport.toLocaleString('ar-EG', { timeZone })} (${timeZone})`);

      setTimeout(async () => {
        console.log(`🔔 بدء إرسال التقارير اليومية لمملكة ${kingdomId}...`);
        await runKingdomDailyReports(sock, kingdomId);
        console.log(`✅ انتهى إرسال التقارير اليومية لمملكة ${kingdomId}`);
        scheduleNextReport(kingdomId);
      }, timeUntilReport);
    }

    for (const kingdomId of Object.keys(KINGDOMS)) {
      scheduleNextReport(kingdomId);
    }

    console.log('✅ تم تفعيل جدولة التقارير اليومية حسب توقيت كل مملكة');
  } catch (error) {
    console.error('❌ خطأ في جدولة التقارير اليومية:', error.message);
  }
}

/**
 * إرسال تقرير فوري (للاختبار أو الطلب اليدوي)
 */
export async function sendInstantReport(sock, kingdom = 'clover') {
  await generateDailyReport(sock, kingdom);
}
