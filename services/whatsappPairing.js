// رمز ربط واتساب (QR) للوحة التحكم: يُحفظ بالذاكرة فقط، أحدث رمز فقط، ويُمسح عند الاتصال أو انتهاء صلاحيته.
// القيمة نفسها بمثابة بيانات اعتماد مؤقتة، فلا تُطبع في الـ logs ولا تُحفظ على القرص.
import QRCode from 'qrcode';

// Baileys بيبدّل الرمز كل ~20 ثانية (أول واحد 60)، فـ 60 ثانية سقف آمن لو ما وصل بديل
export const PAIRING_QR_TTL_MS = 60_000;

let current = null;
let expiryTimer = null;
let sequence = 0;

export function clearPairingQr() {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  current = null;
}

export async function setPairingQr(qr, { now = Date.now(), ttlMs = PAIRING_QR_TTL_MS } = {}) {
  const value = String(qr || '');
  if (!value) return clearPairingQr();
  const id = ++sequence;
  const svg = await QRCode.toString(value, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } });
  // وصل رمز أحدث أو تم الاتصال أثناء الرسم: لا تكتب فوقه
  if (id !== sequence) return;
  if (expiryTimer) clearTimeout(expiryTimer);
  current = { id, image: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), issuedAt: now, expiresAt: now + ttlMs };
  expiryTimer = setTimeout(clearPairingQr, ttlMs);
  expiryTimer.unref?.();
}

// أي تغيير بالاتصال (فتح أو إغلاق) يلغي أي رسم قيد التنفيذ ويمسح الرمز
export function invalidatePairingQr() {
  sequence++;
  clearPairingQr();
}

export function pairingSnapshot({ connected, connection } = {}, now = Date.now()) {
  if (current && current.expiresAt <= now) clearPairingQr();
  if (connected) {
    if (current) clearPairingQr();
    return { status: 'connected', connection: connection || 'open' };
  }
  if (!current) return { status: 'waiting', connection: connection || 'close' };
  return { status: 'qr', connection: connection || 'connecting', id: current.id, image: current.image, issuedAt: current.issuedAt, expiresAt: current.expiresAt, expiresIn: current.expiresAt - now };
}
