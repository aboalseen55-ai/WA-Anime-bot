import { dashboardReply } from '../services/dashboardTemplates.js';
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
import { getKingdomReportTimeZone, getNextDailyReportDate } from "../utils/dailyReports.js";
import { getRecentMessages, popRecentMessages } from "../utils/messageCache.js";
import { resolveAdvancedWelcomeSearch } from "../utils/advancedWelcomeSearch.js";

async function startWelcomeImageSelection(sock, jid, welcomeData, searchOptions = {}) {
    const { getCharacterImages } = await import('../utils/imageSearch.js');
    const searchLabel = searchOptions.characterName && searchOptions.animeName
        ? `${searchOptions.characterName} - ${searchOptions.animeName}`
        : welcomeData.nickname;

    await sock.sendMessage(jid, {
        text: dashboardReply('reply_ef90c404b1307d55')`⏳ جارٍ البحث عن صور أنمي لـ *${searchLabel}*...`,
        mentions: [welcomeData.moderatorJid]
    });

    const imageBuffers = await getCharacterImages(
        searchOptions.characterName || welcomeData.nickname,
        { searchQuery: searchOptions.searchQuery || welcomeData.nickname }
    );

    if (imageBuffers.length > 0) {
        for (const [index, imageBuffer] of imageBuffers.entries()) {
            const imageNumber = index + 1;
            await sock.sendMessage(jid, {
                image: imageBuffer,
                caption: `📸 *الصورة ${imageNumber} من ${imageBuffers.length}*\n\n👤 اللقب: *${welcomeData.nickname}*\n\nرد برقم الصورة لاختيارها.`
            }).catch((error) => console.warn(`⚠️ فشل إرسال صورة الترحيب: ${error.message}`));
        }

        await sock.sendMessage(jid, { text: dashboardReply('reply_e9181e32342dbd35')`🎯 اختر صورة من ${imageBuffers.length}: رد برقم الصورة.` });
        pendingMentions[`welcome_images_${jid}_${welcomeData.userJid}`] = {
            ...welcomeData,
            action: 'welcome_images',
            imageBuffers
        };
        return;
    }

    await sock.sendMessage(jid, {
        text: dashboardReply('reply_eac04ddb2086860d')`❌ *لم يتم العثور على صور أنمي مناسبة*\n\n👤 اللقب: ${welcomeData.nickname}\n\nرد بـ 1 للترحيب بدون صورة أو 2 للإلغاء.`
    });
    pendingMentions[`welcome_confirm_${jid}_${welcomeData.userJid}`] = {
        ...welcomeData,
        action: 'welcome_confirm',
        imageUrl: null
    };
}

export async function handleWelcomeModeStep(sock, jid, sender, text) {
    const key = Object.keys(pendingMentions).find((candidate) => (
        candidate.startsWith(`welcome_mode_${jid}_${sender}`)
        || (candidate.startsWith(`welcome_mode_${jid}_`) && pendingMentions[candidate]?.moderatorJid === sender)
    ));
    if (!key) return false;

    const state = pendingMentions[key];
    const answer = String(text || '').trim();
    if (!state) return false;

    if (state.action === 'welcome_mode') {
        if (answer === '1') {
            delete pendingMentions[key];
            await startWelcomeImageSelection(sock, jid, state);
            return true;
        }
        if (answer === '2') {
            state.action = 'welcome_advanced_character';
            await sock.sendMessage(jid, { text: dashboardReply('reply_3e60af889d6537e6')`اكتب اسم الشخصية للعضو *${state.nickname}*.` });
            return true;
        }
        await sock.sendMessage(jid, { text: dashboardReply('reply_8ba62cb9561ff1cb')(['اختر 1 للترحيب السريع أو 2 للترحيب المتقدم.']) });
        return true;
    }

    if (state.action === 'welcome_advanced_character') {
        if (answer.length < 2 || answer.length > 100) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_3e20622551f4d07d')(['اكتب اسم شخصية واضحًا، بين حرفين و100 حرف.']) });
            return true;
        }
        state.characterInput = answer;
        state.action = 'welcome_advanced_anime';
        await sock.sendMessage(jid, { text: dashboardReply('reply_1148e1245646d96d')(['اكتب اسم الأنمي الذي تظهر فيه الشخصية.']) });
        return true;
    }

    if (state.action === 'welcome_advanced_anime') {
        if (answer.length < 2 || answer.length > 100) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_854399586c917da7')(['اكتب اسم الأنمي بشكل أوضح.']) });
            return true;
        }

        delete pendingMentions[key];
        const resolved = await resolveAdvancedWelcomeSearch(state.characterInput, answer);
        await startWelcomeImageSelection(sock, jid, state, resolved);
        return true;
    }

    return false;
}

export async function handleAdminCommands(sock, jid, message, sender, msg) {

    // استخراج الأمر والمعاملات (مرة واحدة في الأعلى)
    var parts = message.split(' ');
    var command = parts[0].toLowerCase();

    // أمر إرسال تقرير إداري شامل (للأدمن الرئيسي فقط لكل مملكة)
    if (command === '/تقرير_اداري') {
        const kingdom = getKingdomIdFromGroupJid(jid);
        if (!kingdom) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_18cd5dd7994baf41')(['❌ هذا القروب غير مرتبط بأي مملكة في قاعدة البيانات.']) });
            return true;
        }
        const userIsSuperAdmin = await isSuperAdminInKingdom(sender, kingdom);
        if (!userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_50004d757234e192')(['❌ هذا الأمر متاح فقط للأدمن الرئيسي في هذه المملكة.']) });
            return true;
        }
        const kingdomData = KINGDOMS[kingdom];
        const adminGroupJid = kingdomData?.adminGroup;
        if (!adminGroupJid) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_9a3a72ef3a9d6317')(['❌ لا يوجد قروب إدارة لهذه المملكة، لذلك لن يتم إرسال التقرير.']) });
            return true;
        }

        const timeZone = getKingdomReportTimeZone(kingdomData);
        // إرسال تقرير الألعاب والتفاعل لإداريي هذه المملكة فقط
        await sendAdminsDailyReports(sock, adminGroupJid, kingdom, timeZone);
        // إرسال تقرير التفاعل اليومي (نفس منطق /التفاعل)
        const users = await User.find({ kingdom_id: kingdom, dailyMessages: { $gte: 1 } }).sort({ dailyMessages: -1 });
        if (!users.length) {
            await sock.sendMessage(adminGroupJid, { text: dashboardReply('reply_95c2fafbb311ec14')(['لا يوجد أعضاء لديهم تفاعل اليوم.']) });
        } else {
            let report = dashboardReply('reply_111672459858f21d')(['\u200F📊 *تفاعل الأعضاء اليومي*\n']);
            report += dashboardReply('reply_a8a5cc93eeba4c50')(['--------------------------\n']);
            const emojis = ['🥇', '🥈', '🥉'];
            users.forEach((user, idx) => {
                let line = '';
                if (idx < 3) {
                    line += `${emojis[idx]} `;
                }
                line += `${user.nickname}: ${user.dailyMessages}`;
                report += line + '\n';
                if (idx < 2 && idx < users.length - 1) {
                    report += dashboardReply('reply_f34432b690b0c5b4')(['_________________\n']);
                }
            });
            await sock.sendMessage(adminGroupJid, { text: report });
        }
        const now = new Date();
        const nextReport = getNextDailyReportDate(timeZone);
        const nowStr = now.toLocaleString('ar-EG', { timeZone });
        const nextReportStr = nextReport.toLocaleString('ar-EG', { timeZone });
        await sock.sendMessage(jid, {
            text: dashboardReply('reply_3d5bbdd0b5318f72')`✅ تم إرسال التقارير الإدارية لقروب إدارة المملكة.\n\n🕒 وقت المملكة الآن: ${nowStr}\n🌐 التوقيت: ${timeZone}\n📅 موعد التقرير اليومي التالي: ${nextReportStr}`
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
            await sock.sendMessage(jid, { text: dashboardReply('reply_9d8c6f2e3354fb01')(['❌ فقط الأدمن الأساسي أو المشرف يمكنهم عرض تفاعل الأعضاء!']) });
            return true;
        }
        // جلب جميع الأعضاء في المملكة الحالية
        const users = await User.find({ kingdom_id: kingdom, dailyMessages: { $gte: 1 } }).sort({ dailyMessages: -1 });
        if (!users.length) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_95c2fafbb311ec14')(['لا يوجد أعضاء لديهم تفاعل اليوم.']) });
            return true;
        }
        
        // حساب الإجمالي أولاً
        let totalInteractions = 0;
        users.forEach((user) => {
            totalInteractions += user.dailyMessages;
        });
        
        let report = dashboardReply('reply_111672459858f21d')(['\u200F📊 *تفاعل الأعضاء اليومي*\n']);
        report += dashboardReply('reply_a8a5cc93eeba4c50')(['--------------------------\n']);
        report += dashboardReply('reply_04a8cbd1144b9960')`📈 *التفاعل الإجمالي:* ${totalInteractions}\n`;
        report += dashboardReply('reply_a8a5cc93eeba4c50')(['--------------------------\n']);
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
                report += dashboardReply('reply_f34432b690b0c5b4')(['_________________\n']);
            }
        });

        await sock.sendMessage(jid, { text: report });
        return true;
    }

    // أمر طارئ: تصفير تفاعل اليوم وسجلات الألعاب
    if (command === '/يوم_جديد') {
        // يسمح فقط للأدمن الأساسي أو الأدمن الرئيسي
        if (!userIsAdmin && !userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_f1c405c7e7449acf')(['❌ فقط الأدمن الأساسي أو الأدمن الرئيسي يمكنهم تنفيذ هذا الأمر.']) });
            return true;
        }

        await User.updateMany({}, { dailyMessages: 0 });
        await resetDailyGameStats();

        await sock.sendMessage(jid, { text: dashboardReply('reply_32e89df332010124')(['✅ تم تصفير التفاعل اليومي وسجلات الألعاب لجميع المستخدمين (أمر طارئ).']) });
        return true;
    }

    // أوامر الأدمن فقط
    if (command === '/ترقية') {
        // الأدمن الأساسي والأدمن الرئيسي يستطيعون الترقية
        if (!userIsAdmin && !userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_fcc8a6a4a7bc3f03')(['❌ فقط الأدمن الأساسي يستطيع ترقية الأعضاء!']) });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_e47147b262ab39d7')(['❌ استخدام: /ترقية <اللقب>']) });
            return true;
        }

        const searchTerm = parts.slice(1).join(' ');
        const user = await findUserByNickname(searchTerm, kingdom);

        if (!user) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_7d4de7fcae9f5d88')`❌ لم يتم العثور على لاعب باسم "${searchTerm}"!` });
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
                text: dashboardReply('reply_8f44d050cd81f0f5')`✋ الرجاء عمل منشن (@) للاعب *${user.nickname}* لتسجيل رقمه وإتمام الترقية.\n\n💡 ضع "رد" على الرسالة واكتب اسم اللاعب أو رقمه واضغط منشن.`
            });
        }
        return true;
    }

    if (command === '/خفض') {
        // فقط super_admin يستطيع خفض الأدمنين الأساسيين والمشرفين
        if (!userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_cd158b67ddbb934c')(['❌ فقط الأدمن الرئيسي يستطيع خفض الأدمنين الأساسيين والمشرفين!']) });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_f8e6354cf644858c')(['❌ استخدام: /خفض <اللقب>']) });
            return true;
        }

        const searchTerm = parts.slice(1).join(' ');
        const user = await findUserByNickname(searchTerm, kingdom);

        if (user) {
            await demoteModerator(sock, jid, user.nickname, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: dashboardReply('reply_7d4de7fcae9f5d88')`❌ لم يتم العثور على لاعب باسم "${searchTerm}"!` });
        }
        return true;
    }

    if (command === '/نقاط') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_28d33a1a49b83718')(['❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!']) });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_2e40306b6de80c32')(['❌ استخدام: /نقاط <اللقب> <العدد>']) });
            return true;
        }

        const nickname = parts[1];
        const amount = parseInt(parts[2]);

        if (isNaN(amount)) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_67f29b70e772f1a9')(['❌ العدد يجب أن يكون رقماً!']) });
            return true;
        }

        const user = await findUserByNickname(nickname, kingdom);
        if (user) {
            await addPoints(sock, jid, user.nickname, amount, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c890aff4b7af93d6')`❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/عملات') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_28d33a1a49b83718')(['❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!']) });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_1666c256942d1c12')(['❌ استخدام: /عملات <اللقب> <العدد>']) });
            return true;
        }

        const nickname = parts[1];
        const amount = parseInt(parts[2]);

        if (isNaN(amount)) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_67f29b70e772f1a9')(['❌ العدد يجب أن يكون رقماً!']) });
            return true;
        }

        const user = await findUserByNickname(nickname, kingdom);
        if (user) {
            await addCoins(sock, jid, user.nickname, amount, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c890aff4b7af93d6')`❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/نجوم' || command === '/إضافة_نجوم') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_28d33a1a49b83718')(['❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!']) });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_3cd3a2959a49971d')(['❌ استخدام: /نجوم <اللقب> <العدد>']) });
            return true;
        }

        const nickname = parts[1];
        const amount = parseInt(parts[2]);

        if (isNaN(amount)) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_67f29b70e772f1a9')(['❌ العدد يجب أن يكون رقماً!']) });
            return true;
        }

        const user = await findUserByNickname(nickname, kingdom);
        if (user) {
            await addRankStars(sock, jid, user.nickname, amount, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c890aff4b7af93d6')`❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/إزالة_نجوم') {
        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_369251df510f153a')(['❌ فقط الأدمنين الأساسيين والمشرفين يستطيعون إزالة نجوم الرتبة!']) });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_111f0a7ab112c702')(['❌ استخدام: /إزالة_نجوم <اللقب> <العدد>']) });
            return true;
        }

        const nickname = parts[1];
        const amount = parseInt(parts[2]);

        if (isNaN(amount) || amount <= 0) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_9437dd9da35becf9')(['❌ العدد يجب أن يكون رقماً موجباً!']) });
            return true;
        }

        const user = await findUserByNickname(nickname, kingdom);
        if (user) {
            await removeRankStars(sock, jid, user.nickname, amount, sender);
        } else {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c890aff4b7af93d6')`❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    // أمر منح الرتب التي تحتاج قرار الإمبراطور
    if (command === '/منح_رتبة_إمبراطور') {
        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_f399ac2ff98182bb')(['❌ استخدام: /منح_رتبة_إمبراطور <اللقب> <مفتاح_الرتبة>']) });
            return true;
        }

        const nickname = parts[1];
        const rankKey = parts[2];

        const user = await findUserByNickname(nickname, kingdom);
        if (!user) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c890aff4b7af93d6')`❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
            return true;
        }

        await grantEmperorDecisionRank(sock, jid, user.nickname, rankKey, sender);
        return true;
    }

    // أوامر الأدمن والمشرفين لإزالة النقاط والعملات
    if (command === '/إزالة_نقاط') {
        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_505ffda78d85d3c2')(['❌ فقط الأدمنين الأساسيين والمشرفين يستطيعون إزالة النقاط!']) });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_d431aef2905ba5a2')(['❌ استخدام: /إزالة_نقاط <اللقب> <العدد>']) });
            return true;
        }

        const nickname = parts[1];
        const amount = parseInt(parts[2]);

        if (isNaN(amount) || amount <= 0) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_9437dd9da35becf9')(['❌ العدد يجب أن يكون رقماً موجباً!']) });
            return true;
        }

        const user = await findUserByNickname(nickname, kingdom);
        if (user) {
            await removePoints(sock, jid, user.nickname, amount, sender);
        } else {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c890aff4b7af93d6')`❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/إزالة_عملات') {
        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_91321c8e87aadb27')(['❌ فقط الأدمنين الأساسيين والمشرفين يستطيعون إزالة العملات!']) });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_8fc2ee50feb98f05')(['❌ استخدام: /إزالة_عملات <اللقب> <العدد>']) });
            return true;
        }

        const nickname = parts[1];
        const amount = parseInt(parts[2]);

        if (isNaN(amount) || amount <= 0) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_9437dd9da35becf9')(['❌ العدد يجب أن يكون رقماً موجباً!']) });
            return true;
        }

        const user = await findUserByNickname(nickname, kingdom);
        if (user) {
            await removeCoins(sock, jid, user.nickname, amount, sender);
        } else {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c890aff4b7af93d6')`❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    // أوامر الأدمن والمشرفين
    if (command === '/طرد') {
        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c9dea760af7677db')(['❌ فقط الأدمنين الأساسيين والمشرفين يستطيعون طرد الأعضاء!']) });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_2f7cc89ab7b88d42')(['❌ استخدام: /طرد <اللقب>']) });
            return true;
        }

        const nickname = parts.slice(1).join(' ');
        const user = await User.findOne({ nickname: { $regex: nickname, $options: 'i' }, kingdom_id: kingdom });

        if (user) {
            await kickMember(sock, jid, user.nickname, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c890aff4b7af93d6')`❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/حظر') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_aff590dcae12f7a8')(['❌ فقط الأدمن الرئيسي يستطيع حظر الأعضاء!']) });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_97ab87b818555a77')(['❌ استخدام: /حظر <اللقب> <السبب>']) });
            return true;
        }

        const nickname = parts[1];
        const reason = parts.slice(2).join(' ');

        const user = await User.findOne({ nickname: { $regex: nickname, $options: 'i' }, kingdom_id: kingdom });
        if (user) {
            await banMember(sock, jid, user.nickname, reason, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c890aff4b7af93d6')`❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/فكحظر') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_66ef068433c6c115')(['❌ فقط الأدمن الرئيسي يستطيع إزالة الحظر!']) });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_f570f1e092ab3560')(['❌ استخدام: /فكحظر <اللقب>']) });
            return true;
        }

        const nickname = parts.slice(1).join(' ');
        const user = await User.findOne({ nickname: { $regex: nickname, $options: 'i' }, kingdom_id: kingdom });

        if (user) {
            await unbanMember(sock, jid, user.nickname, sender, kingdom);
        } else {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c890aff4b7af93d6')`❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
        }
        return true;
    }

    if (command === '/حذف') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_453ffd1c0313902c')(['❌ فقط الأدمن الرئيسي يستطيع حذف بيانات المستخدمين!']) });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_db1aa305663c1b8d')(['❌ استخدام: /حذف <اللقب>']) });
            return true;
        }

        const nickname = parts.slice(1).join(' ');
        await deleteUser(sock, jid, nickname, sender);
        return true;
    }

    if (command === '/حذف_بدون_لقب') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_28d33a1a49b83718')(['❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!']) });
            return true;
        }

        await showDeleteWithoutNicknameConfirmation(sock, jid, sender);
        return true;
    }

    if (command === '/تأكيد_حذف_بدون_لقب') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_28d33a1a49b83718')(['❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!']) });
            return true;
        }

        await deleteUsersWithoutNickname(sock, jid, sender);
        return true;
    }

    // أوامر للجميع

    if (command === '/ملف') {
        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_b9b41ef055846b3f')(['❌ استخدام: /ملف <اللقب>']) });
            return true;
        }

        const nickname = parts.slice(1).join(' ');
        const user = await findUserByNickname(nickname, kingdom);

        if (!user) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c890aff4b7af93d6')`❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
            return true;
        }

        // إذا كان المستخدم أدمن أو مشرف، عرض قوائم الخيارات
        const isAdminUser = await isAdmin(user.jid, kingdom) || 
                           await isSuperAdminInKingdom(user.jid, kingdom) || 
                           await isModerator(user.jid, kingdom);

        if (isAdminUser) {
            // عرض قائمة الخيارات للأداريين
            const profileMenu = dashboardReply('reply_6b1754bb32d3f0f8')`👤 *ملف ${user.nickname}*

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
            await sock.sendMessage(jid, { text: dashboardReply('reply_1c4b89b975223845')(['❌ فقط الأدمنين الأساسيين والمشرفين يستطيعون تغيير الألقاب!']) });
            return true;
        }

        // البحث عن كلمة "الى" في الأمر
        const alaaIndex = parts.findIndex(p => p.toLowerCase() === 'الى');
        
        if (alaaIndex === -1 || alaaIndex < 2 || alaaIndex === parts.length - 1) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_6742beebb7db9ca5')(['❌ استخدام: /تغيير <اللقب الحالي> الى <اللقب الجديد>']) });
            return true;
        }

        const currentNickname = parts.slice(1, alaaIndex).join(' ');
        const newNickname = parts.slice(alaaIndex + 1).join(' ');

        if (!currentNickname.trim() || !newNickname.trim()) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_6742beebb7db9ca5')(['❌ استخدام: /تغيير <اللقب الحالي> الى <اللقب الجديد>']) });
            return true;
        }

        await changeNickname(sock, jid, currentNickname, newNickname, sender);
        return true;
    }

    if (command === '/اسحب_اللقب') {
        // طلب منشن للعضو المراد استرجاع أو إنشاء لقبه
        await sock.sendMessage(jid, { 
            text: dashboardReply('reply_dd45a8513b0071cc')`✋ الرجاء عمل منشن (@) للعضو الذي تريد استرجاع لقبه.\n\n💡 ضع "رد" على الرسالة واكتب اسم العضو أو رقمه واضغط منشن.`
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
            await sock.sendMessage(jid, { text: dashboardReply('reply_af73916bfe025a78')(['❌ فقط الأدمن يستطيع عرض القائمة الكاملة!']) });
            return true;
        }
        await showCompleteList(sock, jid, kingdom);
        return true;
    }

    if (command === '/أعضاء') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_98b28fbb88f99ed2')(['❌ فقط الأدمن يستطيع عرض قائمة الأعضاء!']) });
            return true;
        }
        await showMembersList(sock, jid, kingdom);
        return true;
    }

    if (command === '/الكل' || command === '/جميع') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_f7ed391fc8900346')(['❌ فقط الأدمن يستطيع عرض جميع المستخدمين!']) });
            return true;
        }
        await showAllUsers(sock, jid, kingdom);
        return true;
    }

    // أوامر الأدمن فقط
    if (command === '/بنك_إحصائيات') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_28d33a1a49b83718')(['❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!']) });
            return true;
        }
        await showBankStats(sock, jid, kingdom);
        return true;
    }

    if (command === '/تعيين_أدمن') {
        // يمكن لأي شخص تعيين أدمن رئيسي إذا كان لديه كلمة المرور الصحيحة
        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_23883bfde33bea8f')(['❌ استخدام: /تعيين_أدمن <اللقب> <كلمة_المرور>']) });
            return true;
        }

        const nickname = parts[1];
        const password = parts[2];

        if (!ADMIN_PASSWORD_CONFIGURED) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_d6b1ca919485ca57')(['❌ كلمة مرور الأدمن غير مضبوطة في ملف البيئة ADMIN_PASSWORD.']) });
            return true;
        }

        // التحقق من كلمة المرور
        if (password !== ADMIN_PASSWORD) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_8c88350c12f79579')(['❌ كلمة المرور غير صحيحة!']) });
            return true;
        }

        // البحث عن المستخدم
        const user = await User.findOne({ nickname: { $regex: nickname, $options: 'i' } });
        if (!user) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c890aff4b7af93d6')`❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
            return true;
        }

        // التحقق من أنه ليس أدمن بالفعل
        if (user.role === 'super_admin') {
            await sock.sendMessage(jid, { text: dashboardReply('reply_32255d9c8e8b0a16')`⚠️ ${user.nickname} هو بالفعل أدمن رئيسي!` });
            return true;
        }

        // تعيين كأدمن رئيسي
        user.role = 'super_admin';
        await user.save();

        await sock.sendMessage(jid, { text: dashboardReply('reply_3c58e4da0f51d066')`✅ تم تعيين ${user.nickname} كأدمن رئيسي!` });
        console.log(`   ✅ تم تعيين ${user.nickname} كـ super_admin`);
        return true;
    }

    if (command === '/حذف_أدمن_نفسي') {
        // فقط super_admin يستطيع حذف نفسه من قاعدة البيانات بالكامل
        if (!userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_28d33a1a49b83718')(['❌ فقط الأدمن الرئيسي يستطيع تنفيذ هذا الأمر!']) });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_4b8acf9724b3a20a')(['❌ استخدام: /حذف_أدمن_نفسي <كلمة_المرور>']) });
            return true;
        }

        const password = parts[1];

        if (!ADMIN_PASSWORD_CONFIGURED) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_d6b1ca919485ca57')(['❌ كلمة مرور الأدمن غير مضبوطة في ملف البيئة ADMIN_PASSWORD.']) });
            return true;
        }

        // التحقق من كلمة المرور
        if (password !== ADMIN_PASSWORD) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_8c88350c12f79579')(['❌ كلمة المرور غير صحيحة!']) });
            return true;
        }

        // البحث عن المستخدم الحالي
        const currentUser = await User.findOne({ jid: sender });
        if (!currentUser) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_dc18d0b04dade621')(['❌ لم يتم العثور على ملفك!']) });
            return true;
        }

        const userName = currentUser.nickname;

        // حذف المستخدم من قاعدة البيانات بالكامل
        await User.deleteOne({ jid: sender });

        await sock.sendMessage(jid, { text: dashboardReply('reply_eb12dba7469edc3a')`✅ تم حذف بيانات الأدمن "${userName}" بالكامل من النظام!` });
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
        msg += dashboardReply('reply_fb743cfed08a0636')`━━━━━━━━━━━━━━━━━━━━\n\n`;

        // تجميع الأعضاء حسب الرتب
        const rankMembers = {};
        for (const user of users) {
            const userRankStars = user.rankStarsByKingdom?.[kingdom] || 0;
            const storedRank = user.kingdomRankByKingdom?.[kingdom];
            if (storedRank || userRankStars > 0) {
                const highestRank = storedRank || getHighestRank(kingdom, userRankStars);
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
            const rankInfo = getRankInfo(kingdom, rankKey);
            if (rankInfo) {
                msg += dashboardReply('reply_901b6ca6da19932b')`*${rankInfo.emoji} ${rankInfo.name}*\n`;
                for (const member of members) {
                    // لا تعرض النجوم للرتب العليا (التي تحتاج قرار إمبراطور)
                    const showStars = !rankInfo.requiresEmperorDecision;
                    const memberStars = member.rankStarsByKingdom?.[kingdom] || 0;
                    if (showStars) {
                        msg += dashboardReply('reply_43efddee2330b086')`  • ${member.nickname} (${memberStars}⭐)\n`;
                    } else {
                        msg += dashboardReply('reply_4760548a4fdab337')`  • ${member.nickname}\n`;
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
        if (!kingdomData) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_18cd5dd7994baf41')(['❌ هذا القروب غير مرتبط بأي مملكة في قاعدة البيانات.']) });
            return true;
        }

        const receptionGroupJid = kingdomData.receptionGroup || kingdomData.groupIds?.[1];
        const mainGroupJid = kingdomData.mainGroup;
        
        if (jid !== receptionGroupJid) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_eccad0c0f5da734a')(['❌ أمر الترحيب يعمل *فقط* في مجموعة الاستقبال! 🤔']) });
            return true;
        }

        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_92b10acea48cd58b')(['❌ فقط الأدمنز والمشرفين يستطيعون إرسال رسالة الترحيب!']) });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_041428e979e24b0d')(['❌ استخدام: /ترحيب <اللقب>']) });
            return true;
        }

        const targetNickname = parts.slice(1).join(' ');
        const user = await findUserByNickname(targetNickname, kingdom);

        if (!user) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_adc626f36783ef3a')`❌ لم يتم العثور على عضو باسم "${targetNickname}" في هذه المملكة!` });
            return true;
        }

        const senderInfo = await getUserInfo(sender, kingdom);
        if (!senderInfo) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_45cc074cc7677aa3')(['❌ خطأ في الحصول على معلوماتك!']) });
            return true;
        }

        const welcomeData = {
            action: 'welcome_mode',
            nickname: user.nickname,
            userJid: user.jid,
            mentionText: getCleanMentionTextForUser(user),
            moderatorName: senderInfo.nickname,
            moderatorJid: sender,
            receptionGroupJid,
            mainGroupJid,
            kingdom
        };
        pendingMentions[`welcome_mode_${jid}_${sender}`] = welcomeData;
        await sock.sendMessage(jid, {
            text: dashboardReply('reply_1f19ca990102a465')`👋 *ترحيب العضو: ${user.nickname}*\n\n1️⃣ سريع — بحث تلقائي باللقب\n2️⃣ متقدم — تحدد الشخصية والأنمي`,
            mentions: [sender]
        });
        return true;
    }

    if (command === '/إرسال_رسالة') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_4f9d79844c80b089')(['❌ فقط الأدمن الرئيسي يستطيع إرسال رسائل إلى مجموعات أخرى!']) });
            return true;
        }

        if (parts.length < 3) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_9eac88a7fcec3b00')(['❌ استخدام: /إرسال_رسالة <JID المجموعة> <نص الرسالة>']) });
            return true;
        }

        const targetJid = parts[1];
        const messageText = parts.slice(2).join(' ');

        try {
            await sock.sendMessage(targetJid, { text: messageText });
            await sock.sendMessage(jid, { text: dashboardReply('reply_4f4cfaab8d52fb1c')`✅ تم إرسال الرسالة إلى المجموعة بنجاح.` });
        } catch (error) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_caa9d9ad4861133d')`❌ خطأ في إرسال الرسالة: ${error.message}` });
        }
        return true;
    }

    if (command === '/منح_إمبراطور') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_40d440bfb136ff35')(['❌ فقط الأدمن الرئيسي يستطيع منح رتبة الإمبراطور!']) });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_de909179a53769d9')(['❌ استخدام: /منح_إمبراطور <اللقب>']) });
            return true;
        }

        const nickname = parts[1];
        await initiateEmperorGrant(sock, jid, nickname, sender);
        return true;
    }

    if (command === '/أضف_أدمن') {
        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_a62f10765a983019')(['❌ استخدام: /أضف_أدمن <كلمة_المرور>']) });
            return true;
        }

        const password = parts[1];

        if (!ADMIN_PASSWORD_CONFIGURED) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_d6b1ca919485ca57')(['❌ كلمة مرور الأدمن غير مضبوطة في ملف البيئة ADMIN_PASSWORD.']) });
            return true;
        }

        // التحقق من كلمة المرور
        if (password !== ADMIN_PASSWORD) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_8c88350c12f79579')(['❌ كلمة المرور غير صحيحة!']) });
            return true;
        }

        // البحث عن المستخدم الحالي
        const currentUser = await User.findOne({ jid: sender });
        if (!currentUser) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_78f8b32474be7d5c')(['❌ لم يتم العثور على ملفك في قاعدة البيانات!']) });
            return true;
        }

        // ترقية المستخدم إلى أدمن
        currentUser.role = 'admin';
        await currentUser.save();

        await sock.sendMessage(jid, { text: dashboardReply('reply_ff2151b1496595af')`✅ تم ترقيتك إلى أدمن بنجاح! 🎉\n\nيمكنك الآن استخدام جميع أوامر الإدارة.` });
        console.log(`   🛡️ تم ترقية ${currentUser.nickname} (${sender}) إلى أدمن`);
        return true;
    }

    if (command === '/jid') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_6f2f8b641f096b86')(['❌ فقط الأدمن الرئيسي يستطيع الحصول على JID المجموعة!']) });
            return true;
        }

        // التحقق من أن الأمر في مجموعة
        if (!jid.endsWith('@g.us')) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_a903b5bbe48c9a62')(['❌ هذا الأمر يعمل فقط في المجموعات!']) });
            return true;
        }

        // إرسال JID المجموعة إلى الخاص للأدمن
        await sock.sendMessage(sender, { text: dashboardReply('reply_2b03889e7770ce54')`📋 JID المجموعة الحالية:\n\n\`${jid}\`` });
        await sock.sendMessage(jid, { text: dashboardReply('reply_2ad18296da1d4b69')(['✅ تم إرسال JID المجموعة إلى الخاص.']) });
        return true;
    }
    if (command === '/رسالة_تحفيزية') {
        if (!userIsAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_ab46e2d1a02ff74e')(['❌ فقط الأدمن الرئيسي يستطيع إرسال رسائل تحفيزية فورية!']) });
            return true;
        }

        // التحقق من أن الأمر في مجموعة
        if (!jid.endsWith('@g.us')) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_a903b5bbe48c9a62')(['❌ هذا الأمر يعمل فقط في المجموعات!']) });
            return true;
        }

        // الحصول على معلومات المملكة
        const { KINGDOMS } = await import('../config.js');
        const kingdomData = KINGDOMS[kingdom];

        if (!kingdomData) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_3971da22ad398462')(['❌ خطأ في تحديد المملكة!']) });
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
                        await sock.sendMessage(jid, { text: dashboardReply('reply_0797cb99533bd077')(['❌ لم يتم العثور على قروب الاستقبال!']) });
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
                        await sock.sendMessage(jid, { text: dashboardReply('reply_0d33aafa37733709')(['❌ لم يتم العثور على قروب إضافي!']) });
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
                        await sock.sendMessage(jid, { text: dashboardReply('reply_1914caee57442ff6')(['❌ لم يتم تحديد قروب أدمن لهذه المملكة!']) });
                        return true;
                    }
                    break;

                case 'الكل':
                case 'all':
                    // إرسال لجميع القروبات في المملكة
                    const motivationalMessageAll = dashboardReply('reply_67a94a56dae46c35')`✨ *رسالة تحفيزية*

تفاعلكم جميل وواضح.
استمروا بالمشاركة والدعوة بهدوء.

كل عضو جديد يضيف جوًا أحلى للمجموعة.`;

                    let successCount = 0;
                    for (const groupId of kingdomData.groupIds) {
                        try {
                            await sock.sendMessage(groupId, { text: motivationalMessageAll });
                            successCount++;
                        } catch (error) {
                            console.error(`خطأ في إرسال الرسالة إلى ${groupId}:`, error);
                        }
                    }

                    await sock.sendMessage(jid, { text: dashboardReply('reply_5ffa5602d36741f7')`✅ تم إرسال رسالة تحفيزية فورية إلى ${successCount} قروب من أصل ${kingdomData.groupIds.length} قروب!` });
                    console.log(`✅ تم إرسال رسالة تحفيزية فورية لجميع قروبات مملكة ${kingdom}`);
                    return true;

                default:
                    await sock.sendMessage(jid, { text: dashboardReply('reply_6697de0ec33170e3')(['❌ استخدام: /رسالة_تحفيزية [أساسي|استقبال|إضافي|أدمن|الكل]\n\n💡 الأنواع المتاحة:\n• أساسي - القروب الرئيسي\n• استقبال - قروب الاستقبال\n• إضافي - القروب الإضافي\n• أدمن - قروب الأدمن\n• الكل - جميع القروبات']) });
                    return true;
            }
        }

        // إنشاء رسالة تحفيزية فورية جميلة
        const motivationalMessage = dashboardReply('reply_67a94a56dae46c35')`✨ *رسالة تحفيزية*

تفاعلكم جميل وواضح.
استمروا بالمشاركة والدعوة بهدوء.

كل عضو جديد يضيف جوًا أحلى للمجموعة.`;

        try {
            await sock.sendMessage(targetJid, { text: motivationalMessage });
            await sock.sendMessage(jid, { text: dashboardReply('reply_27b72d5c5e829274')`✅ تم إرسال رسالة تحفيزية فورية إلى ${targetName} بنجاح!` });
            console.log(`✅ تم إرسال رسالة تحفيزية فورية إلى ${targetName} لمملكة ${kingdom}`);
        } catch (error) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_caa9d9ad4861133d')`❌ خطأ في إرسال الرسالة: ${error.message}` });
        }
        return true;
    }

    if (command === '/اسحب_اللقب' || command === '/استخرج_لقب') {
        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_a0af414fe548e97b')(['❌ فقط الأدمنز والمشرفين يستطيعون استخراج الألقاب!']) });
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
            await sock.sendMessage(jid, { text: dashboardReply('reply_be00339b5644e1d5')(['❌ الرجاء عمل منشن (@) للاعب الذي تريد معرفة لقبه!\n\nاستخدام: رد على رسالة واكتب /اسحب_اللقب مع عمل منشن للاعب']) });
            return true;
        }

        try {
            const result = await getNicknameFromMention(sock, jid, mentionedJid, kingdom);

            let responseText = ``;

            if (result.isNewUser) {
                responseText = dashboardReply('reply_e875dd72c3e8d99c')`\n👤 *مستخدم جديد*\n`;
                responseText += dashboardReply('reply_eb4af8fc4afc55b7')`📱 الرقم: ${result.phoneNumber}\n`;
                responseText += dashboardReply('reply_07e7e39b254b48d6')`🏷️ اللقب المعين: ${result.nickname} (اللقب الافتراضي)\n`;
                responseText += dashboardReply('reply_fe4d8952e55a8273')`\n✅ تم إنشاء ملف جديد للاعب!`;
            } else {
                responseText = dashboardReply('reply_b31b4f9fb2d653e1')`\n👤 *اللاعب*\n`;
                responseText += dashboardReply('reply_7bf4b1c4f794a28c')`🏷️ اللقب: ${result.nickname}`;
                
                if (result.isDefaultNickname) {
                    responseText += dashboardReply('reply_61e7e966e1792fa1')` (⚠️ اللقب الافتراضي - لم يقم اللاعب بتغييره)`;
                }
                
                responseText += `\n`;
                
                if (result.user) {
                    responseText += dashboardReply('reply_ae96ff249b6454ad')`\n📊 معلومات إضافية:\n`;
                    responseText += dashboardReply('reply_745ecfa46ebab380')`💰 النقاط: ${result.user.points || 0}\n`;
                    responseText += dashboardReply('reply_8223d9246f25ff04')`🎮 العملات: ${result.user.coins || 0}\n`;
                    
                    const userRankStars = result.user.rankStarsByKingdom?.[kingdom] || 0;
                    if (userRankStars > 0) {
                        const highestRank = getHighestRank(kingdom, userRankStars);
                        if (highestRank) {
                            const rankInfo = getRankInfo(kingdom, highestRank);
                            if (rankInfo) {
                                responseText += dashboardReply('reply_7f3ac533bbb87a94')`⭐ الرتبة: ${rankInfo.emoji} ${rankInfo.name} (${userRankStars}⭐)\n`;
                            }
                        }
                    }

                    const userKingdomRank = result.user.kingdomRankByKingdom?.[kingdom];
                    if (userKingdomRank) {
                        const kingdomRankInfo = getRankInfo(kingdom, userKingdomRank);
                        if (kingdomRankInfo) {
                            responseText += dashboardReply('reply_58592c0668946359')`👑 رتبة المملكة: ${kingdomRankInfo.emoji} ${kingdomRankInfo.name}\n`;
                        }
                    }
                }
            }

            await sock.sendMessage(jid, { text: responseText });
        } catch (error) {
            console.error('خطأ في استخراج اللقب:', error);
            await sock.sendMessage(jid, { text: dashboardReply('reply_8df15bae4a517af4')`❌ خطأ في استخراج اللقب: ${error.message}` });
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
            await sock.sendMessage(jid, { text: dashboardReply('reply_ce7466fa0b2541e8')`❌ لم يتم العثور على ملفك الشخصي!` });
            return true;
        }

        // عرض قائمة الخيارات للأداريين
        const profileMenu = dashboardReply('reply_10748d687225d3a3')`👤 *ملفك الشخصي*

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
            text: dashboardReply('reply_c58f4d68d06259a6')`📢 *نموذج التبليغ عن الإساءة* 📢

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
            await sock.sendMessage(jid, { text: dashboardReply('reply_5c695a5cfe4615eb')(['❌ فقط الأدمنز يستطيعون إرسال الرسائل التذكيرية!']) });
            return true;
        }

        await sendReminderMessage(sock, jid);
        await sock.sendMessage(jid, { text: dashboardReply('reply_bdecf0d80bec294d')(['✅ تم إرسال رسالة التذكير للمجموعة']) });
        return true;
    }

    // أمر تفعيل التذكيرات الدورية (للأدمن فقط)
    if (command === '/تذكيرات_تلقائية') {
        if (!userIsAdmin && !userIsSuperAdmin) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_a22275854152094a')(['❌ فقط الأدمنز يستطيعون تفعيل التذكيرات الدورية!']) });
            return true;
        }

        let intervalHours = 12; // القيمة الافتراضية
        if (parts.length > 1) {
            const parsedHours = parseInt(parts[1]);
            if (isNaN(parsedHours) || parsedHours < 1) {
                await sock.sendMessage(jid, { 
                    text: dashboardReply('reply_280e8778293d6e11')(['❌ استخدام: /تذكيرات_تلقائية <عدد_الساعات>\n\n💡 مثال: /تذكيرات_تلقائية 12'])
                });
                return true;
            }
            intervalHours = parsedHours;
        }

        startReminderSystem(sock, jid, intervalHours);
        await sock.sendMessage(jid, { 
            text: dashboardReply('reply_1d1432818fa975c6')`✅ تم تفعيل التذكيرات الدورية\n📅 ستُرسل رسالة تذكيرية كل ${intervalHours} ساعة`
        });
        return true;
    }

    // أمر حذف الرسائل (للمشرفين والأدمنز)
    if (command === '/احذف') {
        if (!userIsModerator) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_3a143e3392d3a1ad')(['❌ فقط المشرفون والأدمنز يستطيعون حذف الرسائل!']) });
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
            await sock.sendMessage(jid, { text: dashboardReply('reply_9bdaeb928fd3e0c8')(['❌ يجب أن تكون هذه الرسالة رد على الرسالة التي تريد حذفها!']) });
            return true;
        }

        const contextInfo = msg.message.extendedTextMessage.contextInfo;
        if (!contextInfo.quotedMessage) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_9bdaeb928fd3e0c8')(['❌ يجب أن تكون هذه الرسالة رد على الرسالة التي تريد حذفها!']) });
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
            await sock.sendMessage(jid, { text: dashboardReply('reply_a38bb58a612f5396')(['❌ فقط الأدمنز يستطيعون ترقية الأعضاء فعلياً!']) });
            return true;
        }

        if (parts.length < 2) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_6b86c5b043f8cda8')(['❌ استخدام: /اشراف <اللقب>']) });
            return true;
        }

        const nickname = parts.slice(1).join(' ');
        const user = await findUserByNickname(nickname, kingdom);

        if (!user) {
            await sock.sendMessage(jid, { text: dashboardReply('reply_c890aff4b7af93d6')`❌ لم يتم العثور على لاعب باسم "${nickname}"!` });
            return true;
        }

        try {
            // ترقية فعلية في المجموعة
            await sock.groupParticipantsUpdate(jid, [{ action: 'promote', participants: [user.jid] }]);
            await sock.sendMessage(jid, { text: dashboardReply('reply_26ef37fed6bdf7b5')`🔰 تم ترقية ${user.nickname} إلى مشرف فعلياً في المجموعة!` });
        } catch (error) {
            console.error('خطأ في الترقية الفعلية:', error);
            await sock.sendMessage(jid, { text: dashboardReply('reply_f5d06507ffb22723')(['❌ فشل في ترقية العضو!']) });
        }
        return true;
    }

    // إذا لم يتم التعرف على الأمر، رُجِع false ليتم التعامل معه كأمر غير معروف
    return false;
}
