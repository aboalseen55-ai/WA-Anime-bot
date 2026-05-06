import mongoose from 'mongoose';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const ANILIST_API = 'https://graphql.anilist.co';

// استيراد نموذج الأنمي
import Anime from './database/animeModel.js';
import { connectDB } from './database/db.js';

// قاعدة بيانات الأسماء العربية المتعارف عليها (أسماء بسيطة بدون أجزاء أو نسخ)
const ARABIC_NAMES_DB = {
  // أنمي شهير جداً
  "Attack on Titan": "هجوم العمالقة",
  "Shingeki no Kyojin": "هجوم العمالقة",
  "Death Note": "دفتر الموت",
  "Naruto": "ناروتو",
  "Naruto Shippuden": "ناروتو",
  "One Piece": "ون بيس",
  "My Hero Academia": "أكاديمية الأبطال",
  "Boku no Hero Academia": "أكاديمية الأبطال",
  "Demon Slayer": "قاتل الشياطين",
  "Kimetsu no Yaiba": "قاتل الشياطين",
  "Tokyo Ghoul": "غول طوكيو",
  "Sword Art Online": "سيف الفن عبر الإنترنت",
  "Fullmetal Alchemist": "الخيميائي الكامل",
  "Fullmetal Alchemist: Brotherhood": "الخيميائي الكامل",
  "Dragon Ball": "دراغون بول",
  "Dragon Ball Z": "دراغون بول",
  "Bleach": "بليتش",
  "Fairy Tail": "ذيل الجنية",
  "Hunter x Hunter": "هانتر × هانتر",
  "Steins;Gate": "بوابة شتاينز",
  "Neon Genesis Evangelion": "إنجيليون الجيل النيون",
  "Psycho-Pass": "التصريح النفسي",
  "Code Geass": "كود غياس",
  "Mirai Nikki": "مذكرات المستقبل",
  "Another": "آخر",
  "Higurashi": "هيغوراشي",
  "Umineko": "أومينيكو",
  "Fate/stay night": "فات/ابق ليلاً",
  "Puella Magi Madoka Magica": "فتاة السحر ماجيكا ميدوكا",
  "Re:Zero": "ري: زيرو",
  "Overlord": "أوفرلورد",
  "No Game No Life": "لا لعبة لا حياة",
  "The Promised Neverland": "مملكة الموتى الموعودة",
  "Jujutsu Kaisen": "معركة الشياطين",
  "Chainsaw Man": "رجل المنشار",
  "Spy x Family": "جاسوس × عائلة",
  "Violet Evergarden": "فيوليت إيفرغاردن",
  "Your Name": "اسمك",
  "Weathering with You": "الطقس معك",
  "A Silent Voice": "صوت هامس",
  "Your Lie in April": "كذبتك في أبريل",
  "Clannad": "كلاناد",
  "Toradora": "تورادورا",
  "Angel Beats": "ضربات الملاك",
  "The Melancholy of Haruhi Suzumiya": "حزن هاروهي سوزوميا",
  "Lucky Star": "النجم المحظوظ",
  "Made in Abyss": "مصنوع في الهاوية",
  "Dr. Stone": "دكتور ستون",
  "The Rising of the Shield Hero": "صعود بطل الدرع",
  "Mushoku Tensei": "رياضي بطال",
  "That Time I Got Reincarnated as a Slime": "حينما تحولت إلى سلايم",
  "The Misfit of Demon King Academy": "طالب شاذ في أكاديمية الشيطان",
  "Black Clover": "القرنفل الأسود",
  "Boruto": "بوروتو",
  "Fire Force": "قوة النار",
  "The God of High School": "إله الثانوية",
  "Solo Leveling": "تطوير وحيد",
  "Tower of God": "برج الإله",
  "Sousou no Frieren": "فريرن",
  "Frieren: Beyond Journey's End": "فريرن",
  "Frieren: Beyond Journey's End": "فريرن",
  "Gintama": "غينتاما",
  "Gintama°": "غينتاما",
  "Gintama: THE FINAL": "غينتاما",
  "ONE PIECE FAN LETTER": "ون بيس",
  "Tian Guan Ci Fu": "بركة المسؤول السماوي",
  "Heaven Official's Blessing": "بركة المسؤول السماوي",
  "Tian Guan Ci Fu Special": "بركة المسؤول السماوي",
  "Heaven Official's Blessing Special Episode": "بركة المسؤول السماوي",
  "Fruits Basket": "سلة الفاكهة",
  "Fruits Basket: The Final": "سلة الفاكهة",
  "Owarimonogatari": "أوواريمونوغاتاري",
  "3-gatsu no Lion": "أسد شهر مارس",
  "March comes in like a lion": "أسد شهر مارس",
  "Kaguya-sama wa Kokurasetai": "كاغويا تريد أن تجعلني أعترف",
  "Kaguya-sama: Love is War": "كاغويا تريد أن تجعلني أعترف",
  "Kusuriya no Hitorigoto": "مذكرات الصيدلي",
  "The Apothecary Diaries": "مذكرات الصيدلي",
  "Uma Musume": "فتاة الخيل",
  "Umamusume": "فتاة الخيل",
  "Uma Musume: Pretty Derby": "فتاة الخيل: ديربي الجميل",
  "Umamusume: Pretty Derby": "فتاة الخيل: ديربي الجميل",
  "Uma Musume: Pretty Derby Season 2": "فتاة الخيل: ديربي الجميل",
  "Umamusume: Pretty Derby Season 2": "فتاة الخيل: ديربي الجميل",
  "Ashita no Joe": "جو غداً",
  "Tomorrow's Joe": "جو غداً",
  "Ginga Eiyuu Densetsu": "أسطورة الأبطال النجميين",
  "Legend of the Galactic Heroes": "أسطورة الأبطال النجميين",
  "VINLAND SAGA": "ملحمة فينلاند",
  "Vinland Saga": "ملحمة فينلاند",
  "MONSTER": "الوحش",
  "Monster": "الوحش",
  "Hibike! Euphonium": "أيقظوا اليوفونيوم",
  "Sound! Euphonium": "أيقظوا اليوفونيوم",
  "Mob Psycho 100": "موب سايكو 100",
  "Mob Psycho 100 II": "موب سايكو 100",
  "Mob Psycho 100 III": "موب سايكو 100"
};

