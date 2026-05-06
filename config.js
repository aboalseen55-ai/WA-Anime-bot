export const ADMINS = [
  "133595041648682@lid",
  "144856999555116@lid",
  "186123062128649@lid",
  "962795137282@s.whatsapp.net"
];

export const ADMIN_PASSWORD = "gojo2026"; // كلمة مرور تعيين الأدمن

// ========================================
// ⚙️ إعدادات النظام
// ========================================
export const ENABLE_MOTIVATIONAL_MESSAGES = false; // تفعيل/إيقاف الرسائل التحفيزية التلقائية

export const GREETINGS = [
  "السلام عليكم",
  "مرحبا",
  "أهلا",
  "مساء الخير",
  "صباح الخير",
  "كيف حالك؟",
  "أتمنى لك يوماً رائعاً",
  "مرحباً بك في مجموعتنا",
  "سعيد برؤيتك هنا",
  "أتمنى لك وقتاً ممتعاً معنا"
];

export const GROUP_JID = "120363410637522055@g.us"; // استبدل بـ JID الجماعة الفعلي

// رابط الإعلان/الترحيب الافتراضي
export const WELCOME_LINK = "https://chat.whatsapp.com/LUChKf1Xnm5FEeEvBrUn94"; // استبدل بالرابط الجديد عند الحاجة

// مجموعة الاستقبال للتسجيل التلقائي للألقاب
export const RECEPTION_GROUP_JID = "120363424110401057@g.us"; // استبدل بـ JID مجموعة الاستقبال إذا كانت مختلفة

// ========================================
// 🏰 نظام المملكات (Kingdoms) - Multi-Kingdom Support
// ========================================
export const KINGDOMS = {
  clover: {
    id: 'clover',
    name: '🍀 مملكة كلوفر',
    mainGroup: "120363410637522055@g.us",  // المجموعة الرئيسية لكلوفر
    receptionGroup: "120363424110401057@g.us", // مجموعة استقبال لكلوفر
    workGroup: "120363425084240015@g.us", // مجموعة الوورك (لنماذج الترحيب)
    groupIds: [
      "120363410637522055@g.us",      // المجموعة الرئيسية
      "120363424110401057@g.us"      // مجموعة الاستقبال
    ],
    adminGroup: "120363425063189388@g.us",  // المجموعة الإدارية لتقارير الألعاب
    admins: ADMINS,
    bankStartingBalance: 1000000
  },

  // ⭐ مثال: إضافة مملكة جديدة
  golden: {
    id: 'golden',
    name: '👑 مملكة الشيوخ',
    mainGroup: "120363343443001024@g.us", // استبدل بالـ JID الفعلي للمجموعة الرئيسية
    receptionGroup: "120363426900814166@g.us",
    workGroup: "", // اختياري: مجموعة الوورك إذا كنت تريد نماذج الترحيب
    groupIds: [
      "120363343443001024@g.us" // أضف جميع المجموعات المرتبطة بهذه المملكة هنا
    ],
    adminGroup: "120363409550189527@g.us", // مجموعة الأدمن لهذه المملكة
    admins: [...ADMINS], // يمكنك تخصيص قائمة الأدمنز هنا
    bankStartingBalance: 500000
  },

  snow: {
    id: 'snow',
    name: '❄️ مملكة سنو',
    mainGroup: "120363425993114553@g.us",
    receptionGroup: "120363426900814166@g.us",
    workGroup: "", // اختياري: مجموعة الوورك إذا كنت تريد نماذج الترحيب
    groupIds: [
      "120363425993114553@g.us",
      "120363426900814166@g.us",
      "120363409550189527@g.us"
    ],
    adminGroup: "120363409550189527@g.us",
    admins: [...ADMINS],
    bankStartingBalance: 500000
  }
  
  // أضف مملكات إضافية هنا عند الحاجة:
  // anotherKingdom: {
  //   id: 'anotherKingdom',
  //   name: '🏰 اسم المملكة',
  //   mainGroup: "12036...@g.us",
  //   groupIds: ["12036...@g.us"],
  //   admins: [...],
  //   bankStartingBalance: 500000
  // }
};

// دالة للحصول على معلومات المملكة من JID المجموعة
export function getKingdomFromGroupJid(groupJid) {
  for (const [kingdomId, kingdomData] of Object.entries(KINGDOMS)) {
    if (kingdomData.groupIds.includes(groupJid)) {
      return kingdomData;
    }
  }
  // افتراضياً، أرجع المملكة الأولى (clover) للتوافق مع البيانات القديمة
  return KINGDOMS.clover;
}

// دالة للحصول على معرّف المملكة من JID
export function getKingdomIdFromGroupJid(groupJid) {
  return getKingdomFromGroupJid(groupJid)?.id || 'clover';
}