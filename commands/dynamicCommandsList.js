// commands/dynamicCommandsList.js
// نظام أكثر فاعلية لعرض قوائم الأوامر

import { COMMANDS_REGISTRY, formatCommandList, getCommandsByCategory } from './commandsRegistry.js';
import User from '../database/userModel.js';
import { isAdmin, isModerator } from './adminSystem.js';
import { getHighestRank, displayRank } from './rankSystem.js';
import { getKingdomIdFromGroupJid } from '../config.js';

export async function showDynamicCommandsList(sock, jid, sender) {
  const kingdom = getKingdomIdFromGroupJid(jid);
  const userIsAdmin = await isAdmin(sender, kingdom);
  const userIsModerator = await isModerator(sender, kingdom);

  let mainMenu = `
╔════════════════════════════════════╗
║      📋 قائمة الأوامر الديناميكية  ║
║      𝘾𝙇𝙊𝙑𝙀𝙍 🍀 HUNTER             ║
╚════════════════════════════════════╝

اختر رقم القائمة التي تريد عرضها:

*1️⃣  أوامر الأعضاء العامة*
*2️⃣  أوامر الألعاب* 🎮
*3️⃣  أوامر البنك والعملات* 💰`;

  // إضافة أوامر المشرفين فقط للمشرفين والأدمنز
  if (userIsModerator) {
    mainMenu += `\n*4️⃣  أوامر المشرفين* 🔰`;
  }

  // إضافة أوامر الأدمن فقط للأدمنز
  if (userIsAdmin) {
    mainMenu += `\n*5️⃣  أوامر الأدمن الرئيسي* 👑
*6️⃣  نظام الرتب والنجوم* 🎖️`;
  }

  // أوامر البحث متاحة للجميع
  mainMenu += `\n*7️⃣  أوامر البحث والمعلومات* 🔍
*8️⃣  البحث في الأوامر* 🔎

*اكتب الرقم فقط لعرض القائمة* ✨`;

  await sock.sendMessage(jid, { text: mainMenu });
}

// عرض قائمة بفئة محددة
export async function showCategoryCommands(sock, jid, category, title, userPermissions = {}) {
  const commands = COMMANDS_REGISTRY[category] || [];

  // فلترة الأوامر حسب الصلاحيات
  let filteredCommands = commands;
  if (category === 'moderator' && !userPermissions.isModerator && !userPermissions.isAdmin) {
    filteredCommands = [];
  }
  if (category === 'admin' && !userPermissions.isAdmin) {
    filteredCommands = [];
  }

  if (filteredCommands.length === 0) {
    await sock.sendMessage(jid, {
      text: `❌ ليس لديك صلاحية لعرض هذه القائمة أو القائمة فارغة.`
    });
    return;
  }

  let msg = `
╔════════════════════════════════════╗
║   ${title}   ║
╚════════════════════════════════════╝`;

  // تجميع الأوامر حسب الفئة الفرعية
  const categories = {};
  filteredCommands.forEach(cmd => {
    if (!categories[cmd.category]) categories[cmd.category] = [];
    categories[cmd.category].push(cmd);
  });

  // عرض كل فئة فرعية
  Object.entries(categories).forEach(([subCategory, cmds]) => {
    const categoryTitle = getCategoryTitle(subCategory);
    msg += formatCommandList(cmds, categoryTitle);
  });

  msg += `\n💡 اكتب /أوامر لرجوع القائمة الرئيسية`;

  await sock.sendMessage(jid, { text: msg });
}

// ترجمة أسماء الفئات
function getCategoryTitle(category) {
  const titles = {
    profile: 'الملف الشخصي',
    info: 'المعلومات',
    danger: 'العمليات الخطرة',
    birthday: 'عيد الميلاد',
    communication: 'الاتصال',
    anime: 'ألعاب الأنمي',
    word: 'ألعاب الكلمات',
    flag: 'ألعاب الأعلام',
    stats: 'الإحصائيات',
    view: 'العرض',
    transaction: 'المعاملات',
    management: 'الإدارة',
    points: 'النقاط',
    currency: 'العملات',
    moderation: 'الإشراف',
    ranks: 'الرتب',
    whatsapp: 'واتساب',
    stars: 'النجوم',
    lists: 'القوائم',
    search: 'البحث',
    help: 'المساعدة',
    monitoring: 'المراقبة',
    maintenance: 'الصيانة'
  };
  return titles[category] || category;
}

