import User from "../database/userModel.js";
import { KINGDOMS } from "../config.js";

// ============================================
// رسالة التحديثات للإدارة
// ============================================
async function getAdminUpdateMessage() {
  try {
    // إحصائيات المستخدمين الجدد
    const totalUsers = await User.countDocuments();
    const cloverUsers = await User.countDocuments({ kingdom_id: 'clover' });
    const newUsersToday = await User.countDocuments({
      createdAt: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0))
      }
    });

    // إحصائيات التبليغات (إذا كانت محفوظة في النموذج)
    const usersWithPoints = await User.countDocuments({ points: { $gt: 0 } });
    const topPlayer = await User.findOne().sort({ points: -1 });

    // حساب الأعضاء النشيطين
    const activeUsersLast7Days = await User.countDocuments({
      lastActivityDate: {
        $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      }
    });

    const adminUpdateMessage = `🔔 *تحديث الإدارة - ${new Date().toLocaleDateString('ar-SA')}* 🔔

━━━━━━━━━━━━━━━━━━━━━━━

📊 *إحصائيات الأعضاء:*
├ 👥 إجمالي الأعضاء: ${totalUsers}
├ 🍀 أعضاء مملكة كلوفر: ${cloverUsers}
├ ⭐ الأعضاء الجدد اليوم: ${newUsersToday}
└ 🔥 النشيطون آخر 7 أيام: ${activeUsersLast7Days}

🎮 *إحصائيات الألعاب:*
├ 🏆 الأعضاء اللاعبين: ${usersWithPoints}
├ 🥇 أفضل لاعب: ${topPlayer ? topPlayer.nickname : 'لا يوجد'}
└ 💰 نقاط المتصدر: ${topPlayer ? topPlayer.points : '0'}

⚠️ *التنبيهات:*
├ 📢 تأكد من مراجعة التبليغات المعلقة
├ ✅ تحديث القوانين عند الحاجة
└ 🔐 راقب السلوكيات المشبوهة

📝 *ملاحظات مهمة:*
• تفقد مجموعة الإدارة بانتظام
• استجب للتبليغات بسرعة
• وفر تجربة آمنة للأعضاء

━━━━━━━━━━━━━━━━━━━━━━━

⏰ ${new Date().toLocaleTimeString('ar-SA')}
🍀 مملكة كلوفر - نظام الإدارة
`;

    return adminUpdateMessage;
  } catch (error) {
    console.error('❌ خطأ في إنشاء رسالة الإدارة:', error);
    return null;
  }
}

// ============================================
// رسالة التحديثات للأعضاء
// ============================================
function getMembersUpdateMessage() {
  const membersUpdateMessage = `📢 *تحديثات المملكة - ${new Date().toLocaleDateString('ar-SA')}* 📢

━━━━━━━━━━━━━━━━━━━━━━━

✨ *ميزات وتحديثات جديدة:* ✨

🎮 **الألعاب:**
├ 🎬 تخمين الأنمي - خمّن من الصور
├ 📝 لعبة الكلمات - تحسين إملائك
├ 🎭 تخمين الشخصيات - هل تعرفهم؟
├ 🔤 ترتيب الحروف - لعبة مثيرة
└ 🎯 تفكيك الكلمات - تحدٍ جديد

📊 **نظام التبليغات:**
├ 🚨 أبلِغ عن أي إساءة بـ: /تبليغ
├ ⚖️ استجابة سريعة من الإدارة
└ 🔒 تبليغك محمي وآمن

📖 **القوانين والمعلومات:**
├ 📋 اعرض القوانين: /قوانين
├ 👤 ملفك الشخصي: /ملفي
├ 🎊 كل الأوامر: /أوامر
└ 🏆 لوحة الترتيب: /ترتيب

💡 *نصائح مهمة:*
✅ اتبع القوانين لتجنب الإنذارات
✅ شارك بالألعاب واكسب نقاط
✅ كن محترماً مع الجميع
✅ استمتع مع أعضاء المملكة

🎯 **الأحداث القادمة:**
🔄 مسابقات ألعاب أسبوعية
🏅 جوائز للاعبين المتميزين
🎊 احتفالات وحفلات خاصة
🌟 ترقيات وترقيات جديدة

🏪 **🔥 متجر المملكة - قريباً جداً! 🔥**

✨ *نحن نعمل على تطوير متجر حصري للمملكة!*

📦 **الصناديق الخاصة:**
🎁 صندوق الذهب → عملات فاخرة
💎 صندوق الماس → قدرات خاصة
🌟 صندوق النجوم → مفاجآت حصرية
👑 صندوق الملك → امتيازات فريدة

💰 **المميزات:**
├ احصل على عملات المملكة
├ قدرات خاصة وحصرية
├ رتب جديدة وفريدة
├ امتيازات ملكية
└ مفاجآت يومية وأسبوعية

⏰ **قريباً على الجميع!** ⏰
🚀 تابع المملكة للإعلان الرسمي
🔔 ستكون النسخة الأولى حصرية للنشطاء

━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━

⚠️ **تذكيرات مهمة:**
🚫 ممنوع الإساءة لأي أحد
🚫 احترم المشرفين والإدارة
🚫 لا تنتهك القوانين
✅ كن عضواً مثالياً

━━━━━━━━━━━━━━━━━━━━━━━

🍀 *شكراً لتواجدك معنا!*
💫 معاً نبني مملكة أفضل 💫

⏰ ${new Date().toLocaleTimeString('ar-SA')}
👑 مملكة كلوفر - عائلة واحدة
`;

  return membersUpdateMessage;
}