// دالة للبحث عن الاسم العربي المتعارف عليه
function findArabicName(englishTitle) {
  if (!englishTitle) return null;

  // البحث المباشر
  if (ARABIC_NAMES_DB[englishTitle]) {
    return ARABIC_NAMES_DB[englishTitle];
  }

  // البحث بغض النظر عن حالة الأحرف
  const lowerTitle = englishTitle.toLowerCase();
  for (const [key, value] of Object.entries(ARABIC_NAMES_DB)) {
    if (key.toLowerCase() === lowerTitle) {
      return value;
    }
  }

  // البحث الجزئي للأنمي الشهير
  for (const [key, value] of Object.entries(ARABIC_NAMES_DB)) {
    if (lowerTitle.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerTitle)) {
      return value;
    }
  }

  return null;
}

const ANILIST_QUERY = `
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(type: ANIME, sort: SCORE_DESC, isAdult: false) {
      id
      title {
        romaji
        english
        native
      }
      synonyms
      coverImage {
        large
      }
    }
  }
}
`;

// دالة لجلب البيانات من AniList
async function fetchTopAnime() {
  const allAnime = [];
  const perPage = 50; // AniList يسمح بـ 50 كحد أقصى لكل صفحة
  const totalPages = 4; // 200 / 50 = 4 صفحات

  for (let page = 1; page <= totalPages; page++) {
    console.log(`📄 جاري جلب الصفحة ${page} من ${totalPages}...`);

    try {
      const response = await fetch(ANILIST_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          query: ANILIST_QUERY,
          variables: { page, perPage }
        })
      });

      const data = await response.json();

      if (data.errors) {
        console.error('❌ خطأ في API:', data.errors);
        continue;
      }

      allAnime.push(...data.data.Page.media);
      console.log(`✅ تم جلب ${data.data.Page.media.length} أنمي من الصفحة ${page}`);

      // انتظار قليل لتجنب rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`❌ خطأ في جلب الصفحة ${page}:`, error.message);
    }
  }

  return allAnime;
}

// دالة لتنظيف قاعدة البيانات
async function clearDatabase() {
  console.log('🧹 جاري تنظيف قاعدة بيانات الأنمي...');
  await Anime.deleteMany({});
  console.log('✅ تم تنظيف قاعدة البيانات');
}

