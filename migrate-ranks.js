// Migration script to separate ranks per kingdom
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './database/userModel.js';

dotenv.config();

async function migrateRanks() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/animebot');

    const users = await User.find({});
    let migrated = 0;

    for (const user of users) {
      if (user.rankStars && user.rankStars > 0) {
        if (!user.rankStarsByKingdom) user.rankStarsByKingdom = {};
        user.rankStarsByKingdom[user.kingdom_id] = user.rankStars;
        migrated++;
      }

      if (user.kingdomRank) {
        if (!user.kingdomRankByKingdom) user.kingdomRankByKingdom = {};
        user.kingdomRankByKingdom[user.kingdom_id] = user.kingdomRank;
        migrated++;
      }

      await user.save();
    }

    console.log(`✅ تم نقل ${migrated} رتبة إلى النظام الجديد`);
    process.exit(0);
  } catch (error) {
    console.error('خطأ في النقل:', error);
    process.exit(1);
  }
}

migrateRanks();