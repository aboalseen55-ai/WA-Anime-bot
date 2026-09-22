import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from 'acorn';
import assert from 'node:assert/strict';
const reference=process.argv[2]||'a277aa0';
function normalize(node) {
  if(Array.isArray(node))return node.filter(item=>!(item?.type==='ImportDeclaration'&&item.source.value.endsWith('/dashboardTemplates.js'))).map(normalize);
  if(!node||typeof node!=='object')return node;
  if(node.type==='TaggedTemplateExpression'&&node.tag.type==='CallExpression'&&node.tag.callee.name==='dashboardReply')return normalize(node.quasi);
  if(node.type==='CallExpression'&&node.callee.type==='CallExpression'&&node.callee.callee.name==='dashboardReply')return normalize(node.arguments[0].elements[0]);
  if(node.type==='CallExpression'&&node.callee.name==='renderBotTemplate')return normalize(node.arguments[2]);
  return Object.fromEntries(Object.entries(node).filter(([key])=>!['start','end','raw'].includes(key)).map(([key,value])=>[key,normalize(value)]));
}
let verified=0;
for(const directory of ['commands','games','handlers','utils'])for(const file of fs.readdirSync(directory).filter(f=>f.endsWith('.js'))) {
  const name=directory+'/'+file,source=fs.readFileSync(name,'utf8');if(!source.includes("import { dashboardReply }"))continue;
  const baseline=execFileSync('git',['show',reference+':'+name],{encoding:'utf8',maxBuffer:10*1024*1024});
  try{assert.deepEqual(normalize(parse(source,{ecmaVersion:'latest',sourceType:'module'})),normalize(parse(baseline,{ecmaVersion:'latest',sourceType:'module'})));}
  catch(error){console.error('Migration changed non-template behavior:',name);throw error;}
  verified++;
}
console.log('Verified original logic and interpolation preserved in',verified,'files.');
