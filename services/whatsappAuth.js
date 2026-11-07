// تنظيف جلسة واتساب لما الحساب يطلع (logout / حذف الجهاز من الموبايل)، عشان البوت يطلب QR جديد بدل ما يوقف.
import fs from 'fs/promises';
import path from 'path';

// 401 = loggedOut عند Baileys (يشمل device_removed لما ينشال الجهاز المرتبط من الموبايل)
export const LOGGED_OUT_STATUS_CODES = new Set([401]);

export function isLoggedOutDisconnect(statusCode) {
  return LOGGED_OUT_STATUS_CODES.has(statusCode);
}

// يمسح ملفات الجلسة فقط ويخلي الملفات المحددة (مثل علامة إعادة الضبط). يرجع عدد الملفات الممسوحة.
export async function clearWhatsAppAuth(authDir, { keep = [] } = {}) {
  let entries;
  try {
    entries = await fs.readdir(authDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  const keepSet = new Set(keep);
  let removed = 0;
  for (const entry of entries) {
    if (keepSet.has(entry.name)) continue;
    await fs.rm(path.join(authDir, entry.name), { recursive: true, force: true });
    removed++;
  }
  return removed;
}
