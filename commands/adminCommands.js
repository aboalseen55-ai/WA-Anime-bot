import axios from 'axios';
import User from "../database/userModel.js";
import { getAllRanksDisplay, getHighestRank, getRankInfo, getRankKeysTable } from "../commands/rankSystem.js";
import {
    isAdmin,
    isSuperAdmin,
    isSuperAdminInKingdom,
    isModerator,
    promoteModerator,
    demoteModerator,
    addPoints,
    addCoins,
    removePoints,
    removeCoins,
    kickMember,
    banMember,
    unbanMember,
    showUserStats,
    showAdminsAndMods,
    showCompleteList,
    showMembersList,
    changeNickname,
    deleteUser,
    deleteUsersWithoutNickname,
    showDeleteWithoutNicknameConfirmation,
    showAllUsers,
    getUserInfo,
    addRankStars,
    removeRankStars,
    showBankStats,
    extractAndSaveUserFromMention,
    getNicknameFromMention,
    grantEmperorDecisionRank,
    initiateEmperorGrant,
    retrieveOrCreateNickname,
    getCleanMentionTextForUser,
    findUserByNickname,
    sendAdminsDailyReports,
    resetDailyGameStats
} from "./adminSystem.js";
import { showElite } from "./eliteFunction.js";
import { pendingMentions } from "../handlers/messageHandler.js";
import { ADMIN_PASSWORD, ADMIN_PASSWORD_CONFIGURED, getKingdomIdFromGroupJid, KINGDOMS, getKingdomFromGroupJid } from "../config.js";
import { showCommandsList, handleCommandsChoice } from "./commandsList.js";
import { sendRulesMessage, sendReminderMessage, startReminderSystem } from "../utils/rulesSystem.js";
import { getRecentMessages, popRecentMessages } from "../utils/messageCache.js";

