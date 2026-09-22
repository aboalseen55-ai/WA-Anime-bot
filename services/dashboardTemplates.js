import DashboardTemplate from '../database/dashboardTemplateModel.js';
import replyCatalog from './dashboardReplyCatalog.json' with { type: 'json' };
import namedDefaults from './dashboardNamedDefaults.json' with { type: 'json' };

export const TEMPLATE_DEFINITIONS = {
  ...replyCatalog,
  welcome: { title: 'استمارة الترحيب', fields: ['nickname', 'mention', 'kingdomName', 'kingdomShortName', 'moderatorName', 'announcementLink'], required: ['mention'], sample: 'أهلًا {nickname} في {kingdomName}\n{mention}\nالمسؤول: {moderatorName}\nالإعلانات: {announcementLink}' },
  workWelcome: { title: 'إنجاز الاستقبال', fields: ['nickname', 'status', 'enteringSource', 'moderatorName', 'kingdomName'], required: [], sample: 'استقبال عضو في {kingdomName}\nاللقب: {nickname}\nالحالة: {status}\nمن طرف: {enteringSource}\nالمسؤول: {moderatorName}' },
  promotion: { title: 'إعلان الترقية', fields: ['nickname', 'mention', 'kingdomName', 'oldRank', 'newRank', 'signature'], required: ['mention', 'oldRank', 'newRank'], sample: 'ترقية في {kingdomName}\n{nickname} {mention}\nمن: {oldRank}\nإلى: {newRank}\nالتوقيع: {signature}' }
};
for (const [key, text] of Object.entries(namedDefaults)) TEMPLATE_DEFINITIONS[key].sample = text;

export function dashboardReply(key) {
  return (strings, ...values) => {
    const original = strings.reduce((text, part, index) => text + part + (index < values.length ? String(values[index]) : ''), '');
    return renderBotTemplate(key, Object.fromEntries(values.map((value, index) => ['value' + (index + 1), value])), original);
  };
}

let overrides = new Map();
export async function refreshDashboardTemplates() {
  const rows = await DashboardTemplate.find({}).lean();
  overrides = new Map(rows.map(row => [row.key, row.text]));
}

export function validateTemplate(key, text) {
  const definition = TEMPLATE_DEFINITIONS[key];
  if (!definition) throw new Error('القالب غير موجود');
  if (typeof text !== 'string' || !text.trim() || text.length > 12000) throw new Error('النص مطلوب، بحد أقصى 12000 حرف');
  for (const match of text.matchAll(/\{([^{}]+)\}/g)) {
    if (!definition.fields.includes(match[1]) && !definition.sample.includes(match[0])) throw new Error('متغير غير معروف: ' + match[1]);
  }
  for (const field of definition.required) {
    if (!text.includes('{' + field + '}')) throw new Error('يجب الاحتفاظ بالمتغير {' + field + '}');
  }
  return text;
}

export function renderBotTemplate(key, values, original) {
  const template = overrides.get(key);
  if (!template) return original;
  return template.replace(/\{([^{}]+)\}/g, (_, field) => String(values[field] ?? ''));
}
