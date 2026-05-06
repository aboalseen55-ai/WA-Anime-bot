import axios from 'axios';
import sharp from 'sharp';
import * as cheerio from 'cheerio';

// الصيغ المقبولة للصور
const ACCEPTED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

/**
 * البحث عن صور شخصية أنمي باستخدام Bing Images (Scraping مباشر)
 * @param {string} nickname - لقب العضو المرحب به
 * @returns {Promise<Array<Buffer>>} - مصفوفة من Buffers الصور المحولة إلى JPEG
 */
export async function getCharacterImages(nickname) {
    try {
        if (!nickname || nickname.trim() === '') {
            console.warn('⚠️ لقب العضو فارغ');
            return [];
        }

        console.log(`🔍 جاري البحث عن صور "${nickname}" في Bing Images...`);

        // البحث في Bing Images باستخدام scraping مباشر (بحث باسم اللقب مع كلمة "شخصية")
        const searchQuery = encodeURIComponent(`شخصية ${nickname}`);
        const searchUrl = `https://www.bing.com/images/search?q=${searchQuery}`;

        console.log('📡 إرسال طلب البحث...');
        const { data: html } = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 15000
        });

        console.log('📨 تم استلام النتائج، جاري استخراج الروابط...');

        // استخراج روابط الصور الكاملة من Bing Images
        const $ = cheerio.load(html);
        const imageUrls = [];

        // أولوية: استخراج من img مع تحسين parameters للحصول على صور شخصيات أنمي
        $('.iusc img').each((i, elem) => {
            let src = $(elem).attr('src') || $(elem).attr('data-src') || $(elem).attr('data-delayed-src');
            if (src && src.includes('http') && !src.includes('svg') && imageUrls.length < 6) {
                // تحسين parameters للحصول على صور أكبر
                src = src.replace(/w=\d+/, 'w=800').replace(/h=\d+/, 'h=800');
                imageUrls.push(src);
            }
        });

        // إذا لم نجد، ابحث عن data-m attributes في div.iusc للروابط الكاملة
        if (imageUrls.length === 0) {
            $('.iusc').each((i, elem) => {
                const dataM = $(elem).attr('data-m');
                if (dataM) {
                    try {
                        const data = JSON.parse(dataM);
                        if (data.murl && data.murl.startsWith('http')) {
                            imageUrls.push(data.murl);
                        }
                    } catch (e) {
                        // تجاهل JSON غير صالح
                    }
                }
            });
        }

        // إذا لم نجد، ابحث بـ regex في HTML
        if (imageUrls.length === 0) {
            const murlMatches = html.match(/"murl":"([^"]+)"/g);
            if (murlMatches) {
                for (const match of murlMatches) {
                    const url = match.match(/"murl":"([^"]+)"/)[1];
                    if (url && url.startsWith('http') && imageUrls.length < 6) {
                        imageUrls.push(url);
                    }
                }
            }
        }

        console.log(`📸 تم العثور على ${imageUrls.length} رابط صورة كاملة، جاري تحويلها إلى JPEG...`);

        if (imageUrls.length === 0) {
            console.warn('⚠️ لم يتم العثور على روابط صور');
            return [];
        }

        const converted = [];

        for (let i = 0; i < Math.min(imageUrls.length, 4); i++) {
            try {
                const imageUrl = imageUrls[i];
                console.log(`🔄 تحويل الصورة ${i + 1}: ${imageUrl.substring(0, 50)}...`);

                // تحميل الصورة
                const response = await axios.get(imageUrl, {
                    responseType: 'arraybuffer',
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                // التحقق من صحة الاستجابة
                if (!response || !response.data || response.data.length === 0) {
                    console.warn(`⚠️ فشل في تحميل الصورة ${i + 1}: استجابة فارغة`);
                    continue;
                }

                // تحويل إلى JPEG مع تصغير ذكي للحفاظ على الجودة
                let imageBuffer = response.data;
                const contentType = response.headers['content-type'];
                
                if (contentType && !contentType.includes('jpeg') && !contentType.includes('jpg')) {
                    // تحويل إلى JPEG إذا لم تكن JPEG
                    imageBuffer = await sharp(response.data)
                        .resize({ width: 1080, withoutEnlargement: true })
                        .jpeg({ quality: 100 })
                        .toBuffer();
                } else {
                    // إذا كانت JPEG، قم بتصغير إذا لزم الأمر
                    imageBuffer = await sharp(response.data)
                        .resize({ width: 1080, withoutEnlargement: true })
                        .jpeg({ quality: 100 })
                        .toBuffer();
                }

                converted.push(imageBuffer);
                console.log(`✅ تم تحويل الصورة ${i + 1} (${imageBuffer.length} bytes, نوع: ${contentType || 'غير معروف'})`);

            } catch (error) {
                console.warn(`⚠️ فشل تحويل الصورة ${i + 1}: ${error.message}`);
            }
        }

        console.log(`🎉 تم تحويل ${converted.length} صورة بنجاح`);
        return converted;

    } catch (error) {
        console.error('❌ خطأ في البحث عن الصور:', error.message);
        return [];
    }
}

