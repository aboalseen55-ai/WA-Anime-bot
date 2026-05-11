import User from "../database/userModel.js";
import { ADMINS } from "../config.js";

export async function adminCommands(sock, jid, sender, text) {

  if (!ADMINS.includes(sender)) return;

  const args = text.trim().split(" ");
  const command = args[0];

  // عرض المستخدمين
  if (command === "/مستخدمين") {
    const users = await User.find({});
    if (!users.length) {
      await sock.sendMessage(jid, { text: "لا يوجد مستخدمين مسجلين." });
      return;
    }

    let msg = "📋 قائمة المستخدمين:\n\n";
    users.forEach((u, i) => {
      msg += `${i + 1}- لقب: ${u.nickname}\nID: ${u.jid}\n💰 نقاط: ${u.points || 0}\n\n`;
    });

    await sock.sendMessage(jid, { text: msg });
  }

  // تغيير لقب مستخدم
  if (command === "/تغييرلقب") {
    const target = args[1];
    const nick = args.slice(2).join(" ");
    if (!target || !nick) {
      await sock.sendMessage(jid, {
        text: "الاستخدام:\n/تغييرلقب (اللقب القديم أو الرقم) اللقب الجديد"
      });
      return;
    }

    // البحث عن المستخدم بـ jid أو اللقب القديم
    let user = await User.findOne({ jid: target });
    if (!user) {
      user = await User.findOne({ nickname: target });
    }

    if (!user) {
      await sock.sendMessage(jid, { text: "المستخدم غير موجود." });
      return;
    }

    // التحقق من أن اللقب الجديد غير مستخدم
    const existingUser = await User.findOne({ nickname: nick });
    if (existingUser && existingUser.nickname !== user.nickname) {
      await sock.sendMessage(jid, { text: `❌ هذا اللقب مستخدم بالفعل!` });
      return;
    }

    user.nickname = nick;
    await user.save();
    await sock.sendMessage(jid, { text: `✅ تم تغيير اللقب إلى ${nick}` });
  }

  // حذف مستخدم نهائيًا
  if (command === "/حذفمستخدم") {
    const target = args[1];
    if (!target) {
      await sock.sendMessage(jid, { text: "الاستخدام:\n/حذفمستخدم (اللقب أو الرقم)" });
      return;
    }

    // البحث عن المستخدم بـ jid أو اللقب
    let user = await User.findOne({ jid: target });
    if (!user) {
      user = await User.findOne({ nickname: target });
    }

    if (!user) {
      await sock.sendMessage(jid, { text: "المستخدم غير موجود." });
      return;
    }

    await User.deleteOne({ nickname: user.nickname });
    await sock.sendMessage(jid, { text: `✅ تم حذف المستخدم نهائيًا.` });
  }

  // فحص حالة البوت
  if (command === "/حالة" || command === "/health") {
    const { healthCheck } = await import("../utils/healthCheck.js");
    const health = await healthCheck(sock);

    let statusEmoji = health.status === 'healthy' ? '🟢' : '🔴';
    let msg = `${statusEmoji} حالة البوت: ${health.status === 'healthy' ? 'ممتازة' : 'تحتاج انتباه'}\n\n`;

    msg += `👥 المستخدمون: ${health.checks.users?.count || 'غير معروف'}\n`;
    msg += `💾 الذاكرة: ${health.checks.memory?.used || 'غير معروف'}\n`;
    msg += `⏱️ وقت التشغيل: ${health.checks.uptime?.uptime || 'غير معروف'}\n`;
    msg += `📱 WhatsApp: ${health.checks.whatsapp?.status === 'ok' ? 'متصل ✅' : 'غير متصل ❌'}\n`;

    if (health.error) {
      msg += `\n❌ خطأ: ${health.error}`;
    }

    await sock.sendMessage(jid, { text: msg });
  }

  // إنشاء نسخة احتياطية
  if (command === "/backup" || command === "/نسخةاحتياطية") {
    try {
      const { createBackup } = await import("../utils/backup.js");
      const backupFile = await createBackup();

      await sock.sendMessage(jid, {
        text: `✅ تم إنشاء النسخة الاحتياطية بنجاح!\n📁 الملف: ${backupFile}`
      });
    } catch (error) {
      await sock.sendMessage(jid, {
        text: `❌ فشل في إنشاء النسخة الاحتياطية: ${error.message}`
      });
    }
    }
  }

  // عرض إحصائيات البوت
  if (command === "/stats" || command === "/إحصائيات") {
    const { metrics } = await import("../utils/metrics.js");
    const stats = metrics.getStats();

    let msg = `📊 إحصائيات البوت:\n\n`;
    msg += `⏱️ وقت التشغيل: ${Math.floor(stats.uptime / 3600)}س ${Math.floor((stats.uptime % 3600) / 60)}د ${stats.uptime % 60}ث\n`;
    msg += `💬 الرسائل المعالجة: ${stats.messagesProcessed}\n`;
    msg += `⚡ الأوامر المنفذة: ${stats.commandsExecuted}\n`;
    msg += `🎮 الألعاب المبدأة: ${stats.gamesStarted}\n`;
    msg += `👥 المستخدمون المسجلون: ${stats.usersRegistered}\n`;
    msg += `❌ الأخطاء: ${stats.errorsCount}\n`;
    msg += `⚡ متوسط وقت الاستجابة: ${stats.avgResponseTime}ms\n`;

    await sock.sendMessage(jid, { text: msg });
  }

}