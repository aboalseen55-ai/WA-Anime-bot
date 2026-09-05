import axios from 'axios';
import sharp from 'sharp';
import * as cheerio from 'cheerio';
import mongoose from 'mongoose';
import { translate } from '@vitalets/google-translate-api';
import ImageSearchCache from '../database/imageSearchCacheModel.js';
import RapidImageSearchUsage from '../database/rapidImageSearchUsageModel.js';

// الصيغ المقبولة للصور
const ACCEPTED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const DEFAULT_MONTHLY_LIMIT = 50;
const DEFAULT_CACHE_DAYS = 30;
const DEFAULT_RAPID_IMAGE_COUNT = 10;
const MAX_IMAGE_URLS = 16;
const MAX_IMAGES_TO_SEND = 4;
const ANILIST_API = 'https://graphql.anilist.co';
const ANIME_QUERY_SUFFIX = 'anime character anime art -spoon -fork -knife -cutlery -utensil -kitchen -dish -plate -soap -detergent';
const ANIME_CONTEXT_PATTERN = /(?:anime|manga|manhwa|myanimelist|anilist|anime-planet|crunchyroll|fandom|zerochan|pixiv|danbooru|gelbooru|otaku|أنمي|انمي|مانجا|شخصي(?:ة|ات))/i;
const TRUSTED_ANIME_SOURCE_PATTERN = /(?:myanimelist\.net|anilist\.co|anime-planet\.com|fandom\.com|zerochan\.net|pixiv\.net|danbooru\.donmai\.us|gelbooru\.com|wallpapercave\.com|wallpaperflare\.com)/i;
const IRRELEVANT_IMAGE_PATTERN = /(?:spoon|fork|knife|cutlery|utensil|kitchen|dish(?:es)?|plate|soap|detergent|clean(?:ing)?|mop|broom|faucet|sink|cookware|ملعقة|شوكة|سكين|مطبخ|صحون|صحن|جلي|منظف|ممسحة|مكنسة|حنفية)/i;

function isExplicitlyDisabled(value) {
    return String(value || '').trim().toLowerCase() === 'false';
}

function allowsUnverifiedWebFallback() {
    return String(process.env.ANIME_WELCOME_ALLOW_WEB_FALLBACK || '').trim().toLowerCase() !== 'false';
}

async function getCharacterSearchTerms(nickname) {
    const cleaned = String(nickname || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];

    const terms = [cleaned];
    if (!/[\u0600-\u06FF]/.test(cleaned)) return terms;

    try {
        const translated = await Promise.race([
            translate(cleaned, { to: 'en' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Translation timeout')), 6000))
        ]);
        const english = String(translated?.text || '').replace(/\s+/g, ' ').trim();
        if (english && !terms.some((term) => term.toLowerCase() === english.toLowerCase())) {
            terms.push(english);
        }
    } catch (error) {
        console.warn(`⚠️ تعذر ترجمة لقب الشخصية للبحث: ${error.message}`);
    }

    return terms;
}

async function searchAniListCharacterImages(nickname) {
    const terms = await getCharacterSearchTerms(nickname);
    const query = `
query ($search: String) {
  Character(search: $search) {
    id
    name {
      full
      native
      alternative
    }
    image {
      large
      medium
    }
    media(perPage: 1) {
      nodes {
        type
        isAdult
      }
    }
  }
}`;

    for (const search of terms) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            const response = await fetch(ANILIST_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'User-Agent': 'SamBot/1.0'
                },
                body: JSON.stringify({ query, variables: { search } }),
                signal: controller.signal
            });
            clearTimeout(timer);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const character = data?.data?.Character;
            const isSafeCharacter = character?.media?.nodes?.some((media) => (
                (media.type === 'ANIME' || media.type === 'MANGA') && media.isAdult !== true
            ));
            const imageUrl = character?.image?.large || character?.image?.medium;

            if (isSafeCharacter && isImageLikeUrl(imageUrl)) {
                console.log(`✅ AniList character found for "${nickname}" using "${search}".`);
                return [imageUrl];
            }
        } catch (error) {
            console.warn(`⚠️ AniList character lookup failed for "${search}": ${error.message}`);
        }
    }

    return [];
}

async function searchJikanCharacterImages(nickname) {
    const terms = await getCharacterSearchTerms(nickname);

    for (const search of terms) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            const response = await fetch(
                `https://api.jikan.moe/v4/characters?q=${encodeURIComponent(search)}&limit=1&order_by=favorites&sort=desc`,
                {
                    headers: { 'User-Agent': 'SamBot/1.0' },
                    signal: controller.signal
                }
            );
            clearTimeout(timer);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const character = data?.data?.[0];
            const imageUrl = character?.images?.webp?.large_image_url
                || character?.images?.jpg?.large_image_url
                || character?.images?.webp?.image_url
                || character?.images?.jpg?.image_url;
            if (isImageLikeUrl(imageUrl)) {
                console.log(`✅ Jikan character found for "${nickname}" using "${search}".`);
                return [imageUrl];
            }
        } catch (error) {
            console.warn(`⚠️ Jikan character lookup failed for "${search}": ${error.message}`);
        }
    }

    return [];
}

function normalizeCacheKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function getMonthKey(date = new Date()) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getCacheExpiryDate() {
    const days = Number(process.env.RAPIDAPI_IMAGE_CACHE_DAYS || DEFAULT_CACHE_DAYS);
    const safeDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_CACHE_DAYS;
    return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000);
}

function deriveHostFromUrl(url) {
    try {
        return url ? new URL(url).host : '';
    } catch {
        return '';
    }
}

function getRapidConfig() {
    const key = process.env.RAPIDAPI_KEY || process.env.RAPID_API_KEY;
    const url = process.env.RAPIDAPI_GOOGLE_IMAGES_URL || process.env.RAPIDAPI_IMAGE_SEARCH_URL;
    const host = process.env.RAPIDAPI_GOOGLE_IMAGES_HOST || process.env.RAPIDAPI_HOST || deriveHostFromUrl(url);
    const queryParam = process.env.RAPIDAPI_GOOGLE_IMAGES_QUERY_PARAM || process.env.RAPIDAPI_IMAGE_SEARCH_QUERY_PARAM || 'q';
    const count = Number(process.env.RAPIDAPI_GOOGLE_IMAGES_COUNT || DEFAULT_RAPID_IMAGE_COUNT);
    const imageInfo = String(process.env.RAPIDAPI_GOOGLE_IMAGES_IMAGE_INFO || 'true').trim();
    const enabled = !isExplicitlyDisabled(process.env.RAPIDAPI_IMAGE_SEARCH_ENABLED);

    return {
        enabled,
        key: String(key || '').trim(),
        url: String(url || '').trim(),
        host: String(host || '').trim(),
        queryParam: String(queryParam || 'q').trim(),
        count: Number.isFinite(count) && count > 0 ? count : DEFAULT_RAPID_IMAGE_COUNT,
        imageInfo: imageInfo || 'true'
    };
}

function buildSearchQuery(nickname) {
    const template = process.env.RAPIDAPI_IMAGE_SEARCH_QUERY_TEMPLATE || `{nickname} ${ANIME_QUERY_SUFFIX}`;
    const query = template.replace(/\{nickname\}/g, nickname).trim();
    return /(?:anime|أنمي|انمي)/i.test(query) ? query : `${query} ${ANIME_QUERY_SUFFIX}`;
}

function isImageLikeUrl(value) {
    const url = String(value || '').trim();
    if (!/^https?:\/\//i.test(url)) return false;
    if (/\.svg(\?|$)/i.test(url)) return false;
    if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url)) return true;
    return /(googleusercontent|gstatic|bing|twimg|pinimg|wikimedia|fandom|nocookie|media)/i.test(url);
}

function extractImageUrls(value, urls = []) {
    if (!value || urls.length >= MAX_IMAGE_URLS) return urls;

    if (typeof value === 'string') {
        if (isImageLikeUrl(value)) urls.push(value);
        return urls;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            extractImageUrls(item, urls);
            if (urls.length >= MAX_IMAGE_URLS) break;
        }
        return urls;
    }

    if (typeof value === 'object') {
        const priorityKeys = [
            'image', 'imageUrl', 'image_url', 'thumbnail', 'thumbnailUrl', 'thumbnail_url',
            'original', 'originalUrl', 'original_url', 'url', 'link', 'src', 'media'
        ];

        for (const key of priorityKeys) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                extractImageUrls(value[key], urls);
                if (urls.length >= MAX_IMAGE_URLS) return urls;
            }
        }

        for (const nested of Object.values(value)) {
            extractImageUrls(nested, urls);
            if (urls.length >= MAX_IMAGE_URLS) break;
        }
    }

    return urls;
}

function uniqueUrls(urls) {
    const seen = new Set();
    return urls.filter((url) => {
        const clean = String(url || '').trim();
        if (!clean || seen.has(clean)) return false;
        seen.add(clean);
        return true;
    });
}

function uniqueImageCandidates(candidates) {
    const seen = new Set();
    return candidates.filter((candidate) => {
        const url = String(candidate?.url || '').trim();
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
    });
}

function isAnimeImageCandidate(candidate) {
    const url = String(candidate?.url || '').trim();
    const context = String(candidate?.context || '');
    const details = `${url} ${context}`;

    if (!url || IRRELEVANT_IMAGE_PATTERN.test(details)) return false;
    return ANIME_CONTEXT_PATTERN.test(context) || TRUSTED_ANIME_SOURCE_PATTERN.test(url);
}

function getAnimeImageUrls(candidates) {
    const accepted = uniqueImageCandidates(candidates)
        .filter(isAnimeImageCandidate)
        .map((candidate) => candidate.url)
        .slice(0, MAX_IMAGE_URLS);

    console.log(`🧹 فلتر الأنمي قبل ${candidates.length} نتيجة وأبقى ${accepted.length} نتيجة مناسبة.`);
    return accepted;
}

function collectImageCandidates(value, candidates = [], inheritedContext = '') {
    if (!value || candidates.length >= MAX_IMAGE_URLS * 4) return candidates;

    if (typeof value === 'string') {
        if (isImageLikeUrl(value)) candidates.push({ url: value, context: inheritedContext });
        return candidates;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            collectImageCandidates(item, candidates, inheritedContext);
            if (candidates.length >= MAX_IMAGE_URLS * 4) break;
        }
        return candidates;
    }

    if (typeof value === 'object') {
        const contextKeys = new Set([
            'title', 'name', 'description', 'snippet', 'caption', 'alt',
            'source', 'sourceName', 'contextLink', 'context_link', 'hostPageUrl',
            'host_page_url', 'pageUrl', 'page_url', 'pageTitle', 'page_title'
        ]);
        const context = [
            inheritedContext,
            ...Object.entries(value)
                .filter(([key, item]) => contextKeys.has(key) && typeof item === 'string' && !isImageLikeUrl(item))
                .map(([key, item]) => `${key}:${item}`)
        ].join(' ').slice(0, 2000);

        for (const item of Object.values(value)) {
            collectImageCandidates(item, candidates, context);
            if (candidates.length >= MAX_IMAGE_URLS * 4) break;
        }
    }

    return candidates;
}

async function getCachedImageUrls(cacheKey) {
    if (mongoose.connection.readyState !== 1) return [];

    const cache = await ImageSearchCache.findOne({
        cacheKey,
        expiresAt: { $gt: new Date() }
    }).lean();

    return cache?.imageUrls?.length ? cache.imageUrls : [];
}

async function saveImageUrlCache(cacheKey, query, source, imageUrls) {
    if (mongoose.connection.readyState !== 1 || !imageUrls.length) return;

    await ImageSearchCache.updateOne(
        { cacheKey },
        {
            $set: {
                query,
                source,
                imageUrls: imageUrls.slice(0, MAX_IMAGE_URLS),
                expiresAt: getCacheExpiryDate()
            }
        },
        { upsert: true }
    );
}

async function getRapidMonthlyUsage() {
    if (mongoose.connection.readyState !== 1) return null;
    return RapidImageSearchUsage.findOne({
        monthKey: getMonthKey(),
        provider: 'rapidapi-google-images'
    }).lean();
}

async function recordRapidUsage(success, errorMessage = '') {
    if (mongoose.connection.readyState !== 1) return;

    await RapidImageSearchUsage.updateOne(
        {
            monthKey: getMonthKey(),
            provider: 'rapidapi-google-images'
        },
        {
            $inc: {
                requests: 1,
                successfulRequests: success ? 1 : 0,
                failedRequests: success ? 0 : 1
            },
            $set: {
                lastUsedAt: new Date(),
                lastError: success ? '' : String(errorMessage || '').slice(0, 400)
            }
        },
        { upsert: true }
    );
}

async function searchRapidGoogleImages(nickname) {
    const config = getRapidConfig();
    if (!config.enabled || !config.key || !config.url || !config.host) {
        console.log('ℹ️ RapidAPI image search is not configured; using fallback source.');
        return [];
    }

    if (mongoose.connection.readyState !== 1) {
        console.warn('⚠️ MongoDB غير متصل، تم تخطي RapidAPI لحماية الحد الشهري.');
        return [];
    }

    const monthlyLimit = Number(process.env.RAPIDAPI_MONTHLY_LIMIT || process.env.RAPIDAPI_GOOGLE_IMAGES_MONTHLY_LIMIT || DEFAULT_MONTHLY_LIMIT);
    const safeLimit = Number.isFinite(monthlyLimit) && monthlyLimit > 0 ? monthlyLimit : DEFAULT_MONTHLY_LIMIT;
    const usage = await getRapidMonthlyUsage();
    if ((usage?.requests || 0) >= safeLimit) {
        console.warn(`⚠️ تم الوصول إلى حد RapidAPI الشهري (${safeLimit})، سيتم استخدام Bing.`);
        return [];
    }

    const query = buildSearchQuery(nickname);

    try {
        console.log(`🔍 RapidAPI Google Images search: ${query}`);
        const response = await axios.get(config.url, {
            params: {
                [config.queryParam]: query,
                count: config.count,
                imageInfo: config.imageInfo
            },
            headers: {
                'Content-Type': 'application/json',
                'X-RapidAPI-Key': config.key,
                'X-RapidAPI-Host': config.host
            },
            timeout: 15000
        });

        const urls = getAnimeImageUrls(collectImageCandidates(response.data));
        await recordRapidUsage(urls.length > 0, urls.length ? '' : 'No image URLs found');
        console.log(`✅ RapidAPI returned ${urls.length} image URLs`);
        return urls;
    } catch (error) {
        await recordRapidUsage(false, error.message);
        console.warn(`⚠️ RapidAPI image search failed: ${error.message}`);
        return [];
    }
}

async function searchBingImageUrls(nickname) {
    console.log(`🔍 جاري البحث عن صور "${nickname}" في Bing Images...`);

    const searchQuery = encodeURIComponent(buildSearchQuery(nickname));
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

    const $ = cheerio.load(html);
    const imageCandidates = [];

    $('.iusc img').each((i, elem) => {
        let src = $(elem).attr('src') || $(elem).attr('data-src') || $(elem).attr('data-delayed-src');
        if (src && src.includes('http') && !src.includes('svg') && imageCandidates.length < MAX_IMAGE_URLS * 2) {
            src = src.replace(/w=\d+/, 'w=800').replace(/h=\d+/, 'h=800');
            imageCandidates.push({
                url: src,
                context: [$(elem).attr('alt'), $(elem).attr('title'), $(elem).closest('.iusc').attr('data-m')].filter(Boolean).join(' ')
            });
        }
    });

    $('.iusc').each((i, elem) => {
        const dataM = $(elem).attr('data-m');
        if (dataM) {
            try {
                const data = JSON.parse(dataM);
                collectImageCandidates(data, imageCandidates);
            } catch {
                // تجاهل JSON غير صالح
            }
        }
    });

    if (imageCandidates.length === 0) {
        const murlMatches = html.match(/"murl":"([^"]+)"/g);
        if (murlMatches) {
            for (const match of murlMatches) {
                const url = match.match(/"murl":"([^"]+)"/)[1];
                if (url && url.startsWith('http') && imageCandidates.length < MAX_IMAGE_URLS * 2) {
                    imageCandidates.push({ url, context: '' });
                }
            }
        }
    }

    return getAnimeImageUrls(imageCandidates);
}

async function imageUrlsToJpegBuffers(imageUrls) {
    console.log(`📸 تم العثور على ${imageUrls.length} رابط صورة، جاري تحويلها إلى JPEG...`);

    const converted = [];

    for (let i = 0; i < Math.min(imageUrls.length, MAX_IMAGES_TO_SEND); i++) {
        try {
            const imageUrl = imageUrls[i];
            console.log(`🔄 تحويل الصورة ${i + 1}: ${imageUrl.substring(0, 50)}...`);

            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!response || !response.data || response.data.length === 0) {
                console.warn(`⚠️ فشل في تحميل الصورة ${i + 1}: استجابة فارغة`);
                continue;
            }

            const contentType = response.headers['content-type'];
            if (contentType && !contentType.startsWith('image/')) {
                console.warn(`⚠️ تم تجاهل رابط ليس صورة: ${contentType}`);
                continue;
            }

            const imageBuffer = await sharp(response.data)
                .resize({ width: 1080, withoutEnlargement: true })
                .jpeg({ quality: 100 })
                .toBuffer();

            converted.push(imageBuffer);
            console.log(`✅ تم تحويل الصورة ${i + 1} (${imageBuffer.length} bytes, نوع: ${contentType || 'غير معروف'})`);
        } catch (error) {
            console.warn(`⚠️ فشل تحويل الصورة ${i + 1}: ${error.message}`);
        }
    }

    console.log(`🎉 تم تحويل ${converted.length} صورة بنجاح`);
    return converted;
}

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

        const cleanNickname = nickname.trim();
        const cacheKey = normalizeCacheKey(`anime-character-v3:${cleanNickname}`);
        const cachedUrls = await getCachedImageUrls(cacheKey);

        if (cachedUrls.length) {
            console.log(`♻️ استخدام كاش الصور للقب "${cleanNickname}"`);
            const cachedBuffers = await imageUrlsToJpegBuffers(cachedUrls);
            if (cachedBuffers.length) return cachedBuffers;
            console.warn('⚠️ روابط الكاش لم تعد صالحة، سيتم البحث من جديد.');
        }

        const aniListUrls = await searchAniListCharacterImages(cleanNickname);
        if (aniListUrls.length) {
            await saveImageUrlCache(cacheKey, cleanNickname, 'anilist-character', aniListUrls);
            return imageUrlsToJpegBuffers(aniListUrls);
        }

        const jikanUrls = await searchJikanCharacterImages(cleanNickname);
        if (jikanUrls.length) {
            await saveImageUrlCache(cacheKey, cleanNickname, 'jikan-character', jikanUrls);
            return imageUrlsToJpegBuffers(jikanUrls);
        }

        // لا نستخدم بحث الويب العام افتراضيًا: قد يعيد أشياء لا علاقة لها بالأنمي.
        if (!allowsUnverifiedWebFallback()) {
            console.warn(`⚠️ لم يتم العثور على شخصية أنمي مؤكدة للقب "${cleanNickname}".`);
            return [];
        }

        console.warn('⚠️ تم تفعيل fallback الويب غير الموثق يدويًا.');
        const rapidUrls = await searchRapidGoogleImages(cleanNickname);
        if (rapidUrls.length) {
            await saveImageUrlCache(cacheKey, cleanNickname, 'rapidapi-google-images-fallback', rapidUrls);
            const rapidBuffers = await imageUrlsToJpegBuffers(rapidUrls);
            if (rapidBuffers.length) return rapidBuffers;
        }

        const bingUrls = await searchBingImageUrls(cleanNickname);
        if (!bingUrls.length) {
            console.warn('⚠️ لم يتم العثور على روابط صور');
            return [];
        }

        await saveImageUrlCache(cacheKey, cleanNickname, 'bing-images', bingUrls);
        return imageUrlsToJpegBuffers(bingUrls);

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
