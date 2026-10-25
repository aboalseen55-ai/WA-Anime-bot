// كلام عادي للمساعد (مكتوب أو مفرّغ من فويس): نفس الترتيب بالحالتين
import { featureEnabled } from "../services/botControls.js";
import { personalEnabled } from "../services/botMode.js";
import { handleSamBotInteraction } from "./samBotIntelligence.js";
import { handleNaturalExpense } from "./expenses.js";
import { handleNaturalExpenseQuestion } from "./expenseInsights.js";
import { handleDailyPlanReply, handleNaturalDailyPlan } from "./dailyPlan.js";

export async function handleAssistantText(sock, jid, sender, text, msg) {
  const trimmedText = String(text || "").trim();
  if (personalEnabled()) {
    // "خلصت" / "لسا" رد على سؤال خطة اليوم
    if (await handleDailyPlanReply(sock, jid, sender, trimmedText)) return true;
    // "صرفت 5 على قهوة" بالخاص = مصروف، مش ملاحظة
    if (await handleNaturalExpense(sock, jid, sender, trimmedText)) return true;
    // "قديش صرفت على البنزين هالشهر؟" بيجاوبها الذكاء من سجل المصاريف
    if (await handleNaturalExpenseQuestion(sock, jid, sender, trimmedText)) return true;
    // "بكرة بدي أروح عالبنك الساعة 10 وأخلص التقرير" = خطة يوم
    if (await handleNaturalDailyPlan(sock, jid, sender, trimmedText)) return true;
  }
  if (featureEnabled("ai")) return handleSamBotInteraction(sock, jid, sender, text, msg);
  return false;
}
