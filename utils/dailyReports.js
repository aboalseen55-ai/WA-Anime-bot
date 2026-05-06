import User from "../database/userModel.js";
import { KINGDOMS } from "../config.js";
import { sendAdminsDailyReports, resetDailyGameStats } from "../commands/adminSystem.js";

/**
 * إنشاء ديلي تقرير شامل لجميع المستخدمين
 * ويُرسل للقروب الإضافي ويُجدد العداد
 */
export async function generateDailyReport(sock, kingdom = 'clover') {
  try {
    const kingdomData = KINGDOMS[kingdom];
    if (!kingdomData) {
      console.error(`❌ مملكة ${kingdom} غير موجودة`);
      return;
    }

    // جلب جميع المستخدمين في المملكة
    const users = await User.find({ kingdom_id: kingdom }).sort({ dailyMessages: -1 });

    if (users.length === 0) {
      console.log(`⚠️ لا توجد مستخدمين في المملكة ${kingdom}`);
      return;
    }

    // بناء التقرير
    let reportMessage = `*📊 تقرير النشاط اليومي لمملكة ${kingdomData.name}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*📅 التاريخ:* ${new Date().toLocaleDateString('ar-EG')}

*👥 إحصائيات النشاط:*
*━━━━━━━━━━━━━━━━━━━━*`;

    // أفضل 10 مستخدمين نشاطاً
    const topUsers = users.filter(u => u.dailyMessages > 0).slice(0, 10);
    
    if (topUsers.length === 0) {
      reportMessage += `

⚠️ لم يكن هناك نشاط اليوم`;
    } else {
      reportMessage += `

*🏆 الأكثر نشاطاً:*
`;
      
      topUsers.forEach((user, index) => {
        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        reportMessage += `${emoji} *${user.nickname}* - 💬 ${user.dailyMessages} رسالة\n`;
      });
    }

    // إحصائيات عامة
    const totalMessages = users.reduce((sum, u) => sum + u.dailyMessages, 0);
    const activeUsersCount = users.filter(u => u.dailyMessages > 0).length;
    const averageMessages = activeUsersCount > 0 ? Math.round(totalMessages / activeUsersCount) : 0;

    reportMessage += `

*📈 الإحصائيات العامة:*
━━━━━━━━━━━━━━━━━━━━
• إجمالي الرسائل: 💬 ${totalMessages}
• المستخدمين النشطين: 👥 ${activeUsersCount}
• متوسط الرسائل: 📊 ${averageMessages}

🔄 تم تجديد العدادات لليوم الجديد!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 شكراً على نشاطكم المستمر! 🌟`;

    // إرسال التقرير للقروب الإضافي (أول قروب إضافي)
    const additionalGroupJid = kingdomData.groupIds && kingdomData.groupIds.length > 2 
      ? kingdomData.groupIds[2] 
      : kingdomData.mainGroup;

    if (additionalGroupJid && additionalGroupJid !== kingdomData.mainGroup) {
      await sock.sendMessage(additionalGroupJid, { text: reportMessage });
      console.log(`✅ تم إرسال التقرير اليومي للمملكة ${kingdom}`);
    } else {
      console.warn(`⚠️ لم يتم العثور على قروب إضافي للمملكة ${kingdom}`);
    }

    // 🔄 إعادة تعيين عدادات التفاعل بعد إرسال التقرير
    const usersToReset = await User.find({ kingdom_id: kingdom });
    for (const user of usersToReset) {
      user.dailyMessages = 0;
      user.lastMessageResetDate = new Date();
      await user.save();
    }

    console.log(`✅ تم تجديد العدادات لـ ${usersToReset.length} مستخدم`);

  } catch (error) {
    console.error('❌ خطأ في إنشاء التقرير اليومي:', error.message);
  }
}

/**
 * جدولة التقرير اليومي باستخدام setTimeout
 * يُرسل كل يوم في الساعة 11 مساءاً
 */
export function scheduleDailyReports(sock) {
  try {
    function scheduleNextReport() {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 0, 0); // 11:59 مساءً

      const timeUntilReport = tomorrow.getTime() - now.getTime();

      console.log(`✅ التقرير اليومي التالي سيُرسل في ${tomorrow.toLocaleString('ar-EG')}`);

      setTimeout(async () => {
        console.log('🔔 بدء إرسال التقارير اليومية...');
        
        // إرسال تقرير لكل مملكة
        for (const kingdomId of Object.keys(KINGDOMS)) {
          await generateDailyReport(sock, kingdomId);
        }

        // 🎮 إرسال تقارير الألعاب للأداريين
        console.log('🎮 بدء إرسال تقارير الألعاب للأداريين...');
        const kingdomData = KINGDOMS['clover'] || Object.values(KINGDOMS)[0];
        const adminGroupJid = kingdomData?.adminGroup || kingdomData?.groupIds?.[2];
        await sendAdminsDailyReports(sock, adminGroupJid);

        // 🔄 تصفير التفاعل اليومي لجميع المستخدمين (بدون حذف recentMessages)
        console.log('🔄 تصفير التفاعل اليومي لجميع المستخدمين...');
        await User.updateMany({}, { dailyMessages: 0 });

        // 🔄 إعادة تعيين إحصائيات الألعاب
        console.log('🔄 إعادة تعيين إحصائيات الألعاب...');
        await resetDailyGameStats();
        
        console.log('✅ انتهى إرسال التقارير اليومية');
        
        // جدولة التقرير التالي
        scheduleNextReport();
      }, timeUntilReport);
    }

    scheduleNextReport();
    console.log('✅ تم تفعيل جدولة التقارير اليومية (الساعة 11 مساءاً)');
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