// دالة لمعالجة البيانات وإضافتها لقاعدة البيانات
async function processAndSaveAnime(animeList) {
  console.log(`🔄 جاري معالجة ${animeList.length} أنمي...`);

  let savedCount = 0;
  let skippedCount = 0;

  for (const anime of animeList) {
    try {
      // تجميع الأسماء العربية والإنجليزية
      const arabicNames = [];
      const aliases = [];

      // البحث عن أسماء عربية متعارف عليها أولاً
      const searchTitle = anime.title.english || anime.title.romaji;
      let arabicName = findArabicName(searchTitle);

      // إذا لم نجد بالإنجليزي، نبحث بالرومانجي
      if (!arabicName && anime.title.english && anime.title.romaji) {
        arabicName = findArabicName(anime.title.romaji);
      }

      if (arabicName) {
        arabicNames.push(arabicName);
        // إضافة اختصارات عربية إضافية
        const arabicShortcuts = getArabicShortcuts(arabicName);
        arabicNames.push(...arabicShortcuts);
      }

      // إضافة الاسم الإنجليزي إذا كان متوفراً
      if (anime.title.english) {
        aliases.push(anime.title.english);
      }

      // إضافة الاسم الرومانجي
      if (anime.title.romaji) {
        aliases.push(anime.title.romaji);
      }

      // إضافة الاسم الياباني الأصلي كـ alias أيضاً
      if (anime.title.native) {
        aliases.push(anime.title.native);
      }

      // الاختصارات المتعارف عليها
      if (anime.synonyms && anime.synonyms.length > 0) {
        aliases.push(...anime.synonyms);
      }

      // إضافة اختصارات شائعة للأنمي الشهير
      const commonAbbreviations = generateAbbreviations(anime.title.english || anime.title.romaji);
      if (commonAbbreviations.length > 0) {
        aliases.push(...commonAbbreviations);
      }

      // إذا لم نجد اسم عربي، نستخدم الاسم الإنجليزي كعربي
      if (arabicNames.length === 0 && anime.title.english) {
        arabicNames.push(anime.title.english);
      }

      // التحقق من وجود بيانات كافية
      if (arabicNames.length === 0 && aliases.length === 0) {
        console.log(`⚠️ تم تخطي ${anime.title.romaji} - لا توجد أسماء كافية`);
        skippedCount++;
        continue;
      }

      // إنشاء سجل الأنمي
      const animeDoc = new Anime({
        title: anime.title.romaji || anime.title.english || anime.title.native,
        arabicNames: arabicNames,
        aliases: aliases,
        imageUrl: anime.coverImage?.large || ''
      });

      await animeDoc.save();
      savedCount++;

      if (savedCount % 20 === 0) {
        console.log(`💾 تم حفظ ${savedCount} أنمي...`);
      }

    } catch (error) {
      console.error(`❌ خطأ في حفظ ${anime.title.romaji}:`, error.message);
      skippedCount++;
    }
  }

  console.log(`✅ تم حفظ ${savedCount} أنمي`);
  console.log(`⚠️ تم تخطي ${skippedCount} أنمي`);
}

