import mongoose from "mongoose";

// مصاريف شخصية لكل مستخدم (/مصروف، أو "صرفت 5 على قهوة" بالخاص)
const expenseSchema = new mongoose.Schema({
  userJid: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  label: { type: String, default: "" },
  // null = العملة الافتراضية (EXPENSE_CURRENCY)
  currency: { type: String, default: null },
  spentAt: { type: Date, default: Date.now }
}, { timestamps: true });

expenseSchema.index({ userJid: 1, spentAt: -1 });

export default mongoose.models.Expense || mongoose.model("Expense", expenseSchema);
