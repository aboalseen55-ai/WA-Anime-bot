// نفس الكود بيشتغل كبوتين منفصلين حسب BOT_MODE:
//   all      (الافتراضي) كل اشي زي ما هو
//   personal سام الشخصي: مساعد، تذكيرات، مصاريف، فويس، بزنس. بدون ممالك وأنمي وألعاب
//   fun      بوت القروبات: ممالك، أنمي، ألعاب، رتب، ترحيب. بدون المساعد الشخصي والبزنس
const MODES = new Set(["all", "personal", "fun"]);

export function getBotMode() {
  const mode = String(process.env.BOT_MODE || "all").trim().toLowerCase();
  return MODES.has(mode) ? mode : "all";
}

export function personalEnabled() {
  return getBotMode() !== "fun";
}

export function funEnabled() {
  return getBotMode() !== "personal";
}
