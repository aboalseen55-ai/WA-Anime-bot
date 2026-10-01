// حد يومي لاستخدام الذكاء الاصطناعي لكل شخص، حتى لا تفلت فاتورة Gemini
import AssistantProfile from "../database/assistantProfileModel.js";
import { ADMINS, DEVELOPER_JIDS } from "../config.js";
import { DEFAULT_TIME_ZONE, getTimeZoneParts } from "./quran.js";

const TIME_ZONE = process.env.PERSONAL_REMINDER_TIMEZONE || DEFAULT_TIME_ZONE;

export function getDailyLimit() {
  const value = Number(process.env.ASSISTANT_DAILY_LIMIT);
  return Number.isFinite(value) && value >= 0 ? value : 30;
}

export function localDayKey(now = new Date(), timeZone = TIME_ZONE) {
  const { year, month, day } = getTimeZoneParts(now, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isUnlimitedUser(jid) {
  return DEVELOPER_JIDS.includes(jid) || ADMINS.includes(jid);
}

/**
 * يحجز استخدامًا واحدًا لهذا اليوم.
 * يعيد { allowed, remaining, limit, notify } حيث notify تعني أول رفض في اليوم (لإرسال تنبيه مرة واحدة فقط).
 */
export async function consumeAssistantQuota(jid, now = new Date()) {
  const limit = getDailyLimit();
  if (isUnlimitedUser(jid) || limit === 0) return { allowed: true, remaining: Infinity, limit, notify: false };

  const day = localDayKey(now);
  // يوم جديد: صفّر العدّاد
  await AssistantProfile.updateOne(
    { jid, usageDay: { $ne: day } },
    { $set: { usageDay: day, usageCount: 0 } }
  );
  const updated = await AssistantProfile.findOneAndUpdate(
    { jid, usageDay: day, usageCount: { $lt: limit } },
    { $set: { usageDay: day }, $inc: { usageCount: 1 } },
    { new: true }
  ).lean().catch(() => null);

  if (updated) return { allowed: true, remaining: Math.max(0, limit - updated.usageCount), limit, notify: false };

  // المستخدم غير موجود بعد: أنشئه بأول استخدام
  const existing = await AssistantProfile.findOne({ jid }).lean();
  if (!existing) {
    await AssistantProfile.create({ jid, usageDay: day, usageCount: 1 }).catch(() => null);
    return { allowed: true, remaining: limit - 1, limit, notify: false };
  }

  const notice = await AssistantProfile.updateOne(
    { jid, limitNoticeDay: { $ne: day } },
    { $set: { limitNoticeDay: day } }
  );
  return { allowed: false, remaining: 0, limit, notify: notice.modifiedCount > 0 };
}

export function quotaExceededMessage(limit) {
  return `⏳ وصلت للحد اليومي (${limit}) لطلبات الذكاء الاصطناعي. يتجدد الحد بكرة إن شاء الله.\nالتذكيرات والمهام والملاحظات بتضل شغالة عادي.`;
}
