import mongoose from "mongoose";

const bankSchema = new mongoose.Schema({
  // � المملكة التي يتبعها البنك
  kingdom: {
    type: String,
    // لا نعتمد على enum حتى يمكن إضافة ممالك جديدة بسهولة
    default: 'clover',
    unique: true,
    required: true
  },

  // 🏦 إجمالي عملات البنك
  totalCoins: {
    type: Number,
    default: 1000000
  },

  // 📊 إحصائيات
  transactions: [{
    type: {
      type: String,
      enum: ['deposit', 'withdraw', 'transfer'],
      required: true
    },
    userJid: {
      type: String,
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],

  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.models.Bank || mongoose.model("Bank", bankSchema);