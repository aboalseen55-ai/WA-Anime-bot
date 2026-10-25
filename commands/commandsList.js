// قائمة الأوامر المرقمة: /أوامر أو /مساعدة بتفتح القائمة الرئيسية، الرقم بيفتح قسم، و0 بيرجع.
// الأقسام بتتغير حسب BOT_MODE: الشخصي بيشوف أوامر المساعد بس، وبوت القروبات بيشوف الممالك والألعاب.
import { isAdmin, isModerator } from "./adminSystem.js";
import { getKingdomIdFromGroupJid, DEVELOPER_JIDS } from "../config.js";
import { funEnabled, personalEnabled } from "../services/botMode.js";

export const MENU_TRIGGERS = new Set(["أوامر", "اوامر", "الأوامر", "الاوامر", "مساعدة", "مساعده", "help", "start", "ابدا", "ابدأ", "قائمة_الأوامر", "menu"]);
const MENU_TTL_MS = 10 * 60 * 1000;
const sessions = new Map();

// كل عنصر: { title, lines } قسم نهائي، أو { title, items } قائمة فرعية مرقمة.
// mode: personal | fun، role: moderator | admin | developer
const lines = (...rows) => rows.map(([command, description]) => (description ? `▪️ ${command} — ${description}` : `▪️ ${command}`));