// ============================================
// دالة الإرسال الرئيسية
// ============================================
export async function sendUpdates(sock) {
  try {
    if (!sock) {
      console.error('❌ خطأ: sock غير متاح. تأكد من اتصال البوت أولاً.');
      return;
    }

    const kingdom = KINGDOMS.clover;
    if (!kingdom) {
      console.error('❌ خطأ: لم يتم العثور على بيانات المملكة');
      return;
    }

    // الحصول على JIDs
    const adminGroupJid = kingdom.adminGroup;
    const mainGroupJid = kingdom.mainGroup;

    console.log('📤 جاري إرسال التحديثات...\n');

    // إرسال رسالة التحديثات للإدارة
    if (adminGroupJid) {
      try {
        const adminMessage = await getAdminUpdateMessage();
        if (adminMessage) {
          await sock.sendMessage(adminGroupJid, { text: adminMessage });
          console.log('✅ تم إرسال التحديثات للإدارة بنجاح! 📊');
        }
      } catch (adminError) {
        console.error('❌ خطأ في إرسال رسالة الإدارة:', adminError.message);
      }
    }

    // انتظار قليل بين الرسائل
    await new Promise(resolve => setTimeout(resolve, 1000));

    // إرسال رسالة التحديثات للأعضاء
    if (mainGroupJid) {
      try {
        const membersMessage = getMembersUpdateMessage();
        await sock.sendMessage(mainGroupJid, { text: membersMessage });
        console.log('✅ تم إرسال التحديثات للأعضاء بنجاح! 📢\n');
      } catch (membersError) {
        console.error('❌ خطأ في إرسال رسالة الأعضاء:', membersError.message);
      }
    }

    console.log('✅ اكتملت عملية إرسال جميع التحديثات! 🎉');
    console.log(`📝 تم الإرسال في: ${new Date().toLocaleTimeString('ar-SA')}\n`);

  } catch (error) {
    console.error('❌ خطأ عام في إرسال التحديثات:', error);
  }
}

// ============================================
// دالة مخصصة للأدمن لإرسال تحديثات مخصصة
// ============================================
export async function sendCustomUpdates(sock, adminMessage, membersMessage) {
  try {
    if (!sock) {
      console.error('❌ خطأ: sock غير متاح');
      return;
    }

    const kingdom = KINGDOMS.clover;
    const adminGroupJid = kingdom?.adminGroup;
    const mainGroupJid = kingdom?.mainGroup;

    console.log('📤 جاري إرسال التحديثات المخصصة...\n');

    if (adminMessage && adminGroupJid) {
      await sock.sendMessage(adminGroupJid, { text: adminMessage });
      console.log('✅ تم إرسال رسالة الإدارة المخصصة! 📊');
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    if (membersMessage && mainGroupJid) {
      await sock.sendMessage(mainGroupJid, { text: membersMessage });
      console.log('✅ تم إرسال رسالة الأعضاء المخصصة! 📢');
    }

    console.log('\n✅ اكتملت عملية الإرسال المخصص! 🎉\n');

  } catch (error) {
    console.error('❌ خطأ في إرسال التحديثات المخصصة:', error);
  }
}

// ============================================
// ============================================
// تشغيل السكريبت
// ============================================
// التحقق من تشغيل السكريبت مباشرة
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\n⏳ جاري تحضير نظام الإرسال...\n');

  // انتظار اتصال البوت
  setTimeout(async () => {
    if (global.sock) {
      await sendUpdates(global.sock);
    } else {
      console.error('❌ لم يتم الاتصال بالبوت.\n');
      console.error('💡 الخطوات الصحيحة:');
      console.error('   1️⃣ افتح تطبيق Terminal/CMD');
      console.error('   2️⃣ اكتب: node index.js');
      console.error('   3️⃣ افتح Terminal آخر');
      console.error('   4️⃣ اكتب: node scripts/sendUpdates.js\n');
      process.exit(1);
    }
  }, 2000);
}

export default sendUpdates;
