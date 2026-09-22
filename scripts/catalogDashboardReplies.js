// Mechanical migration of message literals; interpolation expressions execute once.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'acorn';

const definitions = {};
for (const directory of ['commands', 'games', 'handlers', 'utils']) {
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.js'))) {
    if (directory === 'commands' && file === 'admin.js') continue; // Unused legacy file with pre-existing syntax errors.
    const filename = directory + '/' + file;
    let source = fs.readFileSync(filename, 'utf8');
    const edits = [];
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && node.callee.property?.name === 'sendMessage') {
        const object = node.arguments[1];
        const property = object?.type === 'ObjectExpression' && object.properties.find(p => p.key?.name === 'text');
        const value = property?.value;
        if (value && ((value.type === 'Literal' && typeof value.value === 'string') || value.type === 'TemplateLiteral')) {
          const original = source.slice(value.start, value.end);
          const fields = value.type === 'TemplateLiteral' ? value.expressions.map((_, i) => 'value' + (i + 1)) : [];
          const text = value.type === 'TemplateLiteral' ? value.quasis.map((q, i) => q.value.cooked + (i < fields.length ? '{' + fields[i] + '}' : '')).join('') : value.value;
          if (text.length <= 12000 && text.trim()) {
            const key = 'reply_' + crypto.createHash('sha256').update(filename + '\n' + original).digest('hex').slice(0, 16);
            definitions[key] = { title: text.replace(/\s+/g, ' ').slice(0, 100), file: filename, fields, required: fields, sample: text };
            const replacement = value.type === 'TemplateLiteral'
              ? `dashboardReply('${key}')${original}`
              : `dashboardReply('${key}')([${original}])`;
            edits.push({ start: value.start, end: value.end, replacement });
          }
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'start' || key === 'end') continue;
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
      }
    }
    walk(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
    if (edits.length) {
      for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
      source = `import { dashboardReply } from '../services/dashboardTemplates.js';\n` + source;
      fs.writeFileSync(filename, source);
    }
  }
}
const destination = 'services/dashboardReplyCatalog.json';
const existing = fs.existsSync(destination) ? JSON.parse(fs.readFileSync(destination, 'utf8')) : {};
fs.writeFileSync(destination, JSON.stringify({ ...existing, ...definitions }, null, 2) + '\n');
console.log(`Migrated ${Object.keys(definitions).length} message templates.`);
