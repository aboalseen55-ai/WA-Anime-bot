// سكريبت لإصلاح الفهارس في قاعدة البيانات
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './database/userModel.js';

dotenv.config();

async function fixIndexes() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/animebot');
    
    console.log('🔍 جاري البحث عن الفهارس...');
    
    // الحصول على جميع الفهارس الحالية
    const indexes = await User.collection.getIndexes();
    console.log('📋 الفهارس الحالية:', Object.keys(indexes));
    
    // حذف الفهرس القديم nickname_1 إذا كان موجود
    if (indexes.nickname_1) {
      console.log('🗑️  جاري حذف الفهرس القديم: nickname_1');
      await User.collection.dropIndex('nickname_1');
      console.log('✅ تم حذف الفهرس القديم');
    } else {
      console.log('ℹ️  الفهرس القديم غير موجود');
    }
    
    // إعادة إنشاء الفهارس الصحيحة
    console.log('🔄 جاري إعادة إنشاء الفهارس الصحيحة...');
    await User.syncIndexes();
    
    // التحقق من الفهارس الجديدة
    const newIndexes = await User.collection.getIndexes();
    console.log('✅ الفهارس الجديدة:', Object.keys(newIndexes));
    
    console.log('\n✅ تم إصلاح الفهارس بنجاح!');
    process.exit(0);
  } catch (error) {
    console.error('❌ خطأ:', error.message);
    process.exit(1);
  }
}

fixIndexes();