const PERSONAL_MENU = [
  {
    title: "💬 الدردشة والفويسات والصور",
    lines: [
      "اكتبلي أي سؤال أو طلب بالخاص: ترجمة، صياغة رسالة، فكرة، حساب…",
      "",
      ...lines(
        ["رسالة صوتية", "بفرغها وبلخصها (بالقروب: رد عليها بـ /فرغ)"],
        ["صورة أو PDF", "بقراها وبطلع أهم اللي فيها، واكتب سؤالك معها"],
        ["/فرغ", "بالقروب: رد على فويس"],
        ["/اقرأ <سؤالك>", "بالقروب: رد على صورة أو PDF"]
      )
    ]
  },
  {
    title: "⏰ التذكيرات والمهام والملاحظات",
    items: [
      {
        title: "⏰ التذكيرات",
        lines: lines(
          ["/ذكرني بعد 20 دقيقة <النص>"],
          ["/ذكرني بكرة الساعة 9 <النص>"],
          ["/ذكرني كل يوم الساعة 8 مساءً <النص>", "متكرر"],
          ["/ذكرني كل جمعة الساعة 11 <النص>", "أسبوعي"],
          ["/تذكيراتي", "التذكيرات القادمة"],
          ["/الغاء_تذكير <رقم>"]
        ).concat(["", "أو احكيلي عادي: ذكرني بكرة الصبح أتصل بأحمد"])
      },
      {
        title: "✅ المهام",
        lines: lines(
          ["/مهمة <النص>", "إضافة مهمة"],
          ["/مهامي", "عرض المهام"],
          ["/تم <رقم>", "إنجاز مهمة"],
          ["/حذف_مهمة <رقم>"]
        )
      },
      {
        title: "📝 الملاحظات",
        lines: lines(
          ["/ملاحظة <النص>", "حفظ ملاحظة"],
          ["/ملاحظاتي", "عرض الملاحظات"],
          ["/حذف_ملاحظة <رقم>"]
        )
      }
    ]
  },
  {
    title: "📋 خطة اليوم",
    lines: [
      "احكيلي: بكرة بدي أروح عالبنك الساعة 10 وأخلص التقرير",
      "وبذكرك بكل مهمة وبسألك خلصت؟",
      "",
      ...lines(
        ["/خطة <مهام بأوقات>", "خطة اليوم"],
        ["/خطة_بكرة <مهام>", "خطة بكرة"],
        ["/خطتي", "عرض الخطة (أو /خطتي بكرة)"],
        ["/خلصت <رقم>", "أو رد: خلصت · لسا"],
        ["/حذف_من_الخطة <رقم>"],
        ["/انقل_لبكرة", "نقل الباقي لبكرة"],
        ["/امسح_الخطة"]
      )
    ]
  },
  {
    title: "💰 المصاريف",
    items: [
      {
        title: "🧾 تسجيل وعرض",
        lines: lines(
          ["/مصروف 5 قهوة", "أو احكيلي: صرفت 5 دنانير على قهوة"],
          ["/مصروف 20 دولار كلود و 22.5 انترنت", "أكثر من مصروف"],
          ["/مصاريفي", "مصاريف هالشهر"],
          ["/مصاريفي اليوم · الاسبوع · الكل"],
          ["/حذف_مصروف <رقم>"]
        )
      },
      {
        title: "📊 ملف إكسل",
        lines: lines(
          ["/تصدير_مصاريف", "الشهر الحالي"],
          ["/تصدير_مصاريف اليوم · الاسبوع · الكل"]
        )
      },
      {
        title: "🧠 أسئلة وتحليل",
        lines: lines(
          ["/حلل_مصاريف <سؤال>", "مثال: قديش صرفت على البنزين هالشهر؟"],
          ["/حلل_مصاريف", "تحليل ونصايح وين بتقدر توفر"]
        ).concat(["", "أو اسألني عادي بدون أمر."])
      }
    ]
  },
  {
    title: "🧠 الذاكرة",
    lines: [
      "بتذكر المهم عنك وآخر اشي حكينا فيه.",
      "",
      ...lines(
        ["/ذاكرتي", "شو بتذكر عنك"],
        ["/تذكر <معلومة>", "احفظ معلومة"],
        ["/انسى <رقم>", "احذف معلومة"],
        ["/انسى الكل", "امسح كل اشي"]
      )
    ]
  },
  {
    title: "☀️ الملخص الصباحي",
    lines: lines(
      ["/صباحي تشغيل 7", "كل يوم: مواقيت الصلاة وتذكيراتك ومهامك"],
      ["/صباحي", "معاينة هلأ"],
      ["/صباحي ايقاف"],
      ["/مدينتي اربد", "مدينة مواقيت الصلاة"]
    )
  },
  {
    title: "🎙️ الردود الصوتية",
    lines: lines(
      ["/فويس تشغيل", "برد عليك بفويس بالخاص"],
      ["/فويس ايقاف"],
      ["/فويس صوت", "اختار صوت سام: صوتين بنات وصوتين شباب"],
      ["/فويس اسلوب ناعم هادي", "أسلوب الصوت"],
      ["/فويس رصيد", "رصيد الأصوات"]
    ).concat(["", "بالقروب: رد على رسالتي بفويس وبرد عليك."])
  },
  {
    title: "👥 أدوات القروبات",
    items: [
      {
        title: "👥 للكل",
        lines: lines(
          ["/ملخص", "شو فاتني؟ ملخص آخر الرسائل"],
          ["/فرغ", "رد على فويس"],
          ["/اقرأ <سؤالك>", "رد على صورة أو PDF"],
          ["نادِ «سام» أو منشن البوت", "لتسأله"]
        )
      },
      {
        title: "🛡️ لمشرفين القروب",
        lines: lines(
          ["/حماية", "منع الروابط والسبام"],
          ["/نداء <رسالة>", "منشن للكل"],
          ["/ذكر_القروب كل جمعة الساعة 12 <النص>", "تذكير للقروب"],
          ["/تذكيرات_القروب"],
          ["/الغاء_تذكير_القروب <رقم>"]
        )
      }
    ]
  },
  {
    title: "📖 القرآن",
    lines: lines(
      ["/قرآن عشوائي", "آية عشوائية"],
      ["/قرآن 2:255", "آية محددة"],
      ["/قرآن آية الكرسي"],
      ["/قرآن الكهف", "بداية سورة"],
      ["/قرآن صوت الكهف", "تلاوة السورة"],
      ["/قرآن صوت 2:255 · /قرآن صورة 2:255"]
    )
  },
  {
    title: "🧰 المطور",
    role: "developer",
    lines: lines(
      ["/داشبورد", "رابط لوحة التحكم"],
      ["/حالة", "حالة البوت"],
      ["/استهلاك_الذكاء", "استهلاك Gemini"],
      ["/عد_التوكن <نص>", "حساب التوكنز"],
      ["/معرفي", "معرفك"]
    )
  }
];

