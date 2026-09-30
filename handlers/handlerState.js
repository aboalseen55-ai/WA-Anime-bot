// حالات مشتركة بين معالج الرسائل والأوامر

// نظام الحالات - لتتبع الأوامر المعلقة التي تحتاج تأكيد منشن
export const pendingMentions = {};

// نظام الحالات - لتتبع المستخدمين الذين ينتظرون اختيار قائمة الألعاب
export const awaitingGameChoice = new Set();

// نظام الحالات - لتتبع المستخدمين الذين ينضرون لاختيار قائمة الأوامر
export const awaitingCommandsChoice = new Set();

// نظام الحالات - لتتبع الأدمنز الذين ينتظرون كلمة السر لمنح رتبة الإمبراطور
export const awaitingEmperorPassword = new Map();

// نظام الحالات - لتتبع المستخدمين الجدد الذين ينتظرون تسجيل لقبهم
export const awaitingNicknameRegistration = new Set();

// نظام الحالات - لتتبع طلبات حذف بيانات المطرودين
export const pendingKick = {};

// نظام الحالات - لتتبع مراحل التسجيل المتقدمة
// { userJid: { stage: 'sourceInput'|'nicknameInput'|'nicknameConfirmation'|'enteringSource', nickname: string, enteringSource: string } }
export const nicknameRegistrationStages = {};

// نظام الحالات - لتتبع الأدمنز الذين ينتظرون إرسال صورة الترحيب
export const awaitingWelcomeImage = {};
