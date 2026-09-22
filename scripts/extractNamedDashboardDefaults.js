import fs from 'node:fs';
import { parse } from 'acorn';
const source = fs.readFileSync('commands/adminSystem.js','utf8');
const ast = parse(source,{ecmaVersion:'latest',sourceType:'module'});
const declarations = new Map(), calls = [];
function walk(node) {
  if(!node || typeof node!=='object') return;
  if(node.type==='VariableDeclarator' && node.id.name==='promotionMessage') declarations.set('promotionMessage',node.init);
  if(node.type==='CallExpression' && node.callee.name==='renderBotTemplate') calls.push(node);
  for(const value of Object.values(node)) { if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value); }
}
walk(ast);
const defaults={};
for(const node of calls) {
  const key=node.arguments[0].value;
  const values=node.arguments[1];
  const template=node.arguments[2].type==='Identifier'?declarations.get(node.arguments[2].name):node.arguments[2];
  const expressions=new Map(values.properties.map(p=>[source.slice(p.value.start,p.value.end),p.key.name]));
  const names=template.expressions.map(expression=>expressions.get(source.slice(expression.start,expression.end)));
  if(names.some(name=>!name))throw Error('Unmapped interpolation in '+key);
  defaults[key]=template.quasis.map((part,index)=>part.value.cooked+(index<names.length?'{'+names[index]+'}':'')).join('');
}
fs.writeFileSync('services/dashboardNamedDefaults.json',JSON.stringify(defaults,null,2)+'\n');
console.log('Extracted original named templates:',Object.keys(defaults).length);
