// utils/backup.js
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

export async function createBackup() {
  try {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const backupDir = path.join(process.cwd(), 'backups');

    // إنشاء مجلد النسخ الاحتياطية إذا لم يكن موجوداً
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupFile = path.join(backupDir, `backup-${timestamp}.json`);

    // جلب جميع البيانات
    const collections = ['users', 'banks']; // أضف المجموعات الأخرى حسب الحاجة
    const backupData = {};

    for (const collection of collections) {
      try {
        const Model = mongoose.model(collection);
        const data = await Model.find({});
        backupData[collection] = data.map(doc => doc.toObject());
      } catch (error) {
        logger.warn(`فشل في backup المجموعة ${collection}:`, error.message);
      }
    }

    // حفظ النسخة الاحتياطية
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));

    logger.info(`✅ تم إنشاء نسخة احتياطية: ${backupFile}`);

    // حذف النسخ الاحتياطية القديمة (أقدم من 7 أيام)
    cleanupOldBackups(backupDir);

    return backupFile;

  } catch (error) {
    logger.error('خطأ في إنشاء النسخة الاحتياطية:', error);
    throw error;
  }
}

function cleanupOldBackups(backupDir) {
  try {
    const files = fs.readdirSync(backupDir);
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtime.getTime() > sevenDaysMs) {
        fs.unlinkSync(filePath);
        logger.info(`🗑️ تم حذف النسخة الاحتياطية القديمة: ${file}`);
      }
    }
  } catch (error) {
    logger.error('خطأ في تنظيف النسخ الاحتياطية القديمة:', error);
  }
}

// تشغيل backup يومي عند منتصف الليل
export function scheduleDailyBackup() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0); // منتصف الليل التالي

  const timeUntilMidnight = midnight.getTime() - now.getTime();

  setTimeout(() => {
    createBackup();
    // تكرار كل 24 ساعة
    setInterval(createBackup, 24 * 60 * 60 * 1000);
  }, timeUntilMidnight);

  logger.info(`⏰ تم جدولة النسخ الاحتياطية اليومية في منتصف الليل`);
}
