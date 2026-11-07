// The business agent: answers a shop's customers on the owner's behalf, like a real employee.
// Pure helpers here (prompt, parsing, name handling) so they can be tested without WhatsApp or the AI.

export const HISTORY_LIMIT = 20;
const NEW_CONVERSATION_GAP_MS = 12 * 60 * 60 * 1000;

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/** A usable first name from the WhatsApp display name, or "" (emoji-only, numbers, shop-like names). */
export function firstNameCandidate(pushName) {
  const cleaned = String(pushName || '').replace(EMOJI, ' ').replace(/[^\p{L}\s'-]/gu, ' ').trim();
  const first = cleaned.split(/\s+/)[0] || '';
  return first.length >= 2 ? first.slice(0, 30) : '';
}

export function isNewConversation(contact, now = Date.now()) {
  const last = contact?.lastMessageAt ? new Date(contact.lastMessageAt).getTime() : 0;
  return !contact?.history?.length || now - last > NEW_CONVERSATION_GAP_MS;
}

export function buildAgentInstruction(settings, { voice = false } = {}) {
  const business = settings.businessName || 'المحل';
  return [
    `أنت ${settings.assistantName ? `من ${settings.assistantName}` : 'موظف خدمة الزبائن'} في "${business}"، وبترد على زباين المحل على واتساب بالنيابة عن صاحب المحل.`,
    `الأسلوب: ${settings.tone || 'ودود وطبيعي'}`,
    'احكي زي إنسان حقيقي: رسائل قصيرة (جملة لثلاث جمل)، طبيعية ودافية، بدون قوائم طويلة أو تنسيق رسمي، وإيموجي واحد بالكثير وأحيانًا بلاش.',
    'لا تقول إنك بوت أو ذكاء اصطناعي. بس إذا الزبون سأل بجدية "انت بوت؟" لا تكذب: قله إنك المساعد الذكي للمحل وإنه صاحب المحل بيتابع معه إذا حب.',
    'اعتمد فقط على معلومات المحل تحت. ممنوع تخترع أسعار أو مواعيد أو عناوين أو وعود. إذا المعلومة مش موجودة قول إنك رح تتأكد وترجعله، وحط handoff=true.',
    'لما يسأل عن السعر: وضّح بلطف إنه حسب المقاسات والخامات، واطلب صور المساحة والمقاسات التقريبية والمنطقة.',
    'إذا بعت صورة: علّق عليها بشكل طبيعي واربطها بالخدمة المناسبة.',
    'اسم الزبون: رح يوصلك اسمه على واتساب. رجّع customerArabicName = اسمه الأول مكتوب صح بالعربي (مثلاً Shatha → شذا، Mohammad → محمد، Lina → لينا، Omar → عمر). إذا الاسم أصلًا بالعربي رجّعه زي ما هو، وإذا مش اسم شخص (إيموجي، اسم محل، رموز) رجّع "".',
    'أول رسالة بالمحادثة: ترحيب قصير باسمه مثل "أهلين شذا، كيفك؟ 🌹" وبعدها جاوب على سؤاله إذا سأل. بعد هيك لا تعيد الترحيب، وحط اسمه بس أحيانًا بشكل طبيعي.',
    'handoff=true لما: الزبون بدو يأكد طلب أو يحجز معاينة وأعطى تفاصيله، أو طلب يحكي مع صاحب المحل أو شخص، أو عنده شكوى، أو سؤال ما بتعرف جوابه من المعلومات. وقتها طمّنه إنه رح يتواصل معه المسؤول قريب، واكتب handoffSummary قصير لصاحب المحل (شو بدو الزبون والتفاصيل اللي أعطاها).',
    voice
      ? 'الزبون بعت رسالة صوتية والرد رح يتحول لصوت: اكتب الرد كلام محكي طبيعي بدون إيموجي أو رموز أو روابط، وحط بـ heard شو قال الزبون باختصار.'
      : '',
    'رجّع JSON بس بهالشكل: {"reply": "...", "customerArabicName": "...", "handoff": false, "handoffSummary": "", "heard": ""}',
    '',
    '=== معلومات المحل ===',
    settings.knowledge || '(ما في معلومات إضافية)'
  ].filter(Boolean).join('\n');
}

export function buildConversationText({ contact, incomingTexts, now = Date.now(), timeZone = 'Asia/Amman' }) {
  const history = (contact?.history || []).slice(-HISTORY_LIMIT)
    .map(item => `${item.role === 'customer' ? 'الزبون' : item.role === 'owner' ? 'صاحب المحل' : 'أنت'}: ${item.text}`)
    .join('\n');
  const time = new Intl.DateTimeFormat('ar-JO', { timeZone, weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(now));
  return [
    `الوقت الحالي: ${time}`,
    `اسم الزبون على واتساب: ${contact?.pushName || '(غير معروف)'}`,
    contact?.arabicName ? `اسمه بالعربي (معروف): ${contact.arabicName}` : '',
    isNewConversation(contact, now) ? 'هذي بداية محادثة جديدة: رحّب فيه باسمه.' : 'المحادثة مستمرة: لا تعيد الترحيب.',
    history ? `\nالمحادثة السابقة:\n${history}` : '',
    `\nرسالة الزبون الجديدة:\n${incomingTexts.filter(Boolean).join('\n') || '(رسالة صوتية أو صورة مرفقة)'}`
  ].filter(Boolean).join('\n');
}

export function parseAgentReply(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let data = null;
  try {
    data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    const match = /\{[\s\S]*\}/.exec(text);
    if (match) { try { data = JSON.parse(match[0]); } catch { data = null; } }
  }
  if (!data || typeof data !== 'object') return { reply: text.slice(0, 1500), customerArabicName: '', handoff: false, handoffSummary: '', heard: '' };
  const reply = String(data.reply || '').trim().slice(0, 1500);
  if (!reply) return null;
  const arabicName = String(data.customerArabicName || '').trim();
  return {
    reply,
    customerArabicName: /^[؀-ۿ\s]{2,30}$/.test(arabicName) ? arabicName : '',
    handoff: data.handoff === true,
    handoffSummary: String(data.handoffSummary || '').trim().slice(0, 600),
    heard: String(data.heard || '').trim().slice(0, 600)
  };
}

/** Text the voice engine can say: no emojis, links or WhatsApp formatting. */
export function toSpokenText(text) {
  return String(text || '').replace(EMOJI, '').replace(/https?:\/\/\S+/g, '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
}

export function phoneFromJid(jid) {
  const value = String(jid || '');
  return value.endsWith('@s.whatsapp.net') ? value.split('@')[0].split(':')[0] : '';
}

export function buildOwnerAlert({ businessName, contact, summary }) {
  const name = contact.arabicName || contact.pushName || 'زبون';
  const phone = contact.phone ? `\n📞 wa.me/${contact.phone}` : '';
  return `🔔 ${businessName || 'المحل'}: زبون بحاجة إلك\n👤 ${name}${phone}\n📝 ${summary || 'طلب يحكي مع المسؤول'}`;
}
