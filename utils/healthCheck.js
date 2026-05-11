// utils/healthCheck.js
import mongoose from 'mongoose';
import User from '../database/userModel.js';

export async function healthCheck(sock) {
  const health = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    checks: {}
  };

  try {
    // فحص قاعدة البيانات
    await mongoose.connection.db.admin().ping();
    health.checks.database = { status: 'ok', latency: Date.now() };

    // فحص عدد المستخدمين
    const userCount = await User.countDocuments();
    health.checks.users = { status: 'ok', count: userCount };

    // فحص اتصال WhatsApp
    if (sock?.user) {
      health.checks.whatsapp = { status: 'ok', user: sock.user.id };
    } else {
      health.checks.whatsapp = { status: 'disconnected' };
      health.status = 'degraded';
    }

    // فحص الذاكرة
    const memUsage = process.memoryUsage();
    health.checks.memory = {
      status: 'ok',
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB'
    };

    // فحص وقت التشغيل
    health.checks.uptime = {
      status: 'ok',
      uptime: Math.round(process.uptime()) + 's'
    };

  } catch (error) {
    health.status = 'unhealthy';
    health.error = error.message;
  }

  return health;
}

// دالة لإرسال تقرير صحي يومي للأدمنز
export async function sendDailyHealthReport(sock, adminJids) {
  try {
    const health = await healthCheck(sock);

    const report = `📊 تقرير الصحة اليومي:

🟢 الحالة: ${health.status === 'healthy' ? 'ممتازة' : 'تحتاج انتباه'}

📈 المستخدمون: ${health.checks.users?.count || 'غير معروف'}
💾 الذاكرة: ${health.checks.memory?.used || 'غير معروف'}
⏱️ وقت التشغيل: ${health.checks.uptime?.uptime || 'غير معروف'}
📱 WhatsApp: ${health.checks.whatsapp?.status === 'ok' ? 'متصل' : 'غير متصل'}

${health.error ? '❌ خطأ: ' + health.error : ''}`;

    for (const adminJid of adminJids) {
      await sock.sendMessage(adminJid, { text: report });
    }

  } catch (error) {
    console.error('خطأ في إرسال تقرير الصحة:', error);
  }
}
