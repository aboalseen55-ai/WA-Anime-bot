/**
 * مثال على استخدام دالة البحث عن صور الشخصيات
 * ====================================
 */

import { searchCharacterImage, formatImageMessage } from '../utils/imageSearch.js';

// مثال 1: البحث عن صورة وإرسالها
export async function exampleSendWelcomeWithImage(sock, jid, nickname) {
    try {
        // البحث عن الصورة
        const imageUrl = await searchCharacterImage(nickname);
        
        if (!imageUrl) {
            // إذا لم تجد صورة، أرسل رسالة ترحيب بدون صورة
            await sock.sendMessage(jid, {
                text: `🎉 أهلاً وسهلاً بك يا ${nickname}!\n\nلم نتمكن من العثور على صورة، لكن nرحباً بك في المجتمع! 🍀`
            });
            return;
        }

        // تنسيق رسالة الترحيب
        const welcomeCaption = `
╔═══ ⊱ 🍀 CLOVER 🍀 ⊰ ═══╗

✧ يسعدنا انضمامك إلى عائلتنا
✧ مرحباً بك يا ${nickname}

← المزايا:
• لعب الألعاب والفوز بنقاط
• الترقيات والرتب
• مشاركة مع مجتمع رائع

╚═══ ⊱ 🍀 ⊰ ═══╝`;

        // إرسال الصورة مع الرسالة
        const messageOptions = formatImageMessage(imageUrl, welcomeCaption);
        
        if (messageOptions) {
            await sock.sendMessage(jid, messageOptions);
            console.log(`✅ تم إرسال ترحيب مع صورة للعضو: ${nickname}`);
        } else {
            throw new Error('فشل تنسيق رسالة الصورة');
        }
    } catch (error) {
        console.error('❌ خطأ في إرسال الترحيب مع الصورة:', error.message);
        
        // إرسال رسالة خطأ احتياطية
        await sock.sendMessage(jid, {
            text: `⚠️ حدث خطأ في إرسال صورة الترحيب، لكن مرحباً بك يا ${nickname}! 🍀`
        });
    }
}

// مثال 2: البحث فقط والحصول على الرابط
export async function exampleGetImageUrl(nickname) {
    try {
        const imageUrl = await searchCharacterImage(nickname);
        
        if (imageUrl) {
            console.log(`✅ رابط الصورة: ${imageUrl}`);
            return imageUrl;
        } else {
            console.log(`❌ لم يتم العثور على صورة للعضو: ${nickname}`);
            return null;
        }
    } catch (error) {
        console.error('❌ خطأ:', error.message);
        return null;
    }
}