const FUN_MENU = [
  {
    title: "👤 الأعضاء",
    items: [
      {
        title: "🪪 الملف",
        lines: lines(
          ["/لقبي <اللقب>", "تسجيل لقبك"],
          ["/ملفي", "عرض ملفك"],
          ["/مستواي", "مستوى XP"],
          ["/معرف", "معرفك بالنظام"],
          ["/اعادة", "حذف بياناتك"]
        )
      },
      {
        title: "📣 التواصل",
        lines: lines(
          ["/منشن <لقب>", "منشن عضو"],
          ["/من @منشن", "معرفة اللقب"],
          ["/مشرفين", "قائمة الإدارة"]
        )
      },
      {
        title: "🎂 المناسبات",
        lines: lines(
          ["/تسجيل_عيد_ميلاد <تاريخ>", "حفظ الميلاد"],
          ["/معايدة <لقب>", "تهنئة ميلاد"]
        )
      }
    ]
  },
  {
    title: "🎮 الألعاب",
    items: [
      {
        title: "🕹️ الألعاب",
        lines: lines(
          ["/ألعاب", "قائمة الألعاب"],
          ["/انمي", "تخمين أنمي"],
          ["/شخصيات", "تخمين شخصية"],
          ["/كلمات", "لعبة الكلمات"],
          ["/فك", "ترتيب حروف"],
          ["/تفكيك", "تفكيك كلمات"],
          ["/اعلام", "تخمين أعلام"],
          ["/وقف", "إيقاف اللعبة"]
        ).concat(["", "بدء الألعاب للمشرفين والإدارة."])
      },
      {
        title: "🕵️ المافيا",
        lines: lines(
          ["/لقب_مافيا <لقب>", "حفظ لقبك"],
          ["/مافيا", "بدء جلسة"],
          ["انضم", "دخول الجولة"],
          ["/ابدأ_مافيا", "توزيع الأدوار"],
          ["/فوز_المواطنين · /فوز_المافيا", "إنهاء الجولة"],
          ["/انهاء_مافيا", "إغلاق الجلسة"]
        )
      },
      {
        title: "🏆 الترتيب",
        lines: lines(
          ["/ترتيب", "صدارة الألعاب"],
          ["/ترتيب_المستوى", "صدارة XP"]
        )
      }
    ]
  },
  {
    title: "💰 البنك والعملات",
    lines: lines(
      ["/بنك", "رصيد البنك"],
      ["/إيداع <مبلغ>", "إيداع عملات"],
      ["/سحب <مبلغ>", "سحب عملات"],
      ["/تحويل <لقب> <مبلغ>", "تحويل عملات"],
      ["/بنك_إحصائيات", "إحصائيات البنك (للإدارة)"]
    )
  },
  {
    title: "🔎 البحث والمعلومات",
    lines: lines(
      ["/ملف <لقب>", "ملف عضو"],
      ["/مشرفين", "قائمة الإدارة"],
      ["/الرتب", "عرض الرتب"],
      ["/قرآن", "آيات وتلاوة"],
      ["من صنعك؟", "معلومات المطور"]
    )
  },
  {
    title: "🛡️ أوامر المشرفين",
    role: "moderator",
    items: [
      {
        title: "📈 المتابعة",
        lines: lines(
          ["/التفاعل", "تفاعل اليوم"],
          ["/تقرير_اداري", "تقرير الإدارة"],
          ["/ملف <لقب>", "ملف عضو"]
        )
      },
      {
        title: "👥 الأعضاء",
        lines: lines(
          ["/ترقية <لقب>", "رفع رتبة"],
          ["/اشراف <لقب>", "ترقية واتساب"],
          ["/خفض <لقب>", "خفض رتبة"],
          ["/طرد <لقب>", "طرد عضو"],
          ["/حظر <لقب> · /فكحظر <لقب>"],
          ["/حذف <لقب>", "حذف بيانات"]
        )
      },
      {
        title: "⭐ النقاط والعملات والنجوم",
        lines: lines(
          ["/نقاط <لقب> <عدد> · /إزالة_نقاط"],
          ["/عملات <لقب> <عدد> · /إزالة_عملات"],
          ["/نجوم <لقب> <عدد> · /إزالة_نجوم"]
        )
      },
      {
        title: "🧰 الأدوات",
        lines: lines(
          ["/تغيير <قديم> الى <جديد>", "تغيير لقب"],
          ["/ترحيب <لقب>", "ترحيب عضو"],
          ["/اسحب_اللقب · /استخرج_لقب", "استخراج لقب"],
          ["/تعيين_منشن · /تغيير_منشن <لقب>", "حفظ منشن"],
          ["/حذف_بدون_لقب", "عرض التنظيف"],
          ["/تأكيد_حذف_بدون_لقب", "تنفيذ التنظيف"],
          ["/احذف", "حذف رسالة (رد عليها)"]
        )
      },
      {
        title: "📢 التواصل",
        lines: lines(
          ["/تبليغ", "تبليغ إساءة"],
          ["/قوانين", "قوانين القروب"],
          ["/تذكير", "رسالة تذكير"],
          ["/تذكيرات_تلقائية <ساعات>", "تذكير دوري"],
          ["/رسالة_تحفيزية [نوع]", "رسالة تحفيزية"]
        )
      }
    ]
  },
  {
    title: "👑 أوامر الأدمن",
    role: "admin",
    items: [
      {
        title: "⚙️ الإدارة",
        lines: lines(
          ["/يوم_جديد", "تصفير اليوم"],
          ["/تعيين_أدمن <لقب> <كلمة>", "تعيين أدمن"],
          ["/أضف_أدمن <لقب>", "أدمن بكلمة"],
          ["/حذف_أدمن_نفسي <كلمة>", "حذف نفسك"],
          ["/إرسال_رسالة <JID> <نص>", "إرسال إعلان"],
          ["/jid", "JID القروب"],
          ["/حالة", "حالة البوت"]
        )
      },
      {
        title: "⭐ الرتب والنجوم",
        lines: lines(
          ["/الرتب", "عرض الرتب"],
          ["/مفاتيح_الرتب", "جدول الرتب"],
          ["/منح_إمبراطور <لقب>", "طلب كلمة سر"],
          ["/منح_رتبة_إمبراطور <لقب> <مفتاح>", "رتبة خاصة"]
        ).concat(["", "الرتب: مشرف متدرب 400 · راية 500 · بيرق 800 · ملازم 1500 · التشيبوكاي 6500 · العميد 15000 · نواب الأدميرال 24000 نجم"])
      },
      {
        title: "📜 القوائم",
        lines: lines(
          ["/قائمة", "كل المستخدمين"],
          ["/أعضاء", "الأعضاء فقط"],
          ["/الكل", "الجميع"],
          ["/النخبة", "قائمة النخبة"]
        )
      }
    ]
  },
  {
    title: "🏰 الممالك (المطور)",
    role: "developer",
    lines: lines(
      ["/الممالك", "كل الممالك"],
      ["/فتح_مملكة · /فتح_نقابة", "تسجيل مملكة"],
      ["/رمز_مملكة · /رمز_نقابة", "رمز دخول"],
      ["/مستلمي_رمز_مملكة"],
      ["/تعديل_مملكة · /حذف_مملكة"],
      ["/تقرير_الممالك"],
      ["/أوامر_المطور", "دليل المطور الكامل"]
    )
  }
];

