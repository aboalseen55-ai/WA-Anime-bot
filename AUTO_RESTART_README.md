# تشغيل البوت تلقائياً مع PM2

## المشكلة
البوت قد ينقطع الاتصال بسبب:
- مشاكل الشبكة
- أخطاء في الكود
- قيود WhatsApp
- انقطاع التيار الكهربائي

## الحلول المطبقة

### 1. إعادة الاتصال التلقائي في الكود
تم إضافة معالجة في `index.js` لإعادة الاتصال عند انقطاع الاتصال (باستثناء أخطاء المصادقة).

### 2. إدارة العمليات بـ PM2
PM2 هو مدير عمليات Node.js يوفر:
- إعادة تشغيل تلقائي عند الأخطاء
- مراقبة الذاكرة والـ CPU
- إدارة السجلات
- واجهة ويب للمراقبة

## التثبيت والتشغيل

### تثبيت PM2
```bash
npm install -g pm2
```

### تشغيل البوت مع PM2
```bash
npm run pm2:start
```

### أوامر PM2 المفيدة
```bash
# عرض حالة البوت
pm2 status

# عرض السجلات
npm run pm2:logs

# إعادة تشغيل البوت
npm run pm2:restart

# إيقاف البوت
npm run pm2:stop

# حذف البوت من PM2
npm run pm2:delete

# مراقبة البوت
pm2 monit
```

## السجلات
- `logs/out.log`: إخراج البوت العادي
- `logs/err.log`: الأخطاء
- `logs/combined.log`: جميع السجلات

## نصائح للاستقرار

1. **تشغيل البوت كخدمة Windows**:
   - استخدم `nssm` لتحويل PM2 إلى خدمة Windows
   - أو استخدم Windows Task Scheduler لتشغيل `npm run pm2:start` عند بدء التشغيل

2. **مراقبة الذاكرة**:
   - PM2 يعيد التشغيل إذا تجاوزت الذاكرة 1GB
   - راقب السجلات بانتظام

3. **النسخ الاحتياطي**:
   - احتفظ بنسخة من مجلد `auth` (يحتوي على بيانات تسجيل الدخول)
   - احتفظ بنسخة من قاعدة البيانات

4. **الشبكة المستقرة**:
   - تأكد من استقرار اتصال الإنترنت
   - استخدم VPN إذا لزم الأمر

5. **إشعارات الانقطاع**:
   - يمكن إضافة إشعارات تليجرام أو إيميل عند انقطاع البوت
   - استخدم أدوات مثل Healthchecks.io

## استكشاف الأخطاء

### إذا انقطع البوت:
1. تحقق من السجلات: `npm run pm2:logs`
2. أعد تشغيل: `npm run pm2:restart`
3. إذا استمر: تحقق من اتصال الإنترنت ومساحة القرص

### إذا لم يبدأ البوت:
1. تأكد من تثبيت PM2: `npx pm2 --version`
2. تحقق من ملف ecosystem.config.cjs
3. شغل يدوياً أولاً: `npm start`

### مشاكل شائعة:
- **ES Module Error**: تأكد من أن ecosystem.config.cjs موجود وليس .js
- **Memory Issues**: زد max_memory_restart في ecosystem.config.cjs
- **Network Issues**: البوت سيعيد الاتصال تلقائياً بعد 5 ثوانٍ

## الأوامر السريعة

```bash
# تشغيل
npm run pm2:start

# إيقاف
npm run pm2:stop

# إعادة تشغيل
npm run pm2:restart

# السجلات
npm run pm2:logs

# الحالة
npx pm2 status

# المراقبة
npx pm2 monit
```

## استكشاف الأخطاء

### إذا انقطع البوت:
1. تحقق من السجلات: `npm run pm2:logs`
2. أعد تشغيل: `npm run pm2:restart`
3. إذا استمر: تحقق من اتصال الإنترنت ومساحة القرص

### إذا لم يبدأ البوت:
1. تأكد من تثبيت PM2: `pm2 --version`
2. تحقق من ملف ecosystem.config.js
3. شغل يدوياً أولاً: `npm start`

## التشغيل التلقائي عند بدء Windows

### الطريقة السريعة - استخدام الملف المرفق:
1. شغل `start-bot.bat` كمسؤول
2. أو أضفه إلى Startup folder

### باستخدام Task Scheduler (موصى به):
1. افتح Task Scheduler (ابحث عن "Task Scheduler")
2. اضغط "Create Basic Task"
3. Name: "Anime Bot Auto Start"
4. Trigger: "When I log on" أو "At startup"
5. Action: "Start a program"
6. Program: `C:\Windows\System32\cmd.exe`
7. Arguments: `/c cd /d "C:\Sam_Disk\anime-bot" && npm run pm2:start`
8. Finish

### باستخدام NSSM (للخوادم):
1. حمل NSSM من https://nssm.cc/
2. `nssm install AnimeBot`
3. Path: `C:\Windows\System32\cmd.exe`
4. Arguments: `/c cd /d "C:\Sam_Disk\anime-bot" && npm run pm2:start`
5. تثبيت كخدمة: `nssm start AnimeBot`