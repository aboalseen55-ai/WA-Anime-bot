// utils/userCache.js
import User from '../database/userModel.js';

class UserCache {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 دقائق
  }

  async get(jid, kingdom_id) {
    const key = `${jid}-${kingdom_id}`;
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.user;
    }

    // جلب من قاعدة البيانات
    const user = await User.findOne({ jid, kingdom_id });
    if (user) {
      this.cache.set(key, { user: user.toObject(), timestamp: Date.now() });
    }

    return user;
  }

  async invalidate(jid, kingdom_id) {
    const key = `${jid}-${kingdom_id}`;
    this.cache.delete(key);
  }

  async update(jid, kingdom_id, updateData) {
    const user = await User.findOneAndUpdate(
      { jid, kingdom_id },
      updateData,
      { new: true, upsert: true }
    );

    // تحديث الـ cache
    const key = `${jid}-${kingdom_id}`;
    this.cache.set(key, { user: user.toObject(), timestamp: Date.now() });

    return user;
  }
}

export const userCache = new UserCache();

// تنظيف الـ cache كل ساعة
setInterval(() => {
  userCache.cache.clear();
  console.log('🧹 تم تنظيف cache المستخدمين');
}, 60 * 60 * 1000);
