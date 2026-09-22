import fs from 'node:fs';
import crypto from 'node:crypto';
import { parse } from 'acorn';

const destination='services/dashboardReplyCatalog.json';
const catalog=JSON.parse(fs.readFileSync(destination,'utf8'));
let count=0;
for(const directory of ['commands','games','handlers','utils']) for(const file of fs.readdirSync(directory).filter(f=>f.endsWith('.js')&&f!=='admin.js')) {
  const filename=directory+'/'+file;let source=fs.readFileSync(filename,'utf8');
  const root=parse(source,{ecmaVersion:'latest',sourceType:'module'}),records=[],bindings=new Map();
  function walk(node,scopes=[]) {
    if(!node||typeof node!=='object')return;
    const next=['Program','BlockStatement','ForStatement','ForOfStatement','ForInStatement'].includes(node.type)?[...scopes,node]:scopes;
    records.push({node,scopes:next});
    if(node.type==='VariableDeclarator'&&node.id.type==='Identifier')bindings.set(next.at(-1).start+':'+node.id.name,node);
    for(const value of Object.values(node)) {if(Array.isArray(value))value.forEach(child=>walk(child,next));else if(value&&typeof value==='object')walk(value,next);}
  }
  walk(root);
  const resolve=(name,scopes)=>scopes.slice().reverse().map(scope=>bindings.get(scope.start+':'+name)).find(Boolean);
  const targets=new Set();
  for(const{node,scopes}of records)if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.property.name==='sendMessage') {
    const argument=node.arguments[1];if(argument?.type!=='ObjectExpression')continue;
    for(const prop of argument.properties)if(['text','caption'].includes(prop.key?.name)&&prop.value?.type==='Identifier') {
      const declaration=resolve(prop.value.name,scopes);if(declaration)targets.add(declaration);
    }
  }
  const nodes=new Set([...targets].map(declaration=>declaration.init));
  for(const{node,scopes}of records)if(node.type==='AssignmentExpression'&&['=','+='].includes(node.operator)&&node.left.type==='Identifier'&&targets.has(resolve(node.left.name,scopes)))nodes.add(node.right);
  const edits=[];
  for(const node of nodes) {
    if(!node||!((node.type==='Literal'&&typeof node.value==='string')||node.type==='TemplateLiteral'))continue;
    const original=source.slice(node.start,node.end),fields=node.type==='TemplateLiteral'?node.expressions.map((_,i)=>'value'+(i+1)):[];
    const sample=node.type==='TemplateLiteral'?node.quasis.map((q,i)=>q.value.cooked+(i<fields.length?'{'+fields[i]+'}':'')).join(''):node.value;
    if(!sample.trim()||sample.length>12000)continue;
    const key='reply_'+crypto.createHash('sha256').update(filename+'\n'+original).digest('hex').slice(0,16);
    catalog[key]={title:sample.replace(/\s+/g,' ').slice(0,100),file:filename,fields,required:fields,sample};
    edits.push({start:node.start,end:node.end,text:node.type==='TemplateLiteral'?`dashboardReply('${key}')${original}`:`dashboardReply('${key}')([${original}])`});count++;
  }
  if(edits.length) {
    for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
    if(!source.includes("import { dashboardReply }"))source="import { dashboardReply } from '../services/dashboardTemplates.js';\n"+source;
    fs.writeFileSync(filename,source);
  }
}
fs.writeFileSync(destination,JSON.stringify(catalog,null,2)+'\n');console.log('Migrated composed message fragments:',count);
