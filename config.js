import "dotenv/config";

export const DEVELOPER_PHONE = "962795137282";
export const DEVELOPER_JID = `${DEVELOPER_PHONE}@s.whatsapp.net`;
const DEFAULT_EXTRA_DEVELOPER_JIDS = [
  "186123062128649@lid"
];

export const DEVELOPER_JIDS = [
  DEVELOPER_JID,
  ...DEFAULT_EXTRA_DEVELOPER_JIDS,
  ...((process.env.DEVELOPER_JIDS || "")
    .split(",")
    .map(jid => jid.trim())
    .filter(Boolean))
].filter((jid, index, list) => jid && list.indexOf(jid) === index);

export const KINGDOM_CODE_RECIPIENT_JIDS = [
  DEVELOPER_JID,
  ...DEFAULT_EXTRA_DEVELOPER_JIDS,
  ...((process.env.KINGDOM_CODE_RECIPIENT_JIDS || "")
    .split(",")
    .map(jid => jid.trim())
    .filter(Boolean))
].filter((jid, index, list) => jid && list.indexOf(jid) === index);

export const ADMINS = [
  "133595041648682@lid",
  "144856999555116@lid",
  "186123062128649@lid",
  DEVELOPER_JID
];

export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ""; // كلمة مرور تعيين الأدمن
export const ADMIN_PASSWORD_CONFIGURED = ADMIN_PASSWORD.length > 0;

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

export const GROUP_JID = "120363408312945031@g.us"; // استبدل بـ JID الجماعة الفعلي

// رابط الإعلان/الترحيب الافتراضي
export const WELCOME_LINK = "https://chat.whatsapp.com/LUChKf1Xnm5FEeEvBrUn94"; // استبدل بالرابط الجديد عند الحاجة

// مجموعة الاستقبال للتسجيل التلقائي للألقاب
export const RECEPTION_GROUP_JID = "120363424110401057@g.us"; // استبدل بـ JID مجموعة الاستقبال إذا كانت مختلفة

// ========================================
// 🏰 نظام المملكات (Kingdoms) - Multi-Kingdom Support
// ========================================
// لا توجد ممالك افتراضية في الكود. قاعدة البيانات هي المصدر الوحيد،
// ويتم إنشاء/تعديل/حذف الممالك من واتساب بواسطة المطور.
export const DEFAULT_KINGDOMS = {};

export const KINGDOMS = JSON.parse(JSON.stringify(DEFAULT_KINGDOMS));

export function replaceKingdoms(nextKingdoms) {
  for (const key of Object.keys(KINGDOMS)) {
    delete KINGDOMS[key];
  }

  Object.assign(KINGDOMS, nextKingdoms);
}

// دالة للحصول على معلومات المملكة من JID المجموعة
export function getKingdomFromGroupJid(groupJid) {
  for (const [kingdomId, kingdomData] of Object.entries(KINGDOMS)) {
    if (kingdomData.groupIds.includes(groupJid) || kingdomData.mainGroup === groupJid || kingdomData.receptionGroup === groupJid || kingdomData.adminGroup === groupJid || kingdomData.workGroup === groupJid) {
      return kingdomData;
    }
  }
  return null;
}

// دالة للحصول على معرّف المملكة من JID
export function getKingdomIdFromGroupJid(groupJid) {
  return getKingdomFromGroupJid(groupJid)?.id || null;
}
