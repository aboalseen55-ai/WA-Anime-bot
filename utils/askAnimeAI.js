// askAnimeAI.js
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function askAnimeAI(userMessage) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // أرخص أو مجاني نسبيًا
      messages: [
        { 
          role: "system", 
          content: "أنت خبير أنمي. أجب فقط على أسئلة الأنمي، المانجا، الشخصيات، الاستوديوهات، والحلقات. أجب بالعربي قدر الإمكان." 
        },
        { role: "user", content: userMessage }
      ],
      max_tokens: 400
    });

    return response.choices[0].message.content;
  } catch (err) {
    console.error("❌ Error in askAnimeAI:", err.message);
    return "حدث خطأ أثناء معالجة السؤال.";
  }
}