/**
 * تحويل الصورة إلى JPEG
 * @param {string} imageUrl - رابط الصورة الأصلي
 * @returns {Promise<Buffer|null>} - Buffer الصورة المحولة أو null عند الفشل
 */
export async function convertImageToJpeg(imageUrl) {
    try {
        if (!imageUrl) return null;

        console.log(`🔄 جاري تحويل الصورة إلى JPEG: ${imageUrl}`);

        // تحميل الصورة
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        // تحويل إلى JPEG باستخدام Sharp
        const jpegBuffer = await sharp(response.data)
            .jpeg({ quality: 80 }) // جودة ثابتة 80%
            .toBuffer();

        console.log(`✅ تم تحويل الصورة إلى JPEG (${jpegBuffer.length} bytes)`);
        return jpegBuffer;

    } catch (error) {
        console.error(`❌ فشل تحويل الصورة إلى JPEG: ${error.message}`);
        return null;
    }
}

/**
 * البحث عن صورة علم الدولة من ويكيبيديا
 * @param {string} countryName - اسم الدولة بالإنجليزية
 * @returns {Promise<string|null>} - رابط صورة العلم أو null عند الفشل
 */
export async function searchFlagImageFromWikipedia(countryName) {
    try {
        if (!countryName || countryName.trim() === '') {
            return null;
        }

        console.log(`🔍 جاري البحث عن علم ${countryName} في ويكيبيديا...`);

        // البحث عن صفحة الدولة في ويكيبيديا
        const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(countryName)}`;

        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 20000
        });

        if (response.data && response.data.thumbnail && response.data.thumbnail.source) {
            // إذا كانت الصورة موجودة في الملخص، استخدمها
            const flagUrl = response.data.thumbnail.source;
            console.log(`✅ تم العثور على علم ${countryName}: ${flagUrl}`);
            return flagUrl;
        }

        // إذا لم نجد في الملخص، ابحث عن ملف العلم مباشرة
        const flagFileName = `Flag_of_${countryName.replace(/\s+/g, '_')}.svg`;
        const commonsUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${flagFileName}`;

        try {
            const commonsResponse = await axios.head(commonsUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });

            if (commonsResponse.status === 200) {
                console.log(`✅ تم العثور على علم ${countryName} في Wikimedia Commons: ${commonsUrl}`);
                return commonsUrl;
            }
        } catch (commonsError) {
            // تجاهل خطأ الـ commons
        }

        console.warn(`⚠️ لم يتم العثور على علم ${countryName}`);
        return null;

    } catch (error) {
        console.error(`❌ خطأ في البحث عن علم ${countryName}: ${error.message}`);
        return null;
    }
}