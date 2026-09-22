import { dashboardReply } from '../services/dashboardTemplates.js';
import User from "../database/userModel.js";
import { getHighestRank, displayRank, kingdomRanks } from "./rankSystem.js";

/**
 * عرض النخبة - جميع الأشخاص الذين لديهم رتب في المملكة
 */
export async function showElite(sock, jid, kingdom) {
  try {
    // جلب جميع المستخدمين الذين لديهم رتب في المملكة
    const users = await User.find({ 
      kingdom_id: kingdom,
      kingdomRankByKingdom: { $exists: true }
    }).sort({ createdAt: -1 });

    // تصفية المستخدمين الذين لديهم فعلاً رتبة في هذه المملكة
    const eliteUsers = users.filter(user => {
      const rank = user.kingdomRankByKingdom?.[kingdom];
      return rank && rank !== null;
    }).sort((a, b) => {
      // ترتيب حسب الرتبة (العالية أولاً)
      const rankA = a.kingdomRankByKingdom[kingdom];
      const rankB = b.kingdomRankByKingdom[kingdom];
      
      // الحصول على الترتيب من kingdomRanks
      const ranksArray = Object.keys(kingdomRanks[kingdom] || {});
      const indexA = ranksArray.indexOf(rankA);
      const indexB = ranksArray.indexOf(rankB);
      
      return indexA - indexB;
    });

    if (eliteUsers.length === 0) {
      await sock.sendMessage(jid, { 
        text: dashboardReply('reply_90f1bc29b133f9bd')(['❌ لا توجد نخبة في هذه المملكة حتى الآن!'])
      });
      return;
    }

    // بناء رسالة النخبة
    let report = dashboardReply('reply_fba9e96a13e498c3')`👑 *نخبة المملكة* 👑\n`;
    report += dashboardReply('reply_1e759a5d04d918d6')`━━━━━━━━━━━━━━━━━━━━━\n\n`;

    eliteUsers.forEach((user, index) => {
      const rank = user.kingdomRankByKingdom[kingdom];
      const rankDisplay = displayRank(kingdom, rank);
      report += dashboardReply('reply_79b7ec542ed4d68e')`${user.nickname}: ${rankDisplay}\n`;
      
      if (index < eliteUsers.length - 1) {
        report += dashboardReply('reply_8714f27dde14a3b3')`━━━━━━━━━━━━━━━━━━━━━\n`;
      }
    });

    report += dashboardReply('reply_5c93e9cf06272cb0')`\n━━━━━━━━━━━━━━━━━━━━━\n`;
    report += dashboardReply('reply_8c99a94cccd2576f')`📊 إجمالي النخبة: ${eliteUsers.length}`;

    await sock.sendMessage(jid, { text: report });
  } catch (error) {
    console.error('خطأ في عرض النخبة:', error);
    await sock.sendMessage(jid, { 
      text: dashboardReply('reply_995098e91c301286')(['❌ حدث خطأ في عرض النخبة!'])
    });
  }
}
