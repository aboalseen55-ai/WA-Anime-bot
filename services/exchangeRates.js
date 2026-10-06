// تحويل العملات لدينار أردني للمصاريف.
// الدولار ثابت (الدينار مربوط بالدولار: 1 دولار = 0.709 دينار)، والباقي من open.er-api.com مع كاش، وإذا فشل بأسعار تقريبية.
const API_URL = "https://open.er-api.com/v6/latest/JOD";
const CACHE_MS = 12 * 60 * 60 * 1000;
const USD_TO_JOD = 0.709;

// تقريبية، بس إذا ما قدرنا نجيب الأسعار الحية
const FALLBACK_TO_JOD = { USD: USD_TO_JOD, EUR: 0.77, GBP: 0.9, SAR: 0.189, AED: 0.193, KWD: 2.31, QAR: 0.195, BHD: 1.88, OMR: 1.84, EGP: 0.0145, ILS: 0.19, TRY: 0.021 };

let cache = { at: 0, rates: null };

export function resetExchangeRateCache() {
  cache = { at: 0, rates: null };
}

async function fetchRates(fetchImpl, now) {
  if (cache.rates && now - cache.at < CACHE_MS) return cache.rates;
  try {
    const response = await fetchImpl(API_URL, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data?.result !== "success" || typeof data?.rates !== "object") throw new Error("bad response");
    cache = { at: now, rates: data.rates };
    return data.rates;
  } catch (error) {
    console.warn("Exchange rates unavailable:", error.message);
    return cache.rates;
  }
}

/** كم دينار بيساوي 1 من هالعملة؟ { rate, live } أو null إذا العملة مش معروفة. */
export async function getRateToJOD(code, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const currency = String(code || "").toUpperCase();
  if (!currency || currency === "JOD") return { rate: 1, live: true };
  if (currency === "USD") return { rate: USD_TO_JOD, live: true };
  const rates = await fetchRates(fetchImpl, now);
  const perJod = Number(rates?.[currency]);
  if (Number.isFinite(perJod) && perJod > 0) return { rate: 1 / perJod, live: true };
  if (FALLBACK_TO_JOD[currency]) return { rate: FALLBACK_TO_JOD[currency], live: false };
  return null;
}
