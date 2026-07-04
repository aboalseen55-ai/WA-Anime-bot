// db.js
import mongoose from 'mongoose';
import 'dotenv/config';

const MONGO_URI = process.env.MONGO_URI;

export async function connectDB() {
    try {
        if (!MONGO_URI) {
            throw new Error('MONGO_URI is not configured in the environment');
        }

        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            family: 4,
            maxPoolSize: 10,
        });
        console.log('✅ MongoDB connected successfully');
    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
    }
}

export async function testDB() {
    try {
        const admin = mongoose.connection.db.admin();
        const info = await admin.serverStatus();
        console.log('MongoDB server info:', { version: info.version, connections: info.connections });
    } catch (err) {
        console.error('❌ DB test error:', err);
    }
}

// User Schema
const userSchema = new mongoose.Schema({
  jid: { type: String, required: true, unique: true },
  nickname: { type: String, default: null },
  lastMessage: { type: String, default: null },
  updatedAt: { type: Date, default: Date.now }
});

// تصدير الموديل عشان نقدر نستخدمه في index.js
export const User = mongoose.model('User', userSchema);
