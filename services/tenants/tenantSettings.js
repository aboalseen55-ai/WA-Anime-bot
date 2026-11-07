// Per-account bot settings: what the business is, how the agent talks, who gets the alerts.
export const DEFAULT_TENANT_SETTINGS = Object.freeze({
  botEnabled: true,
  businessName: '',
  assistantName: '',
  knowledge: '',
  tone: 'لهجة أردنية ودودة ومحترمة، جمل قصيرة، زي موظف حقيقي بالمحل.',
  ownerNumbers: [],
  voiceReplies: true,
  voiceId: '',
  pauseHours: 3
});

export const TENANT_PRESETS = Object.freeze({
  firestone: {
    name: 'فايرستون للديكور',
    settings: {
      businessName: 'فايرستون للديكور (Firestone Jo)',
      assistantName: 'فريق فايرستون',
      ownerNumbers: ['962798202604'],
      knowledge: [
        'فايرستون للديكور (Firestone Jo): تصميم وتنفيذ ديكورات داخلية وخارجية في الأردن، من الفكرة حتى التركيب.',
        'الخبرة: أكثر من 6 سنوات، وأكثر من 50 مشروع منفّذ.',
        'المناطق: عمّان، مأدبا، ناعور، مرج الحمام. لمنطقة ثانية: بنتأكد إذا بنقدر نخدمها.',
        'الخدمات:',
        '1) فاير بليس وديكورات شاشة: فاير بليس، واجهات شاشة، إضاءة مخفية، مع رخام وكسوات.',
        '2) كلادنغ وبديل رخام: كسوات وبديل رخام بألوان وملامس مختلفة.',
        '3) ديكورات داخلية وغرف نوم: خلفيات أسرّة، جدران مميزة، ديكورات فوم.',
        '4) شلالات وجلسات خارجية: جلسات رخامية، شلالات، مطابخ شواء خارجية.',
        'الأسعار: ما في أسعار ثابتة؛ السعر حسب المقاسات والخامات وتفاصيل التنفيذ. اطلب صور المساحة والمقاسات التقريبية والمنطقة، وبعدها بنرتب معاينة وعرض سعر.',
        'تنفيذ تصميم من صورة: أكيد ممكن، الزبون يبعت الصورة ومنراجع إذا بتناسب المساحة والخامات.',
        'مدة التنفيذ: حسب حجم الشغل وتوفر الخامات وجاهزية الموقع، بتنحدد بعد الاتفاق.',
        'خطوات العمل: نسمع فكرتك ونشوف صور المساحة، معاينة وقياسات، نختار الخامات والألوان والإضاءة ونوضح التكلفة، بعدين التنفيذ والتركيب.',
        'الموقع: firestonejo.com — إنستغرام: @_firestonejo — هاتف وواتساب: 0798202604.',
        'العنوان وساعات الدوام: (لسا ما انضافوا؛ إذا سأل الزبون قله إنه رح نأكدله ونحوّل للمسؤول).'
      ].join('\n')
    }
  }
});

const clip = (value, max) => String(value ?? '').trim().slice(0, max);

export function normalizeNumbers(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[\n,،\s]+/);
  const numbers = [...new Set(items.map(item => String(item).replace(/\D/g, '').replace(/^00/, '').replace(/^0(7\d{8})$/, '962$1')).filter(Boolean))];
  if (numbers.some(number => !/^[1-9]\d{7,14}$/.test(number))) throw new Error('رقم غير صالح؛ اكتب الرقم دولي مثل 962798202604');
  if (numbers.length > 5) throw new Error('الحد الأقصى 5 أرقام للتنبيهات');
  return numbers;
}

export function validateTenantSettings(input = {}, current = {}) {
  const merged = { ...DEFAULT_TENANT_SETTINGS, ...current };
  const result = { ...merged };
  if (Object.hasOwn(input, 'botEnabled')) result.botEnabled = input.botEnabled !== false;
  if (Object.hasOwn(input, 'businessName')) result.businessName = clip(input.businessName, 80);
  if (Object.hasOwn(input, 'assistantName')) result.assistantName = clip(input.assistantName, 40);
  if (Object.hasOwn(input, 'knowledge')) result.knowledge = clip(input.knowledge, 8000);
  if (Object.hasOwn(input, 'tone')) result.tone = clip(input.tone, 300);
  if (Object.hasOwn(input, 'ownerNumbers')) result.ownerNumbers = normalizeNumbers(input.ownerNumbers);
  if (Object.hasOwn(input, 'voiceReplies')) result.voiceReplies = input.voiceReplies !== false;
  if (Object.hasOwn(input, 'voiceId')) {
    result.voiceId = clip(input.voiceId, 64);
    if (result.voiceId && !/^[A-Za-z0-9]+$/.test(result.voiceId)) throw new Error('معرّف الصوت غير صالح');
  }
  if (Object.hasOwn(input, 'pauseHours')) {
    const hours = Number(input.pauseHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 48) throw new Error('مدة السكوت بين 0 و 48 ساعة');
    result.pauseHours = hours;
  }
  return result;
}

export function tenantSettings(tenant) {
  return { ...DEFAULT_TENANT_SETTINGS, ...(tenant?.settings || {}) };
}
