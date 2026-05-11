// utils/rateLimiter.js
class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.maxRequests = 10; // حد أقصى 10 رسائل
    this.windowMs = 60 * 1000; // في دقيقة واحدة
  }

  isAllowed(jid) {
    const now = Date.now();
    const userRequests = this.requests.get(jid) || [];

    // إزالة الطلبات القديمة
    const validRequests = userRequests.filter(time => now - time < this.windowMs);

    if (validRequests.length >= this.maxRequests) {
      return false; // تجاوز الحد
    }

    validRequests.push(now);
    this.requests.set(jid, validRequests);

    return true;
  }

  // تنظيف تلقائي كل 5 دقائق
  cleanup() {
    const now = Date.now();
    for (const [jid, requests] of this.requests.entries()) {
      const validRequests = requests.filter(time => now - time < this.windowMs);
      if (validRequests.length === 0) {
        this.requests.delete(jid);
      } else {
        this.requests.set(jid, validRequests);
      }
    }
  }
}

export const rateLimiter = new RateLimiter();

// تنظيف دوري
setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);
