// commands/commandsRegistry.js
// نظام أكثر فاعلية لتسجيل وإدارة الأوامر

export const COMMANDS_REGISTRY = {
  // أوامر الأعضاء العامة
  member: [
    {
      command: '/لقبي',
      description: 'تسجيل لقب جديد أو تغييره',
      usage: '/لقبي <اللقب>',
      category: 'profile',
      emoji: '👤'
    },
    {
      command: '/ملفي',
      description: 'عرض ملفك الشخصي الكامل',
      usage: '/ملفي',
      category: 'profile',
      emoji: '📋'
    },
    {
      command: '/مستواي',
      description: 'عرض مستوى XP والتقدم',
      usage: '/مستواي',
      category: 'profile',
      emoji: '✨'
    },
    {
      command: '/معرف',
      description: 'عرض رقمك الشخصي (JID)',
      usage: '/معرف',
      category: 'info',
      emoji: '🆔'
    },
    {
      command: '/اعادة',
      description: 'حذف جميع بياناتك من النظام',
      usage: '/اعادة',
      category: 'danger',
      emoji: '🗑️'
    },
    {
      command: '/تسجيل_عيد_ميلاد',
      description: 'تسجيل تاريخ ميلادك',
      usage: '/تسجيل_عيد_ميلاد <التاريخ>',
      category: 'birthday',
      emoji: '🎂'
    },
    {
      command: '/معايدة',
      description: 'إرسال معايدة بعيد الميلاد',
      usage: '/معايدة <اللقب>',
      category: 'birthday',
      emoji: '🎉'
    },
    {
      command: '/منشن',
      description: 'عرض منشن العضو',
      usage: '/منشن <اللقب>',
      category: 'communication',
      emoji: '📣'
    },
    {
      command: '/مشرفين',
      description: 'قائمة المشرفين والأدمنين',
      usage: '/مشرفين',
      category: 'info',
      emoji: '🔰'
    }
  ],

  // أوامر الألعاب
  games: [
    {
      command: '/انمي',
      description: 'لعبة تخمين الأنمي',
      usage: '/انمي',
      category: 'anime',
      emoji: '🎬',
      note: 'المشرفين فقط يبدأون'
    },
    {
      command: '/شخصيات',
      description: 'لعبة تخمين الشخصيات',
      usage: '/شخصيات',
      category: 'anime',
      emoji: '🎭',
      note: 'المشرفين فقط يبدأون'
    },
    {
      command: '/كلمات',
      description: 'لعبة الكلمات',
      usage: '/كلمات',
      category: 'word',
      emoji: '📝',
      note: 'المشرفين فقط يبدأون'
    },
    {
      command: '/فك',
      description: 'لعبة فك الحروف',
      usage: '/فك',
      category: 'word',
      emoji: '🔀',
      note: 'المشرفين فقط يبدأون'
    },
    {
      command: '/اعلام',
      description: 'لعبة الأعلام',
      usage: '/اعلام',
      category: 'flag',
      emoji: '🚩',
      note: 'المشرفين فقط يبدأون'
    },
    {
      command: '/ترتيب',
      description: 'جدول الصدارة الموحد',
      usage: '/ترتيب',
      category: 'stats',
      emoji: '🏆'
    },
    {
      command: '/ترتيب_المستوى',
      description: 'ترتيب أعلى مستويات XP',
      usage: '/ترتيب_المستوى',
      category: 'stats',
      emoji: '✨'
    }
  ],

  // أوامر البنك
  bank: [
    {
      command: '/بنك',
      description: 'عرض رصيدك في البنك',
      usage: '/بنك',
      category: 'view',
      emoji: '🏦'
    },
    {
      command: '/إيداع',
      description: 'إيداع عملات في البنك',
      usage: '/إيداع <المبلغ>',
      category: 'transaction',
      emoji: '💳'
    },
    {
      command: '/سحب',
      description: 'سحب عملات من البنك',
      usage: '/سحب <المبلغ>',
      category: 'transaction',
      emoji: '🏧'
    },
    {
      command: '/تحويل',
      description: 'تحويل عملات لعضو آخر',
      usage: '/تحويل <لقب> <المبلغ>',
      category: 'transaction',
      emoji: '💸'
    }
  ],

  // أوامر المشرفين
  moderator: [
    {
      command: '/طرد',
      description: 'طرد عضو من المجموعة فعلياً',
      usage: '/طرد <اللقب>',
      category: 'management',
      emoji: '🚪',
      permission: 'moderator'
    },
    {
      command: '/نقاط',
      description: 'إضافة نقاط لعضو',
      usage: '/نقاط <اللقب> <العدد>',
      category: 'points',
      emoji: '➕',
      permission: 'moderator'
    },
    {
      command: '/عملات',
      description: 'إضافة عملات لعضو',
      usage: '/عملات <اللقب> <العدد>',
      category: 'currency',
      emoji: '💰',
      permission: 'moderator'
    },
    {
      command: '/حظر',
      description: 'حظر عضو من النظام',
      usage: '/حظر <اللقب> <السبب>',
      category: 'moderation',
      emoji: '🚫',
      permission: 'moderator'
    },
    {
      command: '/فكحظر',
      description: 'إزالة حظر عضو',
      usage: '/فكحظر <اللقب>',
      category: 'moderation',
      emoji: '✅',
      permission: 'moderator'
    }
  ],

  // أوامر الأدمن الرئيسي
  admin: [
    {
      command: '/ترقية',
      description: 'ترقية عضو إلى مشرف',
      usage: '/ترقية <اللقب>',
      category: 'ranks',
      emoji: '🎖️',
      permission: 'admin'
    },
    {
      command: '/اشراف',
      description: 'ترقية فعلية في واتساب',
      usage: '/اشراف <اللقب>',
      category: 'whatsapp',
      emoji: '🔰',
      permission: 'admin'
    },
    {
      command: '/خفض',
      description: 'خفض الرتبة',
      usage: '/خفض <اللقب>',
      category: 'ranks',
      emoji: '⬇️',
      permission: 'admin'
    },
    {
      command: '/نجوم',
      description: 'إضافة نجوم الرتبة',
      usage: '/نجوم <اللقب> <العدد>',
      category: 'stars',
      emoji: '⭐',
      permission: 'admin'
    },
    {
      command: '/حذف',
      description: 'حذف بيانات العضو نهائياً',
      usage: '/حذف <اللقب>',
      category: 'danger',
      emoji: '🗑️',
      permission: 'admin'
    },
    {
      command: '/تغيير',
      description: 'تغيير لقب أي عضو',
      usage: '/تغيير <لقب> الى <لقب_جديد>',
      category: 'management',
      emoji: '✏️',
      permission: 'admin'
    },
    {
      command: '/قائمة',
      description: 'القائمة الكاملة مع JIDs',
      usage: '/قائمة',
      category: 'lists',
      emoji: '📋',
      permission: 'admin'
    },
    {
      command: '/jid',
      description: 'عرض JID المجموعة الحالية',
      usage: '/jid',
      category: 'info',
      emoji: '📋',
      permission: 'admin'
    },
    {
      command: '/إرسال_رسالة',
      description: 'إرسال رسالة إلى مجموعة',
      usage: '/إرسال_رسالة <JID> <النص>',
      category: 'communication',
      emoji: '📤',
      permission: 'admin'
    },
    // الأوامر الجديدة
    {
      command: '/حالة',
      description: 'فحص حالة البوت الكاملة',
      usage: '/حالة',
      category: 'monitoring',
      emoji: '🩺',
      permission: 'admin'
    },
    {
      command: '/إحصائيات',
      description: 'إحصائيات الأداء المفصلة',
      usage: '/إحصائيات',
      category: 'monitoring',
      emoji: '📊',
      permission: 'admin'
    },
    {
      command: '/backup',
      description: 'إنشاء نسخة احتياطية فورية',
      usage: '/backup',
      category: 'maintenance',
      emoji: '💾',
      permission: 'admin'
    }
  ],

  // أوامر البحث
  search: [
    {
      command: '/ملف',
      description: 'عرض ملف عضو',
      usage: '/ملف <اللقب>',
      category: 'search',
      emoji: '📋'
    },
    {
      command: '/أوامر',
      description: 'القائمة التفاعلية',
      usage: '/أوامر',
      category: 'help',
      emoji: '📖'
    }
  ]
};

