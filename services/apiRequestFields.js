export function validateRequestFields(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('إعدادات الحقول غير صالحة');
  const result = {};
  for (const key of ['query','headers','body']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('حالة الحقل غير صالحة');
    result[key] = value[key] !== false;
    const list = value['disabled'+key] ?? [];
    if (!Array.isArray(list) || list.length > 100 || list.some(item=>typeof item!=='string' || item.length>200 || ['__proto__','constructor','prototype'].includes(item))) throw new Error('أسماء الحقول غير صالحة');
    result['disabled'+key] = [...new Set(list)];
  }
  return result;
}

export function filterRequestFields(request, kind, value) {
  const options = request.fieldOptions || {};
  if (options[kind] === false) return kind === 'body' ? undefined : kind === 'query' ? '' : {};
  const disabled = new Set((options['disabled'+kind] || []).map(key=>kind==='headers'?key.toLowerCase():key));
  if (kind === 'query') {
    return [...new URLSearchParams(value || '')].filter(([key])=>!disabled.has(key)).map(([key,item])=>`${encodeURIComponent(key)}=${encodeURIComponent(item)}`).join('&');
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!disabled.has(kind==='headers'?key.toLowerCase():key)));
}

