// قائمة الأوامر التفاعلية بشكل مختصر ومرتب
import { isAdmin, isModerator } from "./adminSystem.js";
import { getKingdomIdFromGroupJid } from "../config.js";

const MENU_BULLET = "▪️";

function commandLine(command, description) {
  return `${MENU_BULLET} ${command} — ${description}`;
}

function section(title, commands) {
  return [`\n*${title}*`, ...commands.map(([command, description]) => commandLine(command, description))].join("\n");
}

function buildMenu(title, sections, footer = "اكتب /أوامر للرجوع.") {
  return [`*${title}*`, ...sections, `\n${footer}`].join("\n").trim();
}

export async function showCommandsList(sock, jid, sender) {
  const kingdom = getKingdomIdFromGroupJid(jid);
  const userIsAdmin = await isAdmin(sender, kingdom);
  const userIsModerator = await isModerator(sender, kingdom);

  const rows = [
    ["1", "👤", "أوامر الأعضاء"],
    ["2", "🎮", "أوامر الألعاب"],
    ["3", "💰", "البنك والعملات"]
  ];

  if (userIsModerator) rows.push(["4", "🛡️", "أوامر المشرفين"]);
  if (userIsAdmin) {
    rows.push(["5", "👑", "أوامر الأدمن"]);
    rows.push(["6", "⭐", "الرتب والنجوم"]);
  }
  rows.push(["7", "🔎", "البحث والمعلومات"]);

  const text = [
    "*📋 قائمة الأوامر*",
    "اختر رقم القائمة:",
    "",
    ...rows.map(([number, emoji, label]) => `${emoji} ${number}. ${label}`),
    "",
    "اكتب الرقم فقط."
  ].join("\n");

  await sock.sendMessage(jid, { text });
}

async function showMemberCommands(sock, jid) {
  const msg = buildMenu("👤 أوامر الأعضاء", [
    section("الملف", [
      ["/لقبي <اللقب>", "تسجيل لقبك"],
      ["/ملفي", "عرض ملفك"],
      ["/مستواي", "مستوى XP"],
      ["/معرف", "معرفك بالنظام"],
      ["/اعادة", "حذف بياناتك"]
    ]),
    section("التواصل", [
      ["/منشن <لقب>", "منشن عضو"],
      ["/من @منشن", "معرفة اللقب"],
      ["/مشرفين", "قائمة الإدارة"]
    ]),
    section("المناسبات", [
      ["/تسجيل_عيد_ميلاد <تاريخ>", "حفظ الميلاد"],
      ["/معايدة <لقب>", "تهنئة ميلاد"]
    ])
  ]);

  await sock.sendMessage(jid, { text: msg });
}

async function showGamesCommands(sock, jid) {
  const msg = buildMenu("🎮 أوامر الألعاب", [
    section("التشغيل", [
      ["/ألعاب", "قائمة الألعاب"],
      ["/انمي", "تخمين أنمي"],
      ["/شخصيات", "تخمين شخصية"],
      ["/كلمات", "لعبة الكلمات"],
      ["/فك", "ترتيب حروف"],
      ["/تفكيك", "تفكيك كلمات"],
      ["/اعلام", "تخمين أعلام"],
      ["/وقف", "إيقاف اللعبة"]
    ]),
    section("المافيا", [
      ["/لقب_مافيا <لقب>", "حفظ لقبك"],
      ["/مافيا", "بدء جلسة"],
      ["انضم", "دخول الجولة"],
      ["/ابدأ_مافيا", "توزيع الأدوار"],
      ["/فوز_المواطنين", "إنهاء بفوزهم"],
      ["/فوز_المافيا", "إنهاء بفوزها"],
      ["/انهاء_مافيا", "إغلاق الجلسة"]
    ]),
    section("الترتيب", [
      ["/ترتيب", "صدارة الألعاب"],
      ["/ترتيب_المستوى", "صدارة XP"]
    ])
  ], "بدء الألعاب للمشرفين والإدارة.");

  await sock.sendMessage(jid, { text: msg });
}

async function showBankCommands(sock, jid) {
  const msg = buildMenu("💰 البنك والعملات", [
    section("حسابك", [
      ["/بنك", "رصيد البنك"],
      ["/إيداع <مبلغ>", "إيداع عملات"],
      ["/سحب <مبلغ>", "سحب عملات"],
      ["/تحويل <لقب> <مبلغ>", "تحويل عملات"]
    ]),
    section("الإدارة", [
      ["/بنك_إحصائيات", "إحصائيات البنك"]
    ])
  ]);

  await sock.sendMessage(jid, { text: msg });
}