async function resolveRoles(jid, sender) {
  const roles = new Set();
  if (DEVELOPER_JIDS.includes(sender)) roles.add("developer").add("admin").add("moderator");
  if (!funEnabled()) return roles;
  try {
    const kingdom = getKingdomIdFromGroupJid(jid);
    if (await isAdmin(sender, kingdom)) roles.add("admin").add("moderator");
    else if (await isModerator(sender, kingdom)) roles.add("moderator");
  } catch (error) {
    console.warn("Menu role check failed:", error.message);
  }
  return roles;
}

/** القائمة الرئيسية حسب المود والصلاحية. */
export function buildRootMenu({ roles = new Set(), personal = personalEnabled(), fun = funEnabled() } = {}) {
  const visible = (node) => !node.role || roles.has(node.role);
  return [
    ...(personal ? PERSONAL_MENU : []),
    ...(fun ? FUN_MENU : [])
  ].filter(visible);
}

function nodeAt(root, path) {
  let items = root;
  let node = null;
  for (const index of path) {
    node = items[index];
    if (!node?.items) return node || null;
    items = node.items;
  }
  return node;
}

function renderList(title, items, isRoot) {
  return [
    `*${title}*`,
    "",
    ...items.map((item, i) => `${i + 1}. ${item.title}`),
    "",
    isRoot ? "ارسل رقم القسم." : "ارسل رقم القسم · 0 للرجوع"
  ].join("\n");
}