export async function handleAdminCommands(sock, jid, message, sender, msg) {

    // استخراج الأمر والمعاملات (مرة واحدة في الأعلى)
    var parts = message.split(' ');
    var command = parts[0].toLowerCase();

    // أمر إرسال تقرير إداري شامل (للأدمن الرئيسي فقط لكل مملكة)
    if (command === '/تقرير_اداري') {
        const kingdom = getKingdomIdFromGroupJid(jid) || 'clover';
        const userIsSuperAdmin = await isSuperAdminInKingdom(sender, kingdom);
        if (!userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: '❌ هذا الأمر متاح فقط للأدمن الرئيسي في هذه المملكة.' });
            return true;
        }
        // جلب JID المجموعة الإدارية من الكونفيج
        const adminGroupJid = KINGDOMS[kingdom]?.adminGroup || '120363425063189388@g.us';
        // إرسال تقرير الألعاب لجميع الأداريين
        await sendAdminsDailyReports(sock, adminGroupJid);
        // إرسال تقرير التفاعل اليومي (نفس منطق /التفاعل)
        const users = await User.find({ kingdom_id: kingdom, dailyMessages: { $gte: 1 } }).sort({ dailyMessages: -1 });
        if (!users.length) {
            await sock.sendMessage(adminGroupJid, { text: 'لا يوجد أعضاء لديهم تفاعل اليوم.' });
        } else {
            let report = '\u200F📊 *تفاعل الأعضاء اليومي*\n';
            report += '--------------------------\n';
            const emojis = ['🥇', '🥈', '🥉'];
            users.forEach((user, idx) => {
                let line = '';
                if (idx < 3) {
                    line += `${emojis[idx]} `;
                }
                line += `${user.nickname}: ${user.dailyMessages}`;
                report += line + '\n';
                if (idx < 2 && idx < users.length - 1) {
                    report += '_________________\n';
                }
            });
            await sock.sendMessage(adminGroupJid, { text: report });
        }
        // حساب وقت السيرفر الحالي وموعد التقرير التالي
        const now = new Date();
        const nextReport = new Date(now);
        if (now.getHours() < 23 || (now.getHours() === 23 && now.getMinutes() < 59)) {
            nextReport.setHours(23, 59, 0, 0);
        } else {
            nextReport.setDate(nextReport.getDate() + 1);
            nextReport.setHours(23, 59, 0, 0);
        }
        const nowStr = now.toLocaleString('ar-EG');
        const nextReportStr = nextReport.toLocaleString('ar-EG');
        await sock.sendMessage(jid, {
            text: `✅ تم إرسال التقارير الإدارية للمجموعة الإدارية.\n\n🕒 وقت السيرفر الحالي: ${nowStr}\n📅 موعد التقرير اليومي التالي: ${nextReportStr}`
        });
        return true;
    }

    // (تمت إزالة إعادة تعريف parts وcommand هنا، استخدم المتغيرات المعرفة في الأعلى فقط)

    // استخراج معرف المملكة من JID المجموعة
    const kingdom = getKingdomIdFromGroupJid(jid);

    // التحقق من صلاحيات المرسل
    const userIsSuperAdmin = await isSuperAdminInKingdom(sender, kingdom);
    const userIsAdmin = await isAdmin(sender, kingdom);
    const userIsModerator = await isModerator(sender, kingdom);

    // أمر التفاعل
    if (command === '/التفاعل') {
        // فقط الأدمن الأساسي أو المشرف أو الأدمن الرئيسي
        if (!userIsModerator && !userIsAdmin && !userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الأساسي أو المشرف يمكنهم عرض تفاعل الأعضاء!' });
            return true;
        }
        // جلب جميع الأعضاء في المملكة الحالية
        const users = await User.find({ kingdom_id: kingdom, dailyMessages: { $gte: 1 } }).sort({ dailyMessages: -1 });
        if (!users.length) {
            await sock.sendMessage(jid, { text: 'لا يوجد أعضاء لديهم تفاعل اليوم.' });
            return true;
        }
        
        // حساب الإجمالي أولاً
        let totalInteractions = 0;
        users.forEach((user) => {
            totalInteractions += user.dailyMessages;
        });
        
        let report = '\u200F📊 *تفاعل الأعضاء اليومي*\n';
        report += '--------------------------\n';
        report += `📈 *التفاعل الإجمالي:* ${totalInteractions}\n`;
        report += '--------------------------\n';
        const emojis = ['🥇', '🥈', '🥉'];
        
        users.forEach((user, idx) => {
            let line = '';
            if (idx < 3) {
                line += `${emojis[idx]} `;
            }
            line += `${user.nickname}: ${user.dailyMessages}`;
            report += line + '\n';
            // إضافة فاصل بين المراكز
            if (idx < 2 && idx < users.length - 1) {
                report += '_________________\n';
            }
        });

        await sock.sendMessage(jid, { text: report });
        return true;
    }

    // أمر طارئ: تصفير تفاعل اليوم وسجلات الألعاب
    if (command === '/يوم_جديد') {
        // يسمح فقط للأدمن الأساسي أو الأدمن الرئيسي
        if (!userIsAdmin && !userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الأساسي أو الأدمن الرئيسي يمكنهم تنفيذ هذا الأمر.' });
            return true;
        }

        await User.updateMany({}, { dailyMessages: 0 });
        await resetDailyGameStats();

        await sock.sendMessage(jid, { text: '✅ تم تصفير التفاعل اليومي وسجلات الألعاب لجميع المستخدمين (أمر طارئ).' });
        return true;
    }

    // أوامر الأدمن فقط
    if (command === '/ترقية') {
        // الأدمن الأساسي والأدمن الرئيسي يستطيعون الترقية
        if (!userIsAdmin && !userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الأساسي يستطيع ترقية الأعضاء!' });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /ترقية <اللقب>' });
            return true;
        }

        const searchTerm = parts.slice(1).join(' ');
        const user = await findUserByNickname(searchTerm, kingdom);

        if (!user) {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${searchTerm}"!` });
            return true;
        }

        // التحقق من وجود منشن محفوظ
        if (user.mention) {
            // إذا كان المنشن موجود، تم الترقية مباشرة استخدام المنشن المحفوظ
            await promoteModerator(sock, jid, user.nickname, sender, null, kingdom);
        } else {
            // إذا لم يكن المنشن موجود، طلب المنشن لتسجيله أولاً

            // حفظ الحالة المعلقة للترقية
            pendingMentions[jid] = {
                action: 'promotion',
                nickname: user.nickname,
                adminJid: sender
            };

            // طلب المنشن
            await sock.sendMessage(jid, { 
                text: `✋ الرجاء عمل منشن (@) للاعب *${user.nickname}* لتسجيل رقمه وإتمام الترقية.\n\n💡 ضع "رد" على الرسالة واكتب اسم اللاعب أو رقمه واضغط منشن.` 
            });
        }
        return true;
    }

    if (command === '/خفض') {
        // فقط super_admin يستطيع خفض الأدمنين الأساسيين والمشرفين
        if (!userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع خفض الأدمنين الأساسيين والمشرفين!' });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /خفض <اللقب>' });
            return true;
        }

        const searchTerm = parts.slice(1).join(' ');
        const user = await findUserByNickname(searchTerm, kingdom);

        if (user) {
            await demoteModerator(sock, jid, user.nickname, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${searchTerm}"!` });
        }
        return true;
    }

    if (command === '/نقاط') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!' });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /نقاط <اللقب> <العدد>' });
            return true;
        }

        const nickname = parts[1];
        const amount = parseInt(parts[2]);

        if (isNaN(amount)) {
            await sock.sendMessage(jid, { text: '❌ العدد يجب أن يكون رقماً!' });
            return true;
        }

        const user = await findUserByNickname(nickname, kingdom);
        if (user) {
            await addPoints(sock, jid, user.nickname, amount, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/عملات') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!' });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /عملات <اللقب> <العدد>' });
            return true;
        }

        const nickname = parts[1];
        const amount = parseInt(parts[2]);

        if (isNaN(amount)) {
            await sock.sendMessage(jid, { text: '❌ العدد يجب أن يكون رقماً!' });
            return true;
        }

        const user = await findUserByNickname(nickname, kingdom);
        if (user) {
            await addCoins(sock, jid, user.nickname, amount, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/نجوم' || command === '/إضافة_نجوم') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!' });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /نجوم <اللقب> <العدد>' });
            return true;
        }

        const nickname = parts[1];
        const amount = parseInt(parts[2]);

        if (isNaN(amount)) {
            await sock.sendMessage(jid, { text: '❌ العدد يجب أن يكون رقماً!' });
            return true;
        }

        const user = await findUserByNickname(nickname, kingdom);
        if (user) {
            await addRankStars(sock, jid, user.nickname, amount, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/إزالة_نجوم') {
        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمنين الأساسيين والمشرفين يستطيعون إزالة نجوم الرتبة!' });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /إزالة_نجوم <اللقب> <العدد>' });
            return true;
        }

        const nickname = parts[1];
        const amount = parseInt(parts[2]);

        if (isNaN(amount) || amount <= 0) {
            await sock.sendMessage(jid, { text: '❌ العدد يجب أن يكون رقماً موجباً!' });
            return true;
        }

        const user = await findUserByNickname(nickname, kingdom);
        if (user) {
            await removeRankStars(sock, jid, user.nickname, amount, sender);
        } else {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    // أمر منح الرتب التي تحتاج قرار الإمبراطور
    if (command === '/منح_رتبة_إمبراطور') {
        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /منح_رتبة_إمبراطور <اللقب> <مفتاح_الرتبة>' });
            return true;
        }

        const nickname = parts[1];
        const rankKey = parts[2];

        const user = await findUserByNickname(nickname, kingdom);
        if (!user) {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
            return true;
        }

        await grantEmperorDecisionRank(sock, jid, user.nickname, rankKey, sender);
        return true;
    }

    // أوامر الأدمن والمشرفين لإزالة النقاط والعملات
    if (command === '/إزالة_نقاط') {
        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمنين الأساسيين والمشرفين يستطيعون إزالة النقاط!' });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /إزالة_نقاط <اللقب> <العدد>' });
            return true;
        }

        const nickname = parts[1];
        const amount = parseInt(parts[2]);

        if (isNaN(amount) || amount <= 0) {
            await sock.sendMessage(jid, { text: '❌ العدد يجب أن يكون رقماً موجباً!' });
            return true;
        }

        const user = await findUserByNickname(nickname, kingdom);
        if (user) {
            await removePoints(sock, jid, user.nickname, amount, sender);
        } else {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/إزالة_عملات') {
        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمنين الأساسيين والمشرفين يستطيعون إزالة العملات!' });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /إزالة_عملات <اللقب> <العدد>' });
            return true;
        }

        const nickname = parts[1];
        const amount = parseInt(parts[2]);

        if (isNaN(amount) || amount <= 0) {
            await sock.sendMessage(jid, { text: '❌ العدد يجب أن يكون رقماً موجباً!' });
            return true;
        }

        const user = await findUserByNickname(nickname, kingdom);
        if (user) {
            await removeCoins(sock, jid, user.nickname, amount, sender);
        } else {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    // أوامر الأدمن والمشرفين
    if (command === '/طرد') {
        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمنين الأساسيين والمشرفين يستطيعون طرد الأعضاء!' });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /طرد <اللقب>' });
            return true;
        }

        const nickname = parts.slice(1).join(' ');
        const user = await User.findOne({ nickname: { $regex: nickname, $options: 'i' }, kingdom_id: kingdom });

        if (user) {
            await kickMember(sock, jid, user.nickname, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/حظر') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع حظر الأعضاء!' });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /حظر <اللقب> <السبب>' });
            return true;
        }

        const nickname = parts[1];
        const reason = parts.slice(2).join(' ');

        const user = await User.findOne({ nickname: { $regex: nickname, $options: 'i' }, kingdom_id: kingdom });
        if (user) {
            await banMember(sock, jid, user.nickname, reason, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/فكحظر') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع إزالة الحظر!' });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /فكحظر <اللقب>' });
            return true;
        }

        const nickname = parts.slice(1).join(' ');
        const user = await User.findOne({ nickname: { $regex: nickname, $options: 'i' }, kingdom_id: kingdom });

        if (user) {
            await unbanMember(sock, jid, user.nickname, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/حذف') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع حذف بيانات المستخدمين!' });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /حذف <اللقب>' });
            return true;
        }

        const nickname = parts.slice(1).join(' ');
        await deleteUser(sock, jid, nickname, sender);
        return true;
    }

    if (command === '/حذف_بدون_لقب') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!' });
            return true;
        }

        await showDeleteWithoutNicknameConfirmation(sock, jid, sender);
        return true;
    }

    if (command === '/تأكيد_حذف_بدون_لقب') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!' });
            return true;
        }

        await deleteUsersWithoutNickname(sock, jid, sender);
        return true;
    }

    // أوامر للجميع

    if (command === '/ملف') {
        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /ملف <اللقب>' });
            return true;
        }

        const nickname = parts.slice(1).join(' ');
        const user = await findUserByNickname(nickname, kingdom);

        if (!user) {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
            return true;
        }

        // إذا كان المستخدم أدمن أو مشرف، عرض قوائم الخيارات
        const isAdminUser = await isAdmin(user.jid, kingdom) || 
                           await isSuperAdminInKingdom(user.jid, kingdom) || 
                           await isModerator(user.jid, kingdom);

        if (isAdminUser) {
            // عرض قائمة الخيارات للأداريين
            const profileMenu = `👤 *ملف ${user.nickname}*

اختر ما تريد عرضه:

1️⃣ المعلومات الأساسية
2️⃣ الألعاب المبدوءة اليوم

📌 أرسل الرقم المناسب:`;

            // حفظ الحالة المعلقة
            const profileChoiceKey = `profile_choice_${sender}_${user.jid}`;
            pendingMentions[profileChoiceKey] = {
                action: 'profile_choice',
                nickname: user.nickname,
                requesterJid: sender,
                targetJid: user.jid
            };

            await sock.sendMessage(jid, { text: profileMenu });
        } else {
            // عرض المعلومات العادية للأعضاء العاديين
            await showUserStats(sock, jid, user.nickname, kingdom);
        }
        return true;
    }

    if (command === '/تغيير') {
        // الأدمن والأدمن الرئيسي والمشرفين يستطيعون تغيير ألقاب الأعضاء
        if (!userIsAdmin && !userIsSuperAdmin && !userIsModerator) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمنين الأساسيين والمشرفين يستطيعون تغيير الألقاب!' });
            return true;
        }

        // البحث عن كلمة "الى" في الأمر
        const alaaIndex = parts.findIndex(p => p.toLowerCase() === 'الى');
        
        if (alaaIndex === -1 || alaaIndex < 2 || alaaIndex === parts.length - 1) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /تغيير <اللقب الحالي> الى <اللقب الجديد>' });
            return true;
        }

        const currentNickname = parts.slice(1, alaaIndex).join(' ');
        const newNickname = parts.slice(alaaIndex + 1).join(' ');

        if (!currentNickname.trim() || !newNickname.trim()) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /تغيير <اللقب الحالي> الى <اللقب الجديد>' });
            return true;
        }

        await changeNickname(sock, jid, currentNickname, newNickname, sender);
        return true;
    }

    if (command === '/اسحب_اللقب') {
        // طلب منشن للعضو المراد استرجاع أو إنشاء لقبه
        await sock.sendMessage(jid, { 
            text: `✋ الرجاء عمل منشن (@) للعضو الذي تريد استرجاع لقبه.\n\n💡 ضع "رد" على الرسالة واكتب اسم العضو أو رقمه واضغط منشن.` 
        });

        // حفظ الحالة المعلقة
        pendingMentions[jid] = {
            action: 'retrieveNickname',
            requesterJid: sender
        };
        return true;
    }

    if (command === '/مشرفين') {
        await showAdminsAndMods(sock, jid, kingdom);
        return true;
    }

    if (command === '/قائمة') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن يستطيع عرض القائمة الكاملة!' });
            return true;
        }
        await showCompleteList(sock, jid, kingdom);
        return true;
    }

    if (command === '/أعضاء') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن يستطيع عرض قائمة الأعضاء!' });
            return true;
        }
        await showMembersList(sock, jid, kingdom);
        return true;
    }

    if (command === '/الكل' || command === '/جميع') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن يستطيع عرض جميع المستخدمين!' });
            return true;
        }
        await showAllUsers(sock, jid, kingdom);
        return true;
    }

    // أوامر الأدمن فقط
    if (command === '/بنك_إحصائيات') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!' });
            return true;
        }
        await showBankStats(sock, jid, kingdom);
        return true;
    }

    if (command === '/تعيين_أدمن') {
        // يمكن لأي شخص تعيين أدمن رئيسي إذا كان لديه كلمة المرور الصحيحة
        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /تعيين_أدمن <اللقب> <كلمة_المرور>' });
            return true;
        }

        const nickname = parts[1];
        const password = parts[2];

        if (!ADMIN_PASSWORD_CONFIGURED) {
            await sock.sendMessage(jid, { text: '❌ كلمة مرور الأدمن غير مضبوطة في ملف البيئة ADMIN_PASSWORD.' });
            return true;
        }

        // التحقق من كلمة المرور
        if (password !== ADMIN_PASSWORD) {
            await sock.sendMessage(jid, { text: '❌ كلمة المرور غير صحيحة!' });
            return true;
        }

        // البحث عن المستخدم
        const user = await User.findOne({ nickname: { $regex: nickname, $options: 'i' } });
        if (!user) {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
            return true;
        }

        // التحقق من أنه ليس أدمن بالفعل
        if (user.role === 'super_admin') {
            await sock.sendMessage(jid, { text: `⚠️ ${user.nickname} هو بالفعل أدمن رئيسي!` });
            return true;
        }

        // تعيين كأدمن رئيسي
        user.role = 'super_admin';
        await user.save();

        await sock.sendMessage(jid, { text: `✅ تم تعيين ${user.nickname} كأدمن رئيسي!` });
        console.log(`   ✅ تم تعيين ${user.nickname} كـ super_admin`);
        return true;
    }

    if (command === '/حذف_أدمن_نفسي') {
        // فقط super_admin يستطيع حذف نفسه من قاعدة البيانات بالكامل
        if (!userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!' });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /حذف_أدمن_نفسي <كلمة_المرور>' });
            return true;
        }

        const password = parts[1];

        if (!ADMIN_PASSWORD_CONFIGURED) {
            await sock.sendMessage(jid, { text: '❌ كلمة مرور الأدمن غير مضبوطة في ملف البيئة ADMIN_PASSWORD.' });
            return true;
        }

        // التحقق من كلمة المرور
        if (password !== ADMIN_PASSWORD) {
            await sock.sendMessage(jid, { text: '❌ كلمة المرور غير صحيحة!' });
            return true;
        }

        // البحث عن المستخدم الحالي
        const currentUser = await User.findOne({ jid: sender });
        if (!currentUser) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على ملفك!' });
            return true;
        }

        const userName = currentUser.nickname;

        // حذف المستخدم من قاعدة البيانات بالكامل
        await User.deleteOne({ jid: sender });

        await sock.sendMessage(jid, { text: `✅ تم حذف بيانات الأدمن "${userName}" بالكامل من النظام!` });
        console.log(`   🗑️ تم حذف ${userName} (${sender}) من قاعدة البيانات`);
        return true;
    }

    if (command === '/أوامر') {
        await showCommandsList(sock, jid, sender);
        return true;
    }

    if (command === '/الرتب') {
        const users = await User.find({ kingdom_id: kingdom }).sort({ [`rankStarsByKingdom.${kingdom}`]: -1 });
        let msg = getAllRanksDisplay(kingdom);
        msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        // تجميع الأعضاء حسب الرتب
        const rankMembers = {};
        for (const user of users) {
            const userRankStars = user.rankStarsByKingdom?.[kingdom] || 0;
            if (userRankStars > 0) {
                const highestRank = getHighestRank(kingdom, userRankStars);
                if (highestRank) {
                    if (!rankMembers[highestRank]) {
                        rankMembers[highestRank] = [];
                    }
                    rankMembers[highestRank].push(user);
                }
            }
        }

        // عرض الأعضاء حسب الرتب
        for (const [rankKey, members] of Object.entries(rankMembers)) {
            const rankInfo = getRankInfo(rankKey);
            if (rankInfo) {
                msg += `*${rankInfo.emoji} ${rankInfo.name}*\n`;
                for (const member of members) {
                    // لا تعرض النجوم للرتب العليا (التي تحتاج قرار إمبراطور)
                    const showStars = !rankInfo.specialDisplay;
                    const memberStars = member.rankStarsByKingdom?.[kingdom] || 0;
                    if (showStars) {
                        msg += `  • ${member.nickname} (${memberStars}⭐)\n`;
                    } else {
                        msg += `  • ${member.nickname}\n`;
                    }
                }
                msg += `\n`;
            }
        }

        // إرسال الرسالة على دفعات إذا كانت طويلة جداً
        if (msg.length > 4096) {
            const chunks = msg.match(/[\s\S]{1,4000}/g) || [];
            for (const chunk of chunks) {
                await sock.sendMessage(jid, { text: chunk });
            }
        } else {
            await sock.sendMessage(jid, { text: msg });
        }
        return true;
    }

    // أمر عرض النخبة
    if (command === '/النخبة') {
        await showElite(sock, jid, kingdom);
        return true;
    }

    if (command === '/مفاتيح_الرتب') {
        const keysTable = getRankKeysTable();
        await sock.sendMessage(jid, { text: keysTable });
        return true;
    }

    if (command === '/ترحيب') {
        // التحقق من أن الأمر يُستخدم فقط في مجموعة الاستقبال
        const kingdomData = getKingdomFromGroupJid(jid);
        const receptionGroupJid = kingdomData.groupIds[1]; // مجموعة الاستقبال (الثانية)
        const mainGroupJid = kingdomData.mainGroup; // المجموعة الأساسية
        
        if (jid !== receptionGroupJid) {
            await sock.sendMessage(jid, { text: '❌ أمر الترحيب يعمل *فقط* في مجموعة الاستقبال! 🤔' });
            return true;
        }

        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمنز والمشرفين يستطيعون إرسال رسالة الترحيب!' });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /ترحيب <اللقب>' });
            return true;
        }

        const targetNickname = parts.slice(1).join(' ');
        const user = await findUserByNickname(targetNickname, kingdom);

        if (!user) {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على عضو باسم "${targetNickname}" في هذه المملكة!` });
            return true;
        }

        // الحصول على معلومات المرسل (الأدمن أو المشرف)
        const senderInfo = await getUserInfo(sender, kingdom);
        if (!senderInfo) {
            await sock.sendMessage(jid, { text: '❌ خطأ في الحصول على معلوماتك!' });
            return true;
        }

        // استيراد البحث عن الصور والحالة المعلقة
        const { getCharacterImages } = await import('../utils/imageSearch.js');
        
        // البحث عن 4 صور
        await sock.sendMessage(jid, { 
            text: `⏳ جارٍ البحث عن صور للعضو *${user.nickname}*...`,
            mentions: [sender]
        });
        
        const imageBuffers = await getCharacterImages(user.nickname);
        
        const mentionText = getCleanMentionTextForUser(user);

        if (imageBuffers.length > 0) {
            // عرض الصور واحدة تلو الأخرى
            console.log(`✅ تم العثور على ${imageBuffers.length} صور للعضو ${user.nickname}`);
            
            let imageIndex = 0;
            
            for (const imageBuffer of imageBuffers) {
                imageIndex++;
                
                const imageMessage = `📸 *الصورة ${imageIndex} من ${imageBuffers.length}*\n\n👤 اللقب: *${user.nickname}*\n\n💡 رد بـ (${imageIndex}️⃣) لاختيار هذه الصورة\nأو انتظر الصور التالية`;
                
                try {
                    await sock.sendMessage(jid, {
                        image: imageBuffer,
                        caption: imageMessage
                    });
                } catch (imageError) {
                    console.warn(`⚠️ فشل إرسال الصورة ${imageIndex}: ${imageError.message}`);
                }
                
                // إضافة تأخير بسيط بين الصور
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // عرض رسالة الاختيار النهائية
            const selectionMessage = `🎯 *اختر صورة من ${imageBuffers.length}*\n\n💡 رد بـ رقم الصورة (1️⃣ أو 2️⃣ أو 3️⃣ أو 4️⃣) التي تفضلها`;
            
            await sock.sendMessage(jid, { text: selectionMessage });
            
            // حفظ بيانات الترحيب
            pendingMentions[`welcome_images_${jid}_${user.jid}`] = {
                action: 'welcome_images',
                nickname: user.nickname,
                userJid: user.jid,
                mentionText: mentionText,
                moderatorName: senderInfo.nickname,
                moderatorJid: sender,
                imageBuffers: imageBuffers,
                receptionGroupJid: receptionGroupJid,
                mainGroupJid: mainGroupJid,
                kingdom: kingdom
            };
            
            console.log(`⏳ في انتظار اختيار صورة للعضو ${user.nickname}`);
        } else {
            // لم يتم العثور على صور
            const confirmationMessage = `❌ *لم يتم العثور على صور - تأكيد الترحيب*\n\n👤 *اللقب:* ${user.nickname}\n\n💡 رد بـ (1️⃣) للموافقة والترحيب بدون صورة\nأو رد بـ (2️⃣) لإلغاء`;

            await sock.sendMessage(jid, { text: confirmationMessage });

            pendingMentions[`welcome_confirm_${jid}_${user.jid}`] = {
                action: 'welcome_confirm',
                nickname: user.nickname,
                userJid: user.jid,
                mentionText: mentionText,
                moderatorName: senderInfo.nickname,
                moderatorJid: sender,
                imageUrl: null,
                receptionGroupJid: receptionGroupJid,
                mainGroupJid: mainGroupJid,
                kingdom: kingdom
            };
        }
        return true;
    }

    if (command === '/إرسال_رسالة') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع إرسال رسائل إلى مجموعات أخرى!' });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /إرسال_رسالة <JID المجموعة> <نص الرسالة>' });
            return true;
        }

        const targetJid = parts[1];
        const messageText = parts.slice(2).join(' ');

        try {
            await sock.sendMessage(targetJid, { text: messageText });
            await sock.sendMessage(jid, { text: `✅ تم إرسال الرسالة إلى المجموعة بنجاح.` });
        } catch (error) {
            await sock.sendMessage(jid, { text: `❌ خطأ في إرسال الرسالة: ${error.message}` });
        }
        return true;
    }

    if (command === '/منح_إمبراطور') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع منح رتبة الإمبراطور!' });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /منح_إمبراطور <اللقب>' });
            return true;
        }

        const nickname = parts[1];
        await initiateEmperorGrant(sock, jid, nickname, sender);
        return true;
    }

    if (command === '/أضف_أدمن') {
        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /أضف_أدمن <كلمة_المرور>' });
            return true;
        }

        const password = parts[1];

        if (!ADMIN_PASSWORD_CONFIGURED) {
            await sock.sendMessage(jid, { text: '❌ كلمة مرور الأدمن غير مضبوطة في ملف البيئة ADMIN_PASSWORD.' });
            return true;
        }

        // التحقق من كلمة المرور
        if (password !== ADMIN_PASSWORD) {
            await sock.sendMessage(jid, { text: '❌ كلمة المرور غير صحيحة!' });
            return true;
        }

        // البحث عن المستخدم الحالي
        const currentUser = await User.findOne({ jid: sender });
        if (!currentUser) {
            await sock.sendMessage(jid, { text: '❌ لم يتم العثور على ملفك في قاعدة البيانات!' });
            return true;
        }

        // ترقية المستخدم إلى أدمن
        currentUser.role = 'admin';
        await currentUser.save();

        await sock.sendMessage(jid, { text: `✅ تم ترقيتك إلى أدمن بنجاح! 🎉\n\nيمكنك الآن استخدام جميع أوامر الإدارة.` });
        console.log(`   🛡️ تم ترقية ${currentUser.nickname} (${sender}) إلى أدمن`);
        return true;
    }

    if (command === '/jid') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع الحصول على JID المجموعة!' });
            return true;
        }

        // التحقق من أن الأمر في مجموعة
        if (!jid.endsWith('@g.us')) {
            await sock.sendMessage(jid, { text: '❌ هذا الأمر يعمل فقط في المجموعات!' });
            return true;
        }

        // إرسال JID المجموعة إلى الخاص للأدمن
        await sock.sendMessage(sender, { text: `📋 JID المجموعة الحالية:\n\n\`${jid}\`` });
        await sock.sendMessage(jid, { text: '✅ تم إرسال JID المجموعة إلى الخاص.' });
        return true;
    }
    if (command === '/رسالة_تحفيزية') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمن الرئيسي يستطيع إرسال رسائل تحفيزية فورية!' });
            return true;
        }

        // التحقق من أن الأمر في مجموعة
        if (!jid.endsWith('@g.us')) {
            await sock.sendMessage(jid, { text: '❌ هذا الأمر يعمل فقط في المجموعات!' });
            return true;
        }

        // الحصول على معلومات المملكة
        const { KINGDOMS } = await import('../config.js');
        const kingdomData = KINGDOMS[kingdom];

        if (!kingdomData) {
            await sock.sendMessage(jid, { text: '❌ خطأ في تحديد المملكة!' });
            return true;
        }

        // تحديد القروب المستهدف
        let targetJid = jid; // افتراضياً القروب الحالي
        let targetName = 'القروب الحالي';

        if (parts.length > 1) {
            const targetType = parts[1].toLowerCase();

            switch (targetType) {
                case 'أساسي':
                case 'رئيسي':
                case 'main':
                    targetJid = kingdomData.mainGroup;
                    targetName = 'القروب الأساسي';
                    break;

                case 'استقبال':
                case 'reception':
                    if (kingdomData.groupIds && kingdomData.groupIds.length > 1) {
                        targetJid = kingdomData.groupIds[1]; // القروب الثاني في المصفوفة
                        targetName = 'قروب الاستقبال';
                    } else {
                        await sock.sendMessage(jid, { text: '❌ لم يتم العثور على قروب الاستقبال!' });
                        return true;
                    }
                    break;

                case 'إضافي':
                case 'extra':
                case 'ثالث':
                    if (kingdomData.groupIds && kingdomData.groupIds.length > 2) {
                        targetJid = kingdomData.groupIds[2]; // القروب الثالث في المصفوفة
                        targetName = 'القروب الإضافي';
                    } else {
                        await sock.sendMessage(jid, { text: '❌ لم يتم العثور على قروب إضافي!' });
                        return true;
                    }
                    break;

                case 'أدمن':
                case 'admin':
                    // إذا كان هناك قروب أدمن محدد في الكونفيغ
                    if (kingdomData.adminGroup) {
                        targetJid = kingdomData.adminGroup;
                        targetName = 'قروب الأدمن';
                    } else {
                        await sock.sendMessage(jid, { text: '❌ لم يتم تحديد قروب أدمن لهذه المملكة!' });
                        return true;
                    }
                    break;

                case 'الكل':
                case 'all':
                    // إرسال لجميع القروبات في المملكة
                    const motivationalMessageAll = `🔥 *رسالة تحفيزية فورية* 🔥

🌟 أيها الأبطال في مملكة كلوفر! 🌟

🏰 أنتم في مملكة كلوفر الأسطورية - مملكة النجوم السوداء! 🏰

💪 قوتكم مذهلة وروحكم الجماعية رائعة! 💪
🚀 استمروا في الدعوة والمشاركة - المستقبل مشرق! 🚀

🎯 كل عضو جديد يقربكم من الانتصار! 🎯
🌟 أنتم الأفضل والأقوى - لا تتوقفوا! 🌟

⚡ الفرع الجديد ينتظركم - استمروا في التقدم! ⚡

🍀 مملكة كلوفر تشجعكم على الاستمرار! 🍀

🎊 *أنتم الأبطال الحقيقيون!*
🔥 *استمروا في الإبداع والتميز!*`;

                    let successCount = 0;
                    for (const groupId of kingdomData.groupIds) {
                        try {
                            await sock.sendMessage(groupId, { text: motivationalMessageAll });
                            successCount++;
                        } catch (error) {
                            console.error(`خطأ في إرسال الرسالة إلى ${groupId}:`, error);
                        }
                    }

                    await sock.sendMessage(jid, { text: `✅ تم إرسال رسالة تحفيزية فورية إلى ${successCount} قروب من أصل ${kingdomData.groupIds.length} قروب!` });
                    console.log(`✅ تم إرسال رسالة تحفيزية فورية لجميع قروبات مملكة ${kingdom}`);
                    return true;

                default:
                    await sock.sendMessage(jid, { text: '❌ استخدام: /رسالة_تحفيزية [أساسي|استقبال|إضافي|أدمن|الكل]\n\n💡 الأنواع المتاحة:\n• أساسي - القروب الرئيسي\n• استقبال - قروب الاستقبال\n• إضافي - القروب الإضافي\n• أدمن - قروب الأدمن\n• الكل - جميع القروبات' });
                    return true;
            }
        }

        // إنشاء رسالة تحفيزية فورية جميلة
        const motivationalMessage = `🔥 *رسالة تحفيزية فورية* 🔥

🌟 أيها الأبطال في مملكة كلوفر! 🌟

🏰 أنتم في مملكة كلوفر الأسطورية - مملكة النجوم السوداء! 🏰

💪 قوتكم مذهلة وروحكم الجماعية رائعة! 💪
🚀 استمروا في الدعوة والمشاركة - المستقبل مشرق! 🚀

🎯 كل عضو جديد يقربكم من الانتصار! 🎯
🌟 أنتم الأفضل والأقوى - لا تتوقفوا! 🌟

⚡ الفرع الجديد ينتظركم - استمروا في التقدم! ⚡

🍀 مملكة كلوفر تشجعكم على الاستمرار! 🍀

🎊 *أنتم الأبطال الحقيقيون!*
🔥 *استمروا في الإبداع والتميز!*`;

        try {
            await sock.sendMessage(targetJid, { text: motivationalMessage });
            await sock.sendMessage(jid, { text: `✅ تم إرسال رسالة تحفيزية فورية إلى ${targetName} بنجاح!` });
            console.log(`✅ تم إرسال رسالة تحفيزية فورية إلى ${targetName} لمملكة ${kingdom}`);
        } catch (error) {
            await sock.sendMessage(jid, { text: `❌ خطأ في إرسال الرسالة: ${error.message}` });
        }
        return true;
    }

    if (command === '/اسحب_اللقب' || command === '/استخرج_لقب') {
        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمنز والمشرفين يستطيعون استخراج الألقاب!' });
            return true;
        }

        // helper: الاقتباس من msg لتجنب التكرار أسفل
        const mentionedJids =
            msg.contextInfo?.mentionedJid ||
            msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
            [];

        // إذا لم يوجد منشن صريح، حاول استخدام المعرف الموجود في حالة الردّ
        let mentionedJid = null;
        if (mentionedJids.length > 0) {
            mentionedJid = mentionedJids[0];
        } else if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
            // participant هو JID المرسل في حال الإجابة
            mentionedJid = msg.message.extendedTextMessage.contextInfo.participant;
        }

        if (!mentionedJid) {
            await sock.sendMessage(jid, { text: '❌ الرجاء عمل منشن (@) للاعب الذي تريد معرفة لقبه!\n\nاستخدام: رد على رسالة واكتب /اسحب_اللقب مع عمل منشن للاعب' });
            return true;
        }

        try {
            const result = await getNicknameFromMention(sock, jid, mentionedJid, kingdom);

            let responseText = ``;

            if (result.isNewUser) {
                responseText = `\n👤 *مستخدم جديد*\n`;
                responseText += `📱 الرقم: ${result.phoneNumber}\n`;
                responseText += `🏷️ اللقب المعين: ${result.nickname} (اللقب الافتراضي)\n`;
                responseText += `\n✅ تم إنشاء ملف جديد للاعب!`;
            } else {
                responseText = `\n👤 *اللاعب*\n`;
                responseText += `🏷️ اللقب: ${result.nickname}`;
                
                if (result.isDefaultNickname) {
                    responseText += ` (⚠️ اللقب الافتراضي - لم يقم اللاعب بتغييره)`;
                }
                
                responseText += `\n`;
                
                if (result.user) {
                    responseText += `\n📊 معلومات إضافية:\n`;
                    responseText += `💰 النقاط: ${result.user.points || 0}\n`;
                    responseText += `🎮 العملات: ${result.user.coins || 0}\n`;
                    
                    const userRankStars = result.user.rankStarsByKingdom?.[kingdom] || 0;
                    if (userRankStars > 0) {
                        const highestRank = getHighestRank(kingdom, userRankStars);
                        if (highestRank) {
                            const rankInfo = getRankInfo(kingdom, highestRank);
                            if (rankInfo) {
                                responseText += `⭐ الرتبة: ${rankInfo.emoji} ${rankInfo.name} (${userRankStars}⭐)\n`;
                            }
                        }
                    }

                    const userKingdomRank = result.user.kingdomRankByKingdom?.[kingdom];
                    if (userKingdomRank) {
                        const kingdomRankInfo = getRankInfo(kingdom, userKingdomRank);
                        if (kingdomRankInfo) {
                            responseText += `👑 رتبة المملكة: ${kingdomRankInfo.emoji} ${kingdomRankInfo.name}\n`;
                        }
                    }
                }
            }

            await sock.sendMessage(jid, { text: responseText });
        } catch (error) {
            console.error('خطأ في استخراج اللقب:', error);
            await sock.sendMessage(jid, { text: `❌ خطأ في استخراج اللقب: ${error.message}` });
        }
        return true;
    }

    // أمر ملفي - عرض ملفك الشخصي
    if (command === '/ملفي') {
        // التحقق من أن المرسل أدمن أو مشرف
        if (!userIsAdmin && !userIsSuperAdmin && !userIsModerator) {
            return true;
        }

        const user = await User.findOne({ jid: sender, kingdom_id: kingdom });

        if (!user) {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على ملفك الشخصي!` });
            return true;
        }

        // عرض قائمة الخيارات للأداريين
        const profileMenu = `👤 *ملفك الشخصي*

اختر ما تريد عرضه:

1️⃣ المعلومات الأساسية
2️⃣ جلسات الألعاب الخاصة بك

📌 أرسل الرقم المناسب:`;

        // حفظ الحالة المعلقة
        const myProfileChoiceKey = `my_profile_choice_${sender}`;
        pendingMentions[myProfileChoiceKey] = {
            action: 'my_profile_choice',
            nickname: user.nickname,
            requesterJid: sender,
            targetJid: user.jid
        };

        await sock.sendMessage(jid, { text: profileMenu });
        return true;
    }

    // أمر التبليغ عن الإساءة
    if (command === '/تبليغ') {
        // يمكن لأي عضو إرسال تبليغ
        await sock.sendMessage(jid, { 
            text: `📢 *نموذج التبليغ عن الإساءة* 📢

الرجاء عمل منشن (@) للشخص المسيء:

💡 *خطوات التبليغ:*
1️⃣ ضع "رد" على هذه الرسالة
2️⃣ اكتب اسم الشخص أو رقمه
3️⃣ اضغط على منشن (@)

سيتم إرسال التبليغ إلى الأداريين بسرعة ⚡` 
        });

        // حفظ الحالة المعلقة
        pendingMentions[jid] = {
            action: 'report_mention',
            reporterJid: sender,
            requesterJid: sender
        };
        return true;
    }

    // أمر عرض القوانين
    if (command === '/قوانين') {
        await sendRulesMessage(sock, jid);
        return true;
    }

    // أمر إرسال رسالة التذكير (للأدمن فقط)
    if (command === '/تذكير') {
        if (!userIsAdmin && !userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمنز يستطيعون إرسال الرسائل التذكيرية!' });
            return true;
        }

        await sendReminderMessage(sock, jid);
        await sock.sendMessage(jid, { text: '✅ تم إرسال رسالة التذكير للمجموعة' });
        return true;
    }

    // أمر تفعيل التذكيرات الدورية (للأدمن فقط)
    if (command === '/تذكيرات_تلقائية') {
        if (!userIsAdmin && !userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمنز يستطيعون تفعيل التذكيرات الدورية!' });
            return true;
        }

        let intervalHours = 12; // القيمة الافتراضية
        if (parts.length > 1) {
            const parsedHours = parseInt(parts[1]);
            if (isNaN(parsedHours) || parsedHours < 1) {
                await sock.sendMessage(jid, { 
                    text: '❌ استخدام: /تذكيرات_تلقائية <عدد_الساعات>\n\n💡 مثال: /تذكيرات_تلقائية 12' 
                });
                return true;
            }
            intervalHours = parsedHours;
        }

        startReminderSystem(sock, jid, intervalHours);
        await sock.sendMessage(jid, { 
            text: `✅ تم تفعيل التذكيرات الدورية\n📅 ستُرسل رسالة تذكيرية كل ${intervalHours} ساعة` 
        });
        return true;
    }

    // أمر حذف الرسائل (للمشرفين والأدمنز)
    if (command === '/احذف') {
        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: '❌ فقط المشرفون والأدمنز يستطيعون حذف الرسائل!' });
            return true;
        }

        // دعم حذف عدة رسائل (مثلاً: /احذف 10)
        const numberArg = parts[1] ? parseInt(parts[1], 10) : NaN;
        if (!isNaN(numberArg) && numberArg > 0) {
            const deleteCount = Math.min(numberArg, 60); // لا نحذف أكثر من 60 رسالة
            const recent = getRecentMessages(jid);
            const toDelete = recent.slice(-deleteCount); // آخر N رسائل

            for (const key of toDelete) {
                try {
                    await sock.sendMessage(jid, { delete: key });
                } catch (error) {
                    console.warn('⚠️ فشل حذف رسالة:', error?.message || error);
                }
            }

            // حذف المفاتيح التي حاولنا حذفها من الكاش
            popRecentMessages(jid, toDelete.length);

            return true;
        }

        // في الحالة الافتراضية نعتمد على الرد لتحديد الرسالة للحذف
        if (!msg.message.extendedTextMessage || !msg.message.extendedTextMessage.contextInfo) {
            await sock.sendMessage(jid, { text: '❌ يجب أن تكون هذه الرسالة رد على الرسالة التي تريد حذفها!' });
            return true;
        }

        const contextInfo = msg.message.extendedTextMessage.contextInfo;
        if (!contextInfo.quotedMessage) {
            await sock.sendMessage(jid, { text: '❌ يجب أن تكون هذه الرسالة رد على الرسالة التي تريد حذفها!' });
            return true;
        }

        // محاولة حذف الرسالة المردود عليها (قد لا يكون متاحاً دائماً حسب الصلاحيات)
        try {
            await sock.sendMessage(jid, {
                delete: contextInfo.stanzaId ? { remoteJid: jid, id: contextInfo.stanzaId, participant: contextInfo.participant } : contextInfo.quotedMessage.key
            });
        } catch (error) {
            console.warn('⚠️ فشل حذف الرسالة المردود عليها:', error.message);
        }

        // حذف رسالة الأمر نفسها لإبقاء المحادثة نظيفة
        try {
            await sock.sendMessage(jid, { delete: msg.key });
        } catch (error) {
            console.warn('⚠️ فشل حذف رسالة الأمر:', error.message);
        }

        return true;
    }

    // أمر الترقية الفعلية (للأدمنز)
    if (command === '/اشراف') {
        if (!userIsAdmin && !userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: '❌ فقط الأدمنز يستطيعون ترقية الأعضاء فعلياً!' });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: '❌ استخدام: /اشراف <اللقب>' });
            return true;
        }

        const nickname = parts.slice(1).join(' ');
        const user = await findUserByNickname(nickname, kingdom);

        if (!user) {
            await sock.sendMessage(jid, { text: `❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
            return true;
        }

        try {
            // ترقية فعلية في المجموعة
            await sock.groupParticipantsUpdate(jid, [{ action: 'promote', participants: [user.jid] }]);
            await sock.sendMessage(jid, { text: `🔰 تم ترقية ${user.nickname} إلى مشرف فعلياً في المجموعة!` });
        } catch (error) {
            console.error('خطأ في الترقية الفعلية:', error);
            await sock.sendMessage(jid, { text: '❌ فشل في ترقية العضو!' });
        }
        return true;
    }

    // إذا لم يتم التعرف على الأمر، رُجِع false ليتم التعامل معه كأمر غير معروف
    return false;
}