async function showModeratorCommands(sock, jid) {
  const msg = buildMenu("🛡️ أوامر المشرفين", [
    section("المتابعة", [
      ["/التفاعل", "تفاعل اليوم"],
      ["/تقرير_اداري", "تقرير الإدارة"],
      ["/ملف <لقب>", "ملف عضو"]
    ]),
    section("الأعضاء", [
      ["/ترقية <لقب>", "رفع رتبة"],
      ["/اشراف <لقب>", "ترقية واتساب"],
      ["/خفض <لقب>", "خفض رتبة"],
      ["/طرد <لقب>", "طرد عضو"],
      ["/حظر <لقب>", "حظر عضو"],
      ["/فكحظر <لقب>", "إلغاء حظر"],
      ["/حذف <لقب>", "حذف بيانات"]
    ]),
    section("النقاط", [
      ["/نقاط <لقب> <عدد>", "إضافة نقاط"],
      ["/إزالة_نقاط <لقب> <عدد>", "إزالة نقاط"],
      ["/عملات <لقب> <عدد>", "إضافة عملات"],
      ["/إزالة_عملات <لقب> <عدد>", "إزالة عملات"],
      ["/نجوم <لقب> <عدد>", "إضافة نجوم"],
      ["/إزالة_نجوم <لقب> <عدد>", "إزالة نجوم"]
    ]),
    section("الأدوات", [
      ["/تغيير <قديم> الى <جديد>", "تغيير لقب"],
      ["/ترحيب <لقب>", "ترحيب عضو"],
      ["/اسحب_اللقب", "استخراج لقب"],
      ["/استخرج_لقب", "نفس الاستخراج"],
      ["/تعيين_منشن <لقب>", "حفظ منشن"],
      ["/تغيير_منشن <لقب>", "تعديل منشن"],
      ["/حذف_بدون_لقب", "عرض التنظيف"],
      ["/تأكيد_حذف_بدون_لقب", "تنفيذ التنظيف"],
      ["/احذف", "حذف رسالة"]
    ]),
    section("التواصل", [
      ["/تبليغ", "تبليغ إساءة"],
      ["/قوانين", "قوانين القروب"],
      ["/تذكير", "رسالة تذكير"],
      ["/تذكيرات_تلقائية <ساعات>", "تذكير دوري"],
      ["/رسالة_تحفيزية [نوع]", "رسالة تحفيزية"]
    ])
  ]);

  await sock.sendMessage(jid, { text: msg });
}

async function showAdminCommands(sock, jid) {
  const msg = buildMenu("👑 أوامر الأدمن", [
    section("الإدارة", [
      ["/يوم_جديد", "تصفير اليوم"],
      ["/تعيين_أدمن <لقب> <كلمة>", "تعيين أدمن"],
      ["/أضف_أدمن <لقب>", "أدمن بكلمة"],
      ["/حذف_أدمن_نفسي <كلمة>", "حذف نفسك"],
      ["/إرسال_رسالة <JID> <نص>", "إرسال إعلان"],
      ["/jid", "JID القروب"]
    ]),
    section("الرتب", [
      ["/منح_رتبة_إمبراطور <لقب> <مفتاح>", "رتبة خاصة"],
      ["/منح_إمبراطور <لقب>", "طلب كلمة سر"],
      ["/الرتب", "عرض الرتب"],
      ["/مفاتيح_الرتب", "جدول الرتب"]
    ]),
    section("النظام", [
      ["/حالة", "حالة البوت"],
      ["/إحصائيات", "أداء البوت"],
      ["/backup", "نسخة احتياطية"]
    ]),
    section("القوائم", [
      ["/قائمة", "كل المستخدمين"],
      ["/أعضاء", "الأعضاء فقط"],
      ["/الكل", "الجميع"],
      ["/النخبة", "قائمة النخبة"]
    ])
  ]);

  await sock.sendMessage(jid, { text: msg });
}

async function showRanksSystem(sock, jid) {
  const msg = buildMenu("⭐ الرتب والنجوم", [
    section("الرتب", [
      ["نواب الأدميرال", "24000 نجم"],
      ["العميد", "15000 نجم"],
      ["التشيبوكاي", "6500 نجم"],
      ["ملازم", "1500 نجم"],
      ["بيرق", "800 نجم"],
      ["راية", "500 نجم"],
      ["مشرف متدرب", "400 نجم"]
    ]),
    section("الأوامر", [
      ["/الرتب", "عرض الرتب"],
      ["/مفاتيح_الرتب", "جدول الرتب"],
      ["/ملفي", "رتبتك الحالية"]
    ])
  ]);

  await sock.sendMessage(jid, { text: msg });
}

async function showSearchCommands(sock, jid) {
  const msg = buildMenu("🔎 البحث والمعلومات", [
    section("البحث", [
      ["/ملف <لقب>", "ملف عضو"],
      ["/مشرفين", "قائمة الإدارة"],
      ["/معرف", "معرفك بالنظام"],
      ["/قرآن", "آيات وتلاوة"]
    ]),
    section("المساعدة", [
      ["/أوامر", "القائمة الرئيسية"],
      ["من صنعك؟", "معلومات المطور"],
      ["السلام عليكم", "رد تلقائي"]
    ])
  ]);

  await sock.sendMessage(jid, { text: msg });
}

export async function handleCommandsChoice(sock, jid, sender, text) {
  const kingdom = getKingdomIdFromGroupJid(jid);
  const userIsAdmin = await isAdmin(sender, kingdom);
  const userIsModerator = await isModerator(sender, kingdom);
  const choice = text.trim();

  if (choice === "1") {
    await showMemberCommands(sock, jid);
  } else if (choice === "2") {
    await showGamesCommands(sock, jid);
  } else if (choice === "3") {
    await showBankCommands(sock, jid);
  } else if (choice === "4") {
    if (!userIsModerator) {
      await sock.sendMessage(jid, { text: "❌ هذه القائمة للمشرفين فقط." });
      return;
    }
    await showModeratorCommands(sock, jid);
  } else if (choice === "5") {
    if (!userIsAdmin) {
      await sock.sendMessage(jid, { text: "❌ هذه القائمة للأدمن فقط." });
      return;
    }
    await showAdminCommands(sock, jid);
  } else if (choice === "6") {
    if (!userIsAdmin) {
      await sock.sendMessage(jid, { text: "❌ هذه القائمة للأدمن فقط." });
      return;
    }
    await showRanksSystem(sock, jid);
  } else if (choice === "7") {
    await showSearchCommands(sock, jid);
  } else {
    await sock.sendMessage(jid, { text: "❌ اختيار غير صحيح. اكتب رقم من القائمة." });
  }
}
