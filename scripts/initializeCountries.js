import mongoose from "mongoose";
import Country from "../database/countryModel.js";
import { connectDB } from "../database/db.js";

// قائمة دول العالم بالعربية مع الإنجليزية
const countries = [
  { arabicName: "الإمارات العربية المتحدة", englishName: "United Arab Emirates", code: "AE" },
  { arabicName: "أفغانستان", englishName: "Afghanistan", code: "AF" },
  { arabicName: "ألبانيا", englishName: "Albania", code: "AL" },
  { arabicName: "الجزائر", englishName: "Algeria", code: "DZ" },
  { arabicName: "أنجويلا", englishName: "Anguilla", code: "AI" },
  { arabicName: "أنتيغوا وبربودا", englishName: "Antigua and Barbuda", code: "AG" },
  { arabicName: "أرجنتين", englishName: "Argentina", code: "AR" },
  { arabicName: "أرمينيا", englishName: "Armenia", code: "AM" },
  { arabicName: "أروبا", englishName: "Aruba", code: "AW" },
  { arabicName: "أستراليا", englishName: "Australia", code: "AU" },
  { arabicName: "النمسا", englishName: "Austria", code: "AT" },
  { arabicName: "أذربيجان", englishName: "Azerbaijan", code: "AZ" },
  { arabicName: "جزر البهاما", englishName: "Bahamas", code: "BS" },
  { arabicName: "البحرين", englishName: "Bahrain", code: "BH" },
  { arabicName: "بنجلاديش", englishName: "Bangladesh", code: "BD" },
  { arabicName: "بربادوس", englishName: "Barbados", code: "BB" },
  { arabicName: "بيلاروس", englishName: "Belarus", code: "BY" },
  { arabicName: "بلجيكا", englishName: "Belgium", code: "BE" },
  { arabicName: "بليز", englishName: "Belize", code: "BZ" },
  { arabicName: "بنين", englishName: "Benin", code: "BJ" },
  { arabicName: "برمودا", englishName: "Bermuda", code: "BM" },
  { arabicName: "بوتان", englishName: "Bhutan", code: "BT" },
  { arabicName: "بوليفيا", englishName: "Bolivia", code: "BO" },
  { arabicName: "البوسنة والهرسك", englishName: "Bosnia and Herzegovina", code: "BA" },
  { arabicName: "بوتسوانا", englishName: "Botswana", code: "BW" },
  { arabicName: "البرازيل", englishName: "Brazil", code: "BR" },
  { arabicName: "بروناي", englishName: "Brunei", code: "BN" },
  { arabicName: "بلغاريا", englishName: "Bulgaria", code: "BG" },
  { arabicName: "بوركينا فاسو", englishName: "Burkina Faso", code: "BF" },
  { arabicName: "بوروندي", englishName: "Burundi", code: "BI" },
  { arabicName: "كمبوديا", englishName: "Cambodia", code: "KH" },
  { arabicName: "الكاميرون", englishName: "Cameroon", code: "CM" },
  { arabicName: "كندا", englishName: "Canada", code: "CA" },
  { arabicName: "الرأس الأخضر", englishName: "Cape Verde", code: "CV" },
  { arabicName: "جزر كايمان", englishName: "Cayman Islands", code: "KY" },
  { arabicName: "جمهورية أفريقيا الوسطى", englishName: "Central African Republic", code: "CF" },
  { arabicName: "تشاد", englishName: "Chad", code: "TD" },
  { arabicName: "تشيلي", englishName: "Chile", code: "CL" },
  { arabicName: "الصين", englishName: "China", code: "CN" },
  { arabicName: "كولومبيا", englishName: "Colombia", code: "CO" },
  { arabicName: "جزر القمر", englishName: "Comoros", code: "KM" },
  { arabicName: "الكونغو", englishName: "Congo", code: "CG" },
  { arabicName: "جمهورية الكونغو الديمقراطية", englishName: "Democratic Republic of the Congo", code: "CD" },
  { arabicName: "كوستاريكا", englishName: "Costa Rica", code: "CR" },
  { arabicName: "كرواتيا", englishName: "Croatia", code: "HR" },
  { arabicName: "كوبا", englishName: "Cuba", code: "CU" },
  { arabicName: "قبرص", englishName: "Cyprus", code: "CY" },
  { arabicName: "جمهورية التشيك", englishName: "Czech Republic", code: "CZ" },
  { arabicName: "الدانمرك", englishName: "Denmark", code: "DK" },
  { arabicName: "جيبوتي", englishName: "Djibouti", code: "DJ" },
  { arabicName: "دومينيكا", englishName: "Dominica", code: "DM" },
  { arabicName: "الجمهورية الدومينيكية", englishName: "Dominican Republic", code: "DO" },
  { arabicName: "إكوادور", englishName: "Ecuador", code: "EC" },
  { arabicName: "مصر", englishName: "Egypt", code: "EG" },
  { arabicName: "السلفادور", englishName: "El Salvador", code: "SV" },
  { arabicName: "غينيا الاستوائية", englishName: "Equatorial Guinea", code: "GQ" },
  { arabicName: "إريتريا", englishName: "Eritrea", code: "ER" },
  { arabicName: "إستونيا", englishName: "Estonia", code: "EE" },
  { arabicName: "إسواتيني", englishName: "Eswatini", code: "SZ" },
  { arabicName: "إثيوبيا", englishName: "Ethiopia", code: "ET" },
  { arabicName: "جزر فارو", englishName: "Faroe Islands", code: "FO" },
  { arabicName: "فيجي", englishName: "Fiji", code: "FJ" },
  { arabicName: "فنلندا", englishName: "Finland", code: "FI" },
  { arabicName: "فرنسا", englishName: "France", code: "FR" },
  { arabicName: "بولينيزيا الفرنسية", englishName: "French Polynesia", code: "PF" },
  { arabicName: "الجابون", englishName: "Gabon", code: "GA" },
  { arabicName: "جامبيا", englishName: "Gambia", code: "GM" },
  { arabicName: "جورجيا", englishName: "Georgia", code: "GE" },
  { arabicName: "ألمانيا", englishName: "Germany", code: "DE" },
  { arabicName: "غانا", englishName: "Ghana", code: "GH" },
  { arabicName: "جبل طارق", englishName: "Gibraltar", code: "GI" },
  { arabicName: "اليونان", englishName: "Greece", code: "GR" },
  { arabicName: "غرينادا", englishName: "Grenada", code: "GD" },
  { arabicName: "غوام", englishName: "Guam", code: "GU" },
  { arabicName: "غواتيمالا", englishName: "Guatemala", code: "GT" },
  { arabicName: "غيرنسي", englishName: "Guernsey", code: "GG" },
  { arabicName: "غينيا", englishName: "Guinea", code: "GN" },
  { arabicName: "غينيا بيساو", englishName: "Guinea-Bissau", code: "GW" },
  { arabicName: "غيانا", englishName: "Guyana", code: "GY" },
  { arabicName: "هايتي", englishName: "Haiti", code: "HT" },
  { arabicName: "هندوراس", englishName: "Honduras", code: "HN" },
  { arabicName: "هونغ كونغ", englishName: "Hong Kong", code: "HK" },
  { arabicName: "المجر", englishName: "Hungary", code: "HU" },
  { arabicName: "أيسلندا", englishName: "Iceland", code: "IS" },
  { arabicName: "الهند", englishName: "India", code: "IN" },
  { arabicName: "إندونيسيا", englishName: "Indonesia", code: "ID" },
  { arabicName: "إيران", englishName: "Iran", code: "IR" },
  { arabicName: "العراق", englishName: "Iraq", code: "IQ" },
  { arabicName: "أيرلندا", englishName: "Ireland", code: "IE" },
  { arabicName: "جزيرة مان", englishName: "Isle of Man", code: "IM" },
  { arabicName: "إسرائيل", englishName: "Israel", code: "IL" },
  { arabicName: "إيطاليا", englishName: "Italy", code: "IT" },
  { arabicName: "ساحل العاج", englishName: "Ivory Coast", code: "CI" },
  { arabicName: "جامايكا", englishName: "Jamaica", code: "JM" },
  { arabicName: "اليابان", englishName: "Japan", code: "JP" },
  { arabicName: "جيرسي", englishName: "Jersey", code: "JE" },
  { arabicName: "الأردن", englishName: "Jordan", code: "JO" },
  { arabicName: "كازاخستان", englishName: "Kazakhstan", code: "KZ" },
  { arabicName: "كينيا", englishName: "Kenya", code: "KE" },
  { arabicName: "كيريباتي", englishName: "Kiribati", code: "KI" },
  { arabicName: "كوسوفو", englishName: "Kosovo", code: "XK" },
  { arabicName: "الكويت", englishName: "Kuwait", code: "KW" },
  { arabicName: "قيرغيزستان", englishName: "Kyrgyzstan", code: "KG" },
  { arabicName: "لاوس", englishName: "Laos", code: "LA" },
  { arabicName: "لاتفيا", englishName: "Latvia", code: "LV" },
  { arabicName: "لبنان", englishName: "Lebanon", code: "LB" },
  { arabicName: "ليسوتو", englishName: "Lesotho", code: "LS" },
  { arabicName: "ليبيريا", englishName: "Liberia", code: "LR" },
  { arabicName: "ليبيا", englishName: "Libya", code: "LY" },
  { arabicName: "ليختنشتاين", englishName: "Liechtenstein", code: "LI" },
  { arabicName: "ليتوانيا", englishName: "Lithuania", code: "LT" },
  { arabicName: "لوكسمبرغ", englishName: "Luxembourg", code: "LU" },
  { arabicName: "ماكاو", englishName: "Macao", code: "MO" },
  { arabicName: "مدغشقر", englishName: "Madagascar", code: "MG" },
  { arabicName: "ملاوي", englishName: "Malawi", code: "MW" },
  { arabicName: "ماليزيا", englishName: "Malaysia", code: "MY" },
  { arabicName: "جزر مالديف", englishName: "Maldives", code: "MV" },
  { arabicName: "مالي", englishName: "Mali", code: "ML" },
  { arabicName: "مالطا", englishName: "Malta", code: "MT" },
  { arabicName: "جزر مارشال", englishName: "Marshall Islands", code: "MH" },
  { arabicName: "موريتانيا", englishName: "Mauritania", code: "MR" },
  { arabicName: "موريشيوس", englishName: "Mauritius", code: "MU" },
  { arabicName: "المكسيك", englishName: "Mexico", code: "MX" },
  { arabicName: "ميكرونيزيا", englishName: "Micronesia", code: "FM" },
  { arabicName: "مولدافيا", englishName: "Moldova", code: "MD" },
  { arabicName: "موناكو", englishName: "Monaco", code: "MC" },
  { arabicName: "منغوليا", englishName: "Mongolia", code: "MN" },
  { arabicName: "الجبل الأسود", englishName: "Montenegro", code: "ME" },
  { arabicName: "المغرب", englishName: "Morocco", code: "MA" },
  { arabicName: "موزمبيق", englishName: "Mozambique", code: "MZ" },
  { arabicName: "ميانمار", englishName: "Myanmar", code: "MM" },
  { arabicName: "ناميبيا", englishName: "Namibia", code: "NA" },
  { arabicName: "ناورو", englishName: "Nauru", code: "NR" },
  { arabicName: "نيبال", englishName: "Nepal", code: "NP" },
  { arabicName: "هولندا", englishName: "Netherlands", code: "NL" },
  { arabicName: "نيوزيلندا", englishName: "New Zealand", code: "NZ" },
  { arabicName: "نيكاراغوا", englishName: "Nicaragua", code: "NI" },
  { arabicName: "النيجر", englishName: "Niger", code: "NE" },
  { arabicName: "نيجيريا", englishName: "Nigeria", code: "NG" },
  { arabicName: "كوريا الشمالية", englishName: "North Korea", code: "KP" },
  { arabicName: "مقدونيا الشمالية", englishName: "North Macedonia", code: "MK" },
  { arabicName: "جزر مريانا الشمالية", englishName: "Northern Mariana Islands", code: "MP" },
  { arabicName: "النرويج", englishName: "Norway", code: "NO" },
  { arabicName: "عمان", englishName: "Oman", code: "OM" },
  { arabicName: "باكستان", englishName: "Pakistan", code: "PK" },
  { arabicName: "بالاو", englishName: "Palau", code: "PW" },
  { arabicName: "فلسطين", englishName: "Palestine", code: "PS" },
  { arabicName: "بنما", englishName: "Panama", code: "PA" },
  { arabicName: "بابوا غينيا الجديدة", englishName: "Papua New Guinea", code: "PG" },
  { arabicName: "باراغواي", englishName: "Paraguay", code: "PY" },
  { arabicName: "بيرو", englishName: "Peru", code: "PE" },
  { arabicName: "الفلبين", englishName: "Philippines", code: "PH" },
  { arabicName: "بولندا", englishName: "Poland", code: "PL" },
  { arabicName: "البرتغال", englishName: "Portugal", code: "PT" },
  { arabicName: "بورتوريكو", englishName: "Puerto Rico", code: "PR" },
  { arabicName: "قطر", englishName: "Qatar", code: "QA" },
  { arabicName: "رومانيا", englishName: "Romania", code: "RO" },
  { arabicName: "روسيا", englishName: "Russia", code: "RU" },
  { arabicName: "رواندا", englishName: "Rwanda", code: "RW" },
  { arabicName: "سانت كيتس ونيفس", englishName: "Saint Kitts and Nevis", code: "KN" },
  { arabicName: "سانت لوسيا", englishName: "Saint Lucia", code: "LC" },
  { arabicName: "سانت فنسنت والجرينادين", englishName: "Saint Vincent and the Grenadines", code: "VC" },
  { arabicName: "ساموا", englishName: "Samoa", code: "WS" },
  { arabicName: "سان مارينو", englishName: "San Marino", code: "SM" },
  { arabicName: "ساو تومي وبرينسيبي", englishName: "São Tomé and Príncipe", code: "ST" },
  { arabicName: "المملكة العربية السعودية", englishName: "Saudi Arabia", code: "SA" },
  { arabicName: "السنغال", englishName: "Senegal", code: "SN" },
  { arabicName: "صربيا", englishName: "Serbia", code: "RS" },
  { arabicName: "سيشل", englishName: "Seychelles", code: "SC" },
  { arabicName: "سيراليون", englishName: "Sierra Leone", code: "SL" },
  { arabicName: "سنغافورة", englishName: "Singapore", code: "SG" },
  { arabicName: "سلوفاكيا", englishName: "Slovakia", code: "SK" },
  { arabicName: "سلوفينيا", englishName: "Slovenia", code: "SI" },
  { arabicName: "جزر سليمان", englishName: "Solomon Islands", code: "SB" },
  { arabicName: "الصومال", englishName: "Somalia", code: "SO" },
  { arabicName: "جنوب أفريقيا", englishName: "South Africa", code: "ZA" },
  { arabicName: "كوريا الجنوبية", englishName: "South Korea", code: "KR" },
  { arabicName: "جنوب السودان", englishName: "South Sudan", code: "SS" },
  { arabicName: "إسبانيا", englishName: "Spain", code: "ES" },
  { arabicName: "سريلانكا", englishName: "Sri Lanka", code: "LK" },
  { arabicName: "السودان", englishName: "Sudan", code: "SD" },
  { arabicName: "سورينام", englishName: "Suriname", code: "SR" },
  { arabicName: "السويد", englishName: "Sweden", code: "SE" },
  { arabicName: "سويسرا", englishName: "Switzerland", code: "CH" },
  { arabicName: "سوريا", englishName: "Syria", code: "SY" },
  { arabicName: "تايوان", englishName: "Taiwan", code: "TW" },
  { arabicName: "طاجيكستان", englishName: "Tajikistan", code: "TJ" },
  { arabicName: "تنزانيا", englishName: "Tanzania", code: "TZ" },
  { arabicName: "تايلاند", englishName: "Thailand", code: "TH" },
  { arabicName: "تيمور الشرقية", englishName: "Timor-Leste", code: "TL" },
  { arabicName: "توغو", englishName: "Togo", code: "TG" },
  { arabicName: "تونغا", englishName: "Tonga", code: "TO" },
  { arabicName: "ترينيداد وتوباغو", englishName: "Trinidad and Tobago", code: "TT" },
  { arabicName: "تونس", englishName: "Tunisia", code: "TN" },
  { arabicName: "تركمانستان", englishName: "Turkmenistan", code: "TM" },
  { arabicName: "تركيا", englishName: "Turkey", code: "TR" },
  { arabicName: "توفالو", englishName: "Tuvalu", code: "TV" },
  { arabicName: "أوغندا", englishName: "Uganda", code: "UG" },
  { arabicName: "أوكرانيا", englishName: "Ukraine", code: "UA" },
  { arabicName: "المملكة المتحدة", englishName: "United Kingdom", code: "GB" },
  { arabicName: "الولايات المتحدة الأمريكية", englishName: "United States", code: "US" },
  { arabicName: "أوروغواي", englishName: "Uruguay", code: "UY" },
  { arabicName: "أوزبكستان", englishName: "Uzbekistan", code: "UZ" },
  { arabicName: "فانواتو", englishName: "Vanuatu", code: "VU" },
  { arabicName: "الفاتيكان", englishName: "Vatican City", code: "VA" },
  { arabicName: "فنزويلا", englishName: "Venezuela", code: "VE" },
  { arabicName: "فيتنام", englishName: "Vietnam", code: "VN" },
  { arabicName: "جزر العذراء البريطانية", englishName: "British Virgin Islands", code: "VG" },
  { arabicName: "جزر العذراء الأمريكية", englishName: "US Virgin Islands", code: "VI" },
  { arabicName: "واليس وفوتونا", englishName: "Wallis and Futuna", code: "WF" },
  { arabicName: "اليمن", englishName: "Yemen", code: "YE" },
  { arabicName: "زامبيا", englishName: "Zambia", code: "ZM" },
  { arabicName: "زيمبابوي", englishName: "Zimbabwe", code: "ZW" }
];

