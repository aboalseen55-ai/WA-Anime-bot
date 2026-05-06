import mongoose from 'mongoose';
import User from '../database/userModel.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const term = 'يونا';
    const escaped = term.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'i');

    console.log('term:', term);
    console.log('regex:', regex);

    const user = await User.findOne({ nickname: regex });
    console.log('found:', user ? user.nickname : 'none');

    // Also show any users containing term (simple contain)
    const contained = await User.find({ nickname: { $regex: term, $options: 'i' } }).limit(5);
    console.log('contains results:', contained.map(u => u.nickname));

  } catch (err) {
    console.error('error', err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