// دالة للحصول على اختصارات عربية إضافية
function getArabicShortcuts(arabicName) {
  const shortcuts = {
    'هجوم العمالقة': ['اتاك اون تايتن', 'اتاك', 'شينغيكي نو كيوجين'],
    'دفتر الموت': ['ديث نوت'],
    'ناروتو': ['ناروتو'],
    'ون بيس': ['وان بيس'],
    'أكاديمية الأبطال': ['ماي هيرو أكاديميا'],
    'قاتل الشياطين': ['كيميتسو نو يايبا'],
    'غول طوكيو': ['توكيو غول'],
    'الخيميائي الكامل': ['فول ميتال ألكيميست'],
    'سيف الفن عبر الإنترنت': ['سورد آرت أونلاين'],
    'دراغون بول': ['دراغون بول زد'],
    'بليتش': ['بليتش'],
    'ذيل الجنية': ['فيري تيل'],
    'هانتر × هانتر': ['هانتر هانتر'],
    'بوابة شتاينز': ['شتاينز غيت'],
    'إنجيليون الجيل النيون': ['نيون جينيسيس إيفانجيليون'],
    'التصريح النفسي': ['سايكو باس'],
    'كود غياس': ['كود غياس'],
    'مذكرات المستقبل': ['ميراي نيكي'],
    'آخر': ['أناذر'],
    'هيغوراشي': ['هيغوراشي'],
    'أومينيكو': ['أومينيكو'],
    'فات/ابق ليلاً': ['فات ستاي نايت'],
    'فتاة السحر ماجيكا ميدوكا': ['بويلا ماغي مادوكا ماغيكا'],
    'ري: زيرو': ['ري زيرو'],
    'أوفرلورد': ['أوفرلورد'],
    'لا لعبة لا حياة': ['نو غيم نو لايف'],
    'مملكة الموتى الموعودة': ['ذا برومايزد نيفرلاند'],
    'معركة الشياطين': ['جوجوتسو كايسن'],
    'رجل المنشار': ['تشينسو مان'],
    'جاسوس × عائلة': ['سباي × فاميلي'],
    'فيوليت إيفرغاردن': ['فيوليت إيفرغاردن'],
    'اسمك': ['يور نام'],
    'الطقس معك': ['وذرينغ ويذ يو'],
    'صوت هامس': ['أ سايلنت فويس'],
    'كذبتك في أبريل': ['يور لاي إن أبريل'],
    'كلاناد': ['كلاناد'],
    'تورادورا': ['تورادورا'],
    'ضربات الملاك': ['أنجل بيتس'],
    'حزن هاروهي سوزوميا': ['ذا ميلانكولي أوف هاروهي سوزوميا'],
    'النجم المحظوظ': ['لاكي ستار'],
    'مصنوع في الهاوية': ['ميد إن أبيس'],
    'دكتور ستون': ['دكتور ستون'],
    'صعود بطل الدرع': ['ذا رايزينغ أوف ذا شيلد هيرو'],
    'رياضي بطال': ['موشوكو تينسي'],
    'حينما تحولت إلى سلايم': ['ذات تايم آي غوت رينكارنيتد أس أ سليم'],
    'طالب شاذ في أكاديمية الشيطان': ['ذا ميسفيت أوف ديمون كينغ أكاديمي'],
    'القرنفل الأسود': ['بلاك كلوفر'],
    'بوروتو': ['بوروتو'],
    'قوة النار': ['فاير فورس'],
    'إله الثانوية': ['ذا غاد أوف هاي سكول'],
    'تطوير وحيد': ['سولو ليفيلينغ'],
    'برج الإله': ['تاور أوف غاد'],
    'فريرن': ['فريرن'],
    'غينتاما': ['غينتاما'],
    'بركة المسؤول السماوي': ['هافن أوفيسيالز بليسينغ'],
    'سلة الفاكهة': ['فروتس باسكت'],
    'كاغويا تريد أن تجعلني أعترف': ['كاغويا ساما وانتس تو ميك مي كونفيس'],
    'أسد شهر مارس': ['مارچ كومز إن لايك أ لايون'],
    'مذكرات الصيدلي': ['ذا أبوثيكاريس دايريز'],
    'فتاة الخيل: ديربي الجميل': ['أماموسومي بريتي ديربي'],
    'جو غداً': ['أشيتا نو جو'],
    'أسطورة الأبطال النجميين': ['ليجند أوف ذا غالاكتيك هيروز'],
    'ملحمة فينلاند': ['فينلاند ساغا'],
    'الوحش': ['مونستر'],
    'أيقظوا اليوفونيوم': ['ساوند يوفونيوم'],
    'موب سايكو 100': ['موب سايكو 100']
  };

  return shortcuts[arabicName] || [];
}