function renderLeaf(node) {
  return [`*${node.title}*`, "", ...node.lines, "", "ارسل رقم قسم ثاني · 0 للرجوع"].join("\n");
}

function renderMenu(root, path) {
  if (!path.length) {
    const title = funEnabled() && !personalEnabled() ? "📋 قائمة الأوامر" : "🤖 سام: كل اللي بقدر أعمله";
    return renderList(title, root, true);
  }
  const node = nodeAt(root, path);
  return renderList(node.title, node.items, false);
}

const sessionKey = (jid, sender) => `${jid}|${sender}`;

export function isMenuTrigger(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("/")) return false;
  return MENU_TRIGGERS.has(raw.slice(1).trim().toLowerCase());
}

export async function showCommandsList(sock, jid, sender) {
  const root = buildRootMenu({ roles: await resolveRoles(jid, sender) });
  sessions.set(sessionKey(jid, sender), { path: [], at: Date.now() });
  await sock.sendMessage(jid, { text: renderMenu(root, []) });
  return true;
}

/** رد برقم على قائمة مفتوحة. أي رسالة غير رقم بتسكر القائمة حتى ما تخطف الأرقام بعدين. */
export async function handleCommandsMenuReply(sock, jid, sender, text) {
  const key = sessionKey(jid, sender);
  const session = sessions.get(key);
  if (!session) return false;
  const choice = String(text || "").trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (!/^\d{1,2}$/.test(choice) || Date.now() - session.at > MENU_TTL_MS) {
    sessions.delete(key);
    return false;
  }

  const root = buildRootMenu({ roles: await resolveRoles(jid, sender) });
  const number = Number(choice);
  session.at = Date.now();

  if (number === 0) {
    session.path = session.path.slice(0, -1);
    await sock.sendMessage(jid, { text: renderMenu(root, session.path) });
    return true;
  }

  const items = session.path.length ? nodeAt(root, session.path)?.items || root : root;
  const picked = items[number - 1];
  if (!picked) {
    await sock.sendMessage(jid, { text: `❌ اختار رقم من 1 لـ ${items.length}، أو 0 للرجوع.` });
    return true;
  }

  if (picked.items) {
    session.path = [...session.path, number - 1];
    await sock.sendMessage(jid, { text: renderMenu(root, session.path) });
  } else {
    // بنضل على نفس القائمة، فرقم ثاني بيفتح قسم ثاني
    await sock.sendMessage(jid, { text: renderLeaf(picked) });
  }
  return true;
}

export function clearCommandsMenu(jid, sender) {
  sessions.delete(sessionKey(jid, sender));
}

// توافق مع الكود القديم
export async function handleCommandsChoice(sock, jid, sender, text) {
  if (!sessions.has(sessionKey(jid, sender))) await showCommandsList(sock, jid, sender);
  return handleCommandsMenuReply(sock, jid, sender, text);
}
