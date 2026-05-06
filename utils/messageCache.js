// وحدة بسيطة لتخزين أحدث رسائل كل مجموعة (jid) في الذاكرة.
// تُستخدم هذه الذاكرة لدعم عمليات مثل حذف عدة رسائل (مثلاً: /احذف 10).

const recentMessages = new Map(); // jid -> Array<messageKey>
const MAX_RECENT_MESSAGES = 80;

export function addRecentMessage(jid, messageKey) {
  if (!jid || !messageKey) return;

  if (!recentMessages.has(jid)) {
    recentMessages.set(jid, []);
  }

  const arr = recentMessages.get(jid);
  arr.push(messageKey);
  if (arr.length > MAX_RECENT_MESSAGES) {
    arr.shift();
  }
}

export function getRecentMessages(jid) {
  return recentMessages.get(jid) || [];
}

export function popRecentMessages(jid, count) {
  if (!recentMessages.has(jid)) return [];
  const arr = recentMessages.get(jid);
  const removed = arr.splice(-count, count);
  return removed || [];
}
