// utils/validation.js
export function sanitizeInput(input) {
  if (typeof input !== 'string') return '';

  // إزالة المحتوى الخطر
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // إزالة scripts
    .replace(/<[^>]*>/g, '') // إزالة HTML tags
    .replace(/javascript:/gi, '') // إزالة javascript: URLs
    .replace(/on\w+\s*=/gi, '') // إزالة event handlers
    .trim()
    .substring(0, 1000); // حد أقصى 1000 حرف
}

export function validateJid(jid) {
  // التحقق من صحة JID
  const jidRegex = /^(\d+)@(s\.whatsapp\.net|g\.us)$/;
  return jidRegex.test(jid);
}

export function validateNickname(nickname) {
  if (!nickname || typeof nickname !== 'string') return false;

  const cleanNick = nickname.trim();

  // شروط التحقق
  if (cleanNick.length < 2 || cleanNick.length > 50) return false;
  if (!/^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFFa-zA-Z0-9\s_-]+$/.test(cleanNick)) return false;

  // كلمات محظورة
  const bannedWords = ['admin', 'bot', 'system', 'null', 'undefined'];
  if (bannedWords.some(word => cleanNick.toLowerCase().includes(word))) return false;

  return true;
}

export function validateCommand(command) {
  if (!command || typeof command !== 'string') return false;

  // يجب أن يبدأ بـ /
  if (!command.startsWith('/')) return false;

  // لا يحتوي على مسافات في البداية
  if (command.trim() !== command) return false;

  // طول مناسب
  if (command.length < 2 || command.length > 100) return false;

  return true;
}

export function rateLimitCheck(jid, action = 'general') {
  // يمكن توسيع هذا للتحقق من rate limiting
  return true; // للآن
}