// دالة لتوليد اختصارات شائعة
function generateAbbreviations(title) {
  if (!title) return [];

  const abbreviations = [];
  const words = title.split(' ');

  // اختصارات شائعة للأنمي الشهير
  const commonAnime = {
    // أنمي شهيرة بالإنجليزية
    'Attack on Titan': ['AOT', 'SnK', 'Attack on Titan', 'Shingeki no Kyojin'],
    'Death Note': ['DN', 'Death Note'],
    'Naruto': ['Naruto'],
    'One Piece': ['OP', 'One Piece'],
    'My Hero Academia': ['MHA', 'BNHA', 'My Hero Academia', 'Boku no Hero Academia'],
    'Demon Slayer': ['DS', 'Kimetsu', 'Demon Slayer', 'Kimetsu no Yaiba'],
    'Tokyo Ghoul': ['TG', 'Tokyo Ghoul'],
    'Fullmetal Alchemist': ['FMA', 'Fullmetal Alchemist'],
    'Sword Art Online': ['SAO', 'Sword Art Online'],
    'Dragon Ball': ['DB', 'DBZ', 'Dragon Ball'],
    'Bleach': ['Bleach'],
    'Fairy Tail': ['FT', 'Fairy Tail'],
    'Hunter x Hunter': ['HxH', 'Hunter x Hunter'],
    'Steins;Gate': ['SG', 'Steins;Gate'],
    'Neon Genesis Evangelion': ['EVA', 'NGE', 'Neon Genesis Evangelion'],
    'Psycho-Pass': ['PP', 'Psycho-Pass'],
    'Code Geass': ['CG', 'Code Geass'],
    'Mirai Nikki': ['MN', 'Mirai Nikki'],
    'Another': ['Another'],
    'Higurashi': ['Higurashi'],
    'Umineko': ['Umineko'],
    'Fate/stay night': ['FSN', 'Fate/stay night'],
    'Puella Magi Madoka Magica': ['PMMM', 'Puella Magi Madoka Magica'],
    'Re:Zero': ['ReZero', 'Re:Zero'],
    'Overlord': ['Overlord'],
    'No Game No Life': ['NGNL', 'No Game No Life'],
    'The Promised Neverland': ['TPN', 'The Promised Neverland'],
    'Jujutsu Kaisen': ['JJK', 'Jujutsu Kaisen'],
    'Chainsaw Man': ['CSM', 'Chainsaw Man'],
    'Spy x Family': ['SPYxFAMILY', 'Spy x Family'],
    'Violet Evergarden': ['Violet', 'Violet Evergarden'],
    'Your Name': ['Kimi no Na wa', 'Your Name'],
    'Weathering with You': ['Tenki no Ko', 'Weathering with You'],
    'A Silent Voice': ['Koe no Katachi', 'A Silent Voice'],
    'Your Lie in April': ['Shigatsu wa Kimi no Uso', 'Your Lie in April'],
    'Clannad': ['Clannad'],
    'Toradora': ['Toradora'],
    'Angel Beats': ['Angel Beats'],
    'The Melancholy of Haruhi Suzumiya': ['Haruhi', 'The Melancholy of Haruhi Suzumiya'],
    'Lucky Star': ['Lucky Star'],
    'Made in Abyss': ['MiA', 'Made in Abyss'],
    'Dr. Stone': ['Dr. Stone'],
    'The Rising of the Shield Hero': ['Shield Hero', 'The Rising of the Shield Hero'],
    'Mushoku Tensei': ['Mushoku', 'Mushoku Tensei'],
    'That Time I Got Reincarnated as a Slime': ['Slime', 'That Time I Got Reincarnated as a Slime'],
    'The Misfit of Demon King Academy': ['Maou Gakuin', 'The Misfit of Demon King Academy'],
    'Black Clover': ['Black Clover'],
    'Boruto': ['Boruto'],
    'Fire Force': ['Fire Force'],
    'The God of High School': ['GoH', 'The God of High School'],
    'Solo Leveling': ['Solo Leveling'],
    'Tower of God': ['Tower of God'],
    'Sousou no Frieren': ['Frieren', 'Sousou no Frieren'],
    'Frieren: Beyond Journey\'s End': ['Frieren', 'Frieren: Beyond Journey\'s End'],
    'Gintama': ['Gintama'],
    'Gintama°': ['Gintama'],
    'Gintama: THE FINAL': ['Gintama'],
    // أنمي شهيرة بالعربية
    'هجوم العمالقة': ['AOT', 'SnK', 'هجوم العمالقة', 'اتاك اون تايتن', 'اتاك', 'شينغيكي نو كيوجين'],
    'دفتر الموت': ['DN', 'دفتر الموت', 'ديث نوت'],
    'ناروتو': ['ناروتو', 'Naruto'],
    'ون بيس': ['OP', 'ون بيس', 'One Piece', 'وان بيس'],
    'أكاديمية الأبطال': ['MHA', 'BNHA', 'أكاديمية الأبطال', 'ماي هيرو أكاديميا'],
    'قاتل الشياطين': ['DS', 'Kimetsu', 'قاتل الشياطين', 'كيميتسو نو يايبا'],
    'غول طوكيو': ['TG', 'غول طوكيو', 'توكيو غول'],
    'الخيميائي الكامل': ['FMA', 'الخيميائي الكامل', 'فول ميتال ألكيميست'],
    'سيف الفن عبر الإنترنت': ['SAO', 'سيف الفن عبر الإنترنت', 'سورد آرت أونلاين'],
    'دراغون بول': ['DB', 'DBZ', 'دراغون بول', 'دراغون بول زد'],
    'بليتش': ['بليتش', 'Bleach'],
    'ذيل الجنية': ['FT', 'ذيل الجنية', 'فيري تيل'],
    'هانتر × هانتر': ['HxH', 'هانتر × هانتر', 'هانتر هانتر'],
    'بوابة شتاينز': ['SG', 'بوابة شتاينز', 'شتاينز غيت'],
    'إنجيليون الجيل النيون': ['EVA', 'NGE', 'إنجيليون الجيل النيون', 'نيون جينيسيس إيفانجيليون'],
    'التصريح النفسي': ['PP', 'التصريح النفسي', 'سايكو باس'],
    'كود غياس': ['CG', 'كود غياس', 'كود غياس'],
    'مذكرات المستقبل': ['MN', 'مذكرات المستقبل', 'ميراي نيكي'],
    'آخر': ['آخر', 'أناذر'],
    'هيغوراشي': ['هيغوراشي', 'Higurashi'],
    'أومينيكو': ['أومينيكو', 'Umineko'],
    'فات/ابق ليلاً': ['FSN', 'فات/ابق ليلاً', 'فات ستاي نايت'],
    'فتاة السحر ماجيكا ميدوكا': ['PMMM', 'فتاة السحر ماجيكا ميدوكا', 'بويلا ماغي مادوكا ماغيكا'],
    'ري: زيرو': ['ReZero', 'ري: زيرو', 'ري زيرو'],
    'أوفرلورد': ['أوفرلورد', 'Overlord'],
    'لا لعبة لا حياة': ['NGNL', 'لا لعبة لا حياة', 'نو غيم نو لايف'],
    'مملكة الموتى الموعودة': ['TPN', 'مملكة الموتى الموعودة', 'ذا برومايزد نيفرلاند'],
    'معركة الشياطين': ['JJK', 'معركة الشياطين', 'جوجوتسو كايسن'],
    'رجل المنشار': ['CSM', 'رجل المنشار', 'تشينسو مان'],
    'جاسوس × عائلة': ['SPYxFAMILY', 'جاسوس × عائلة', 'سباي × فاميلي'],
    'فيوليت إيفرغاردن': ['Violet', 'فيوليت إيفرغاردن', 'فيوليت إيفرغاردن'],
    'اسمك': ['Kimi no Na wa', 'اسمك', 'يور نام'],
    'الطقس معك': ['Tenki no Ko', 'الطقس معك', 'وذرينغ ويذ يو'],
    'صوت هامس': ['Koe no Katachi', 'صوت هامس', 'أ سايلنت فويس'],
    'كذبتك في أبريل': ['Shigatsu wa Kimi no Uso', 'كذبتك في أبريل', 'يور لاي إن أبريل'],
    'كلاناد': ['كلاناد', 'Clannad'],
    'تورادورا': ['تورادورا', 'Toradora'],
    'ضربات الملاك': ['ضربات الملاك', 'أنجل بيتس'],
    'حزن هاروهي سوزوميا': ['Haruhi', 'حزن هاروهي سوزوميا', 'ذا ميلانكولي أوف هاروهي سوزوميا'],
    'النجم المحظوظ': ['النجم المحظوظ', 'لاكي ستار'],
    'مصنوع في الهاوية': ['MiA', 'مصنوع في الهاوية', 'ميد إن أبيس'],
    'دكتور ستون': ['دكتور ستون', 'Dr. Stone'],
    'صعود بطل الدرع': ['Shield Hero', 'صعود بطل الدرع', 'ذا رايزينغ أوف ذا شيلد هيرو'],
    'رياضي بطال': ['Mushoku', 'رياضي بطال', 'موشوكو تينسي'],
    'حينما تحولت إلى سلايم': ['Slime', 'حينما تحولت إلى سلايم', 'ذات تايم آي غوت رينكارنيتد أس أ سليم'],
    'طالب شاذ في أكاديمية الشيطان': ['Maou Gakuin', 'طالب شاذ في أكاديمية الشيطان', 'ذا ميسفيت أوف ديمون كينغ أكاديمي'],
    'القرنفل الأسود': ['القرنفل الأسود', 'بلاك كلوفر'],
    'بوروتو': ['بوروتو', 'Boruto'],
    'قوة النار': ['قوة النار', 'فاير فورس'],
    'إله الثانوية': ['GoH', 'إله الثانوية', 'ذا غاد أوف هاي سكول'],
    'تطوير وحيد': ['تطوير وحيد', 'سولو ليفيلينغ'],
    'برج الإله': ['برج الإله', 'تاور أوف غاد'],
    'فريرن': ['فريرن', 'Frieren'],
    'غينتاما': ['غينتاما', 'Gintama'],
    'بركة المسؤول السماوي': ['بركة المسؤول السماوي', 'هافن أوفيسيالز بليسينغ'],
    'سلة الفاكهة': ['سلة الفاكهة', 'فروتس باسكت'],
    'كاغويا تريد أن تجعلني أعترف': ['كاغويا تريد أن تجعلني أعترف', 'كاغويا ساما وانتس تو ميك مي كونفيس'],
    'أسد شهر مارس': ['أسد شهر مارس', 'مارچ كومز إن لايك أ لايون'],
    'مذكرات الصيدلي': ['مذكرات الصيدلي', 'ذا أبوثيكاريس دايريز'],
    'فتاة الخيل: ديربي الجميل': ['فتاة الخيل: ديربي الجميل', 'أماموسومي بريتي ديربي'],
    'جو غداً': ['جو غداً', 'أشيتا نو جو'],
    'أسطورة الأبطال النجميين': ['أسطورة الأبطال النجميين', 'ليجند أوف ذا غالاكتيك هيروز'],
    'ملحمة فينلاند': ['ملحمة فينلاند', 'فينلاند ساغا'],
    'الوحش': ['الوحش', 'Monster'],
    'أيقظوا اليوفونيوم': ['أيقظوا اليوفونيوم', 'ساوند يوفونيوم'],
    'موب سايكو 100': ['موب سايكو 100', 'Mob Psycho 100']
  };

  // البحث عن تطابق مع الأنمي الشهير
  for (const [fullName, abbrs] of Object.entries(commonAnime)) {
    if (title.toLowerCase().includes(fullName.toLowerCase()) ||
        fullName.toLowerCase().includes(title.toLowerCase())) {
      abbreviations.push(...abbrs);
      break;
    }
  }

  // إضافة اختصارات عامة للأسماء الطويلة
  if (words.length > 2) {
    // أول حرف من كل كلمة
    const acronym = words.map(word => word.charAt(0)).join('').toUpperCase();
    if (acronym.length >= 2) {
      abbreviations.push(acronym);
    }
  }

  return [...new Set(abbreviations)]; // إزالة التكرارات
}

// الدالة الرئيسية
async function main() {
  try {
    console.log('🚀 بدء عملية تحديث قاعدة بيانات الأنمي...');

    // الاتصال بقاعدة البيانات
    await connectDB();

    // تنظيف قاعدة البيانات
    await clearDatabase();

    // جلب البيانات من AniList
    console.log('📡 جاري جلب أفضل 200 أنمي من AniList...');
    const animeList = await fetchTopAnime();

    if (animeList.length === 0) {
      console.error('❌ لم يتم جلب أي أنمي من API');
      return;
    }

    console.log(`📊 تم جلب ${animeList.length} أنمي من AniList`);

    // معالجة وحفظ البيانات
    await processAndSaveAnime(animeList);

    console.log('🎉 تم الانتهاء من تحديث قاعدة بيانات الأنمي بنجاح!');

  } catch (error) {
    console.error('❌ خطأ في العملية الرئيسية:', error);
  } finally {
    // إغلاق الاتصال
    await mongoose.connection.close();
    console.log('🔌 تم إغلاق الاتصال بقاعدة البيانات');
  }
}

// تشغيل السكريبت
main();