// دالة الحفظ
async function saveCountries() {
  try {
    await connectDB();
    console.log("🔗 تم الاتصال بقاعدة البيانات");

    // حذف البيانات القديمة (اختياري)
    // await Country.deleteMany({});

    // حفظ الدول
    let saved = 0;
    for (const country of countries) {
      try {
        // التحقق إذا كانت الدولة موجودة بالفعل
        const exists = await Country.findOne({ arabicName: country.arabicName });
        
        if (!exists) {
          const newCountry = new Country({
            arabicName: country.arabicName,
            englishName: country.englishName,
            countryCode: country.code,
            flagUrl: "" // سيتم تعبئتها بسكربت جلب الصور
          });
          
          await newCountry.save();
          saved++;
          console.log(`✅ تم حفظ: ${country.arabicName}`);
        } else {
          console.log(`⏭️  موجودة بالفعل: ${country.arabicName}`);
        }
      } catch (err) {
        console.error(`❌ خطأ في حفظ ${country.arabicName}:`, err.message);
      }
    }

    console.log(`\n✅ تم حفظ ${saved} دول جديدة من أصل ${countries.length}`);
    
    // عد إجمالي الدول في قاعدة البيانات
    const totalCount = await Country.countDocuments();
    console.log(`📊 إجمالي الدول في قاعدة البيانات: ${totalCount}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ خطأ:", error.message);
    process.exit(1);
  }
}

// تشغيل السكربت
saveCountries();
