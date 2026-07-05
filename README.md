# WA-Anime-bot

بوت واتساب لإدارة مجتمعات الأنمي، مع نظام ممالك، ألعاب، رتب، نقاط، بنك، أوامر إدارة، وترحيب تلقائي للأعضاء.

## المتطلبات

- Node.js 18 أو أحدث
- MongoDB Atlas أو MongoDB محلي
- جلسة WhatsApp محفوظة داخل مجلد `auth/`

## الإعداد

انسخ `.env.example` إلى `.env` واضبط القيم:

```env
MONGO_URI=
ADMIN_PASSWORD=
GOOGLE_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
SAM_BOT_AI_ENABLED=true
SAM_BOT_AI_MODEL=gemini-3.1-flash-lite
SAM_BOT_AI_TIMEOUT_MS=12000
SAM_BOT_AI_MAX_OUTPUT_TOKENS=15
SAM_BOT_AI_DAILY_REQUEST_LIMIT=
SAM_BOT_AI_DAILY_TOKEN_LIMIT=
SAM_BOT_USAGE_TIMEZONE=Asia/Amman
RAPIDAPI_KEY=
RAPIDAPI_GOOGLE_IMAGES_URL=https://google-images4.p.rapidapi.com/getGoogleImages
RAPIDAPI_GOOGLE_IMAGES_HOST=google-images4.p.rapidapi.com
RAPIDAPI_GOOGLE_IMAGES_QUERY_PARAM=query
RAPIDAPI_GOOGLE_IMAGES_COUNT=10
RAPIDAPI_GOOGLE_IMAGES_IMAGE_INFO=true
RAPIDAPI_IMAGE_SEARCH_QUERY_TEMPLATE={nickname} anime character
RAPIDAPI_IMAGE_SEARCH_ENABLED=true
RAPIDAPI_MONTHLY_LIMIT=50
RAPIDAPI_IMAGE_CACHE_DAYS=30
LOG_LEVEL=info
```

`ADMIN_PASSWORD` مطلوبة للأوامر الحساسة مثل تعيين الأدمن ومنح رتب الإمبراطور.

`GEMINI_API_KEY` أو `GOOGLE_API_KEY` يفعّل ردود سام بوت الذكية عند توجيه الكلام له. إذا لم يكن أي مفتاح موجودًا أو تم ضبط `SAM_BOT_AI_ENABLED=false` سيستخدم البوت الردود المحلية الاحتياطية.

أمر المطور `/رصيد_الذكاء` يعرض استهلاك Gemini المسجل في MongoDB. لضبط النسبة المتبقية، عرّف `SAM_BOT_AI_DAILY_REQUEST_LIMIT` أو `SAM_BOT_AI_DAILY_TOKEN_LIMIT` حسب حدود مشروعك في Google.

أمر المطور `/عد_التوكن <نص>` يحسب توكنات المدخلات قبل إرسالها إلى Gemini. أما توكنات output/thinking/cached/tool-use فتسجل من رد Gemini نفسه وتظهر في `/رصيد_الذكاء`.

أمر `/ترحيب` يبحث عن العضو داخل نفس المملكة فقط. صور الترحيب تستخدم RapidAPI Google Images أولًا إذا كانت المتغيرات مضبوطة وتحت الحد الشهري، ثم ترجع إلى Bing تلقائيًا. يتم حفظ روابط الصور في MongoDB لمدة `RAPIDAPI_IMAGE_CACHE_DAYS` لتقليل استهلاك طلبات RapidAPI.

## التشغيل

```bash
npm install
npm start
```

عند التشغيل لأول مرة سيظهر QR في الطرفية. امسحه من واتساب لحفظ الجلسة في `auth/`.

## التشغيل مع PM2

```bash
npm run pm2:start
npm run pm2:logs
```

## الفحص

```bash
npm test
```

هذا الفحص يتأكد من صحة الملفات الأساسية نحويًا قبل النشر.

## أوامر المطور

هذه الأوامر مخصصة للمطور فقط، ويتم تحديده عبر `DEVELOPER_JIDS` أو الرقم الافتراضي `962795137282`.

```text
/أوامر_المطور
/اوامر_المطور
/دليل_المطور
```

يعرض دليلًا مرتبًا ومشروحًا لأوامر البوت من منظور المطور.

```text
/رمز_مملكة
/رمز_نقابة
```

ينشئ رمز فتح مملكة جديد ويرسله إلى خاص المطور. الرمز لا ينتهي بالوقت، لكنه يستهلك عند استخدامه.

```text
/فتح_مملكة <الرمز>
/فتح_نقابة <الرمز>
```

يبدأ معالج فتح المملكة عبر واتساب، ويحفظ الجلسة في MongoDB حتى تكتمل أو تُلغى.

```text
/الممالك
/تقرير_الممالك
```

يعرض تقريرًا شاملًا عن الممالك، القروبات، الأعضاء، البنك، وتواريخ العمليات الأخيرة.

## معرفة JID الخاص بك

```text
/هويتي
/معرفي
/id
```

يعرض البيانات التي يراها البوت عن رسالتك، ومنها `sender`. إذا لم يتعرف عليك أمر المطور، انسخ قيمة `sender` وأضفها إلى `DEVELOPER_JIDS` في Railway.
