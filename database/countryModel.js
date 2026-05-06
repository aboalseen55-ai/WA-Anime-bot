import mongoose from "mongoose";

const countrySchema = new mongoose.Schema({
  // اسم الدولة بالعربية
  arabicName: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // اسم الدولة بالإنجليزية
  englishName: {
    type: String,
    required: true
  },

  // أسماء بديلة/مرادفات للدولة
  aliases: [{
    type: String,
    trim: true
  }],

  // رابط صورة العلم
  flagUrl: {
    type: String,
    default: ""
  },

  // رمز الدولة (ISO 3166-1 alpha-2)
  countryCode: {
    type: String,
    default: ""
  },

  // تاريخ الإنشاء
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model("Country", countrySchema);