// دوال مساعدة للبحث والفلترة
export function getCommandsByCategory(category) {
  const allCommands = [];
  Object.values(COMMANDS_REGISTRY).forEach(commands => {
    allCommands.push(...commands.filter(cmd => cmd.category === category));
  });
  return allCommands;
}

export function searchCommands(query) {
  const allCommands = [];
  Object.values(COMMANDS_REGISTRY).forEach(commands => {
    allCommands.push(...commands);
  });

  return allCommands.filter(cmd =>
    cmd.command.toLowerCase().includes(query.toLowerCase()) ||
    cmd.description.toLowerCase().includes(query.toLowerCase())
  );
}

export function getCommandsByPermission(permission) {
  const allCommands = [];
  Object.values(COMMANDS_REGISTRY).forEach(commands => {
    allCommands.push(...commands.filter(cmd => cmd.permission === permission));
  });
  return allCommands;
}

// إنشاء قائمة منسقة
export function formatCommandList(commands, title) {
  if (commands.length === 0) return '';

  let msg = `\n*${title}:*\n┌─────────────────────────────────\n`;

  commands.forEach((cmd, index) => {
    msg += `│ ${cmd.emoji} ${cmd.command}\n`;
    msg += `│ ${cmd.description}\n`;
    if (cmd.usage) msg += `│ استخدام: ${cmd.usage}\n`;
    if (cmd.note) msg += `│ ملاحظة: ${cmd.note}\n`;
    if (index < commands.length - 1) msg += `├─────────────────────────────────\n`;
    else msg += `└─────────────────────────────────\n`;
  });

  return msg;
}