// البحث في الأوامر
export async function searchInCommands(sock, jid, query, userPermissions = {}) {
  const { searchCommands } = await import('./commandsRegistry.js');
  let results = searchCommands(query);

  // فلترة حسب الصلاحيات
  results = results.filter(cmd => {
    if (cmd.permission === 'admin' && !userPermissions.isAdmin) return false;
    if (cmd.permission === 'moderator' && !userPermissions.isModerator && !userPermissions.isAdmin) return false;
    return true;
  });

  if (results.length === 0) {
    await sock.sendMessage(jid, {
      text: `❌ لم يتم العثور على أوامر تحتوي على "${query}"\n\n💡 جرب كلمات مختلفة أو اكتب /أوامر للقائمة الكاملة`
    });
    return;
  }

  let msg = `
╔════════════════════════════════════╗
║   🔎 نتائج البحث: "${query}"       ║
╚════════════════════════════════════╝

تم العثور على ${results.length} أمر${results.length > 1 ? '' : 'اً'}:

`;

  results.forEach((cmd, index) => {
    msg += `${index + 1}. ${cmd.emoji} ${cmd.command}\n`;
    msg += `   ${cmd.description}\n`;
    if (cmd.usage) msg += `   استخدام: ${cmd.usage}\n`;
    msg += `\n`;
  });

  msg += `💡 اكتب /أوامر لرجوع القائمة الرئيسية`;

  await sock.sendMessage(jid, { text: msg });
}

// معالجة اختيار القائمة الديناميكية
export async function handleDynamicCommandsChoice(sock, jid, sender, text) {
  const kingdom = getKingdomIdFromGroupJid(jid);
  const userPermissions = {
    isAdmin: await isAdmin(sender, kingdom),
    isModerator: await isModerator(sender, kingdom)
  };

  const choice = text.trim();

  switch (choice) {
    case '1':
      await showCategoryCommands(sock, jid, 'member', '👤 أوامر الأعضاء العامة', userPermissions);
      break;

    case '2':
      await showCategoryCommands(sock, jid, 'games', '🎮 أوامر الألعاب', userPermissions);
      break;

    case '3':
      await showCategoryCommands(sock, jid, 'bank', '💰 أوامر البنك والعملات', userPermissions);
      break;

    case '4':
      if (!userPermissions.isModerator) {
        await sock.sendMessage(jid, {
          text: '❌ هذه الأوامر متاحة للمشرفين والأدمنين الأساسيين فقط!'
        });
        return;
      }
      await showCategoryCommands(sock, jid, 'moderator', '🔰 أوامر المشرفين', userPermissions);
      break;

    case '5':
      if (!userPermissions.isAdmin) {
        await sock.sendMessage(jid, {
          text: '❌ هذه الأوامر متاحة للأدمن الرئيسي فقط!'
        });
        return;
      }
      await showCategoryCommands(sock, jid, 'admin', '👑 أوامر الأدمن الرئيسي', userPermissions);
      break;

    case '6':
      if (!userPermissions.isAdmin) {
        await sock.sendMessage(jid, {
          text: '❌ هذه الأوامر متاحة للأدمن الرئيسي فقط!'
        });
        return;
      }
      // نظام الرتب (احتفظ بالقديم للآن)
      await showLegacyRanksSystem(sock, jid);
      break;

    case '7':
      await showCategoryCommands(sock, jid, 'search', '🔍 أوامر البحث والمعلومات', userPermissions);
      break;

    case '8':
      await sock.sendMessage(jid, {
        text: '🔎 *البحث في الأوامر*\n\nاكتب كلمة البحث بعد "بحث":\n\nمثال: `بحث نقاط`\nأو `بحث لعبة`\nأو `بحث حذف`'
      });
      break;

    default:
      await sock.sendMessage(jid, {
        text: '❌ اختيار غير صحيح!\n\nاكتب أحد الأرقام المتاحة في القائمة'
      });
  }
}

// نظام الرتب القديم (احتفظ به مؤقتاً)
async function showLegacyRanksSystem(sock, jid) {
  const msg = `
╔════════════════════════════════════╗
║   🎖️ نظام الرتب والنجوم           ║
║   (مملكة جديدة 🏰)                 ║
╚════════════════════════════════════╝

*الرتب والمستويات (7 رتب فقط):*
┌─────────────────────────────────
│ ⭐ نظام النجوم والرتب:
│
│ 🍃 نواب الأدميرال = 24000 نجم
│ 🔱 العميد = 15000 نجم
│ 🌊 التشيبوكاي = 6500 نجم
│ ♦️ ملازم = 1500 نجم
│ 🍷 بيرق = 800 نجم
│ 🦁 راية = 500 نجم
│ ♟️ مشرف متدرّب = 400 نجم
├─────────────────────────────────
│ 🏆 كيف تحصل على النجوم:
│ • الفوز في الألعاب
│ • الأداء الممتاز في المملكة
│ • التفاعل والمشاركة
└─────────────────────────────────

💡 اكتب /أوامر لرجوع القائمة الرئيسية`;

  await sock.sendMessage(jid, { text: msg });
}
