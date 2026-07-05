import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  // منشن خاص مرتبط باللقب
  mention: {
    type: String,
    default: null
  },

  jid: {
    type: String,
    required: true
  },

  // 🏰 المملكة التي ينتمي إليها العضو
  kingdom_id: {
    type: String,
    // قيمة المملكة (مثلاً: clover، golden)
    // لا نعتمد على enum لسهولة إضافة مملكات جديدة دون الحاجة لتعديل الموديل.
    default: 'clover'
  },

  nickname: {
    type: String,
    required: true,
    index: true
  },

  // 💰 النقاط الخاصة بالألعاب (تحويل من النجوم)
  points: {
    type: Number,
    default: 0
  },

  // 🎖️ نجوم الرتبة لكل مملكة منفصلة
  rankStarsByKingdom: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({
      clover: 0,
      golden: 0,
      snow: 0
    })
  },

  // 🏦 عملات البنك
  bankCoins: {
    type: Number,
    default: 0
  },

  // 🔄 هل تم نقل البيانات من stars إلى points؟
  migrated: {
    type: Boolean,
    default: false
  },

  // 💰 العملات الخاصة بالعضو
  coins: {
    type: Number,
    default: 0
  },

  // 🎖️ رتبة العضو: 'member', 'moderator', 'admin', 'super_admin'
  // member: عضو عادي
  // moderator: مشرف (ترقية من عضو)
  // admin: أدمن (ترقية من مشرف)
  // super_admin: أدمن رئيسي (تعيين مباشر من الconfig)
  role: {
    type: String,
    enum: ['member', 'moderator', 'admin', 'super_admin'],
    default: 'member'
  },

  // 👑 رتبة المملكة لكل مملكة منفصلة
  kingdomRankByKingdom: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({
      clover: null,
      golden: null,
      snow: null
    })
  },

  // 🎁 هل الرتبة ممنوحة من الامبراطور (لا تتغير بالنجوم)
  isRankGranted: {
    type: Boolean,
    default: false
  },

  // 🔄 تفعيل الترقية التلقائية للرتب
  autoRankPromotion: {
    type: Boolean,
    default: true
  },

  // 🔄 هل غير اللقب من قبل؟
  nicknameChanged: {
    type: Boolean,
    default: false
  },

  // � رقم الهاتف للمنشن والاتصال
  phoneNumber: {
    type: String,
    default: null
  },
  // رقم الـ @lid (إذا كان المستخدم مسجل بحقل lid بدلاً من رقم واتساب)
  lid: {
    type: String,
    default: null
  },
  // 👤 اسم الواتساب
  whatsappName: {
    type: String,
    default: null
  },

  // 🔗 من طرف من دخل المجموعة؟
  enteringSource: {
    type: String,
    default: null
  },

  groups: [{
    type: String,
    default: []
  }],

  // 🚫 هل محظور؟
  isBanned: {
    type: Boolean,
    default: false
  },

  // 📝 تاريخ الحظر
  bannedAt: {
    type: Date,
    default: null
  },

  // 📋 سبب الحظر
  banReason: {
    type: String,
    default: null
  },

  // 🎂 تاريخ الميلاد
  birthDate: {
    type: Date,
    default: null
  },

  // 🖼️ صورة الترحيب (يتم استدعاؤها عند الترحيب)
  welcomeImage: {
    type: Object,
    default: null
  },

  // 📊 نظام تتبع الرسائل اليومي
  dailyMessages: {
    type: Number,
    default: 0
  },
  // 📅 تاريخ آخر تجديد لعداد الرسائل اليومية
  lastMessageResetDate: {
    type: Date,
    default: () => new Date()
  },
  // � نظام تتبع الألعاب للأعضاء الإداريين
  gamesSessions: [{
    gameName: String,           // اسم اللعبة (انمي، شخصيات، etc)
    startTime: Date,            // وقت البداية
    endTime: Date,              // وقت النهاية (null إذا كانت جارية)
    duration: Number,           // المدة بالثوانيّ
    startedBy: String           // اسم الشخص الذي بدأ اللعبة (للمرجعية)
  }],

  // 📅 تاريخ آخر تجديد لسجل الألعاب (للتقرير اليومي)
  lastGamesResetDate: {
    type: Date,
    default: () => new Date()
  },

  createdAt: {
    type: Date,
    default: Date.now
  }

});

// إنشاء indexes للأداء
userSchema.index({ kingdom_id: 1, nickname: 1 }, { unique: true });
userSchema.index({ kingdom_id: 1, jid: 1 });
userSchema.index({ kingdom_id: 1, role: 1 });

export default mongoose.models.User || mongoose.model("User", userSchema);
