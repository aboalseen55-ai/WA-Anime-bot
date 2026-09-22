import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createDashboardHandler, validateApi, validateCommand, readJson } from '../services/dashboardServer.js';
import { isPublicAddress, validateEndpoint } from '../services/dashboardApiSafety.js';
import { validateKingdom, escapeRegex, catalog, dashboardWrite, dashboardRead } from '../services/dashboardData.js';
import { TEMPLATE_DEFINITIONS, validateTemplate, dashboardReply, refreshDashboardTemplates, renderBotTemplate } from '../services/dashboardTemplates.js';
import Template from '../database/dashboardTemplateModel.js';
import Command from '../database/dashboardCommandModel.js';
import Api from '../database/dashboardApiModel.js';
import Audit from '../database/kingdomAuditLogModel.js';
import Kingdom from '../database/kingdomModel.js';
import User from '../database/userModel.js';
import { decryptDashboardValue } from '../services/dashboardCrypto.js';
import { handleDashboardCommand } from '../services/dashboardRuntime.js';

test('custom text commands without a service send the personalized reply', async t => {
  t.mock.method(Command, 'findOne', () => ({ populate: async () => ({
    trigger: '/custom_text_test', permission: 'everyone', apiId: null,
    responseTemplate: 'Hello {name}', responsePath: ''
  }) }));
  const sent = [];
  const handled = await handleDashboardCommand({ sendMessage: async (jid, content) => sent.push({ jid, content }) },
    '123@s.whatsapp.net', '123@s.whatsapp.net', '/custom_text_test', { pushName: 'Sam' });
  assert.equal(handled, true);
  assert.deepEqual(sent, [{ jid: '123@s.whatsapp.net', content: { text: 'Hello Sam' } }]);
});

const chain = value => { const result={lean:async()=>value};for(const key of ['sort','limit','select','skip'])result[key]=()=>result;return result; };

test('catalog includes original commands and migrated replies',()=>{
  assert.ok(catalog.length>100);assert.ok(Object.keys(TEMPLATE_DEFINITIONS).length>=493);
  assert.ok(catalog.some(row=>row.command==='/مافيا'));
  for(const [key,definition] of Object.entries(TEMPLATE_DEFINITIONS))assert.equal(validateTemplate(key,definition.sample),definition.sample);
});
test('template edits preserve placeholders and single interpolation evaluation',async t=>{
  t.mock.method(Template,'find',()=>chain([{key:'welcome',text:'{nickname} {mention}'},{key:'test',text:'Hi {value1}'}]));
  await refreshDashboardTemplates();
  assert.equal(renderBotTemplate('welcome',{nickname:'S',mention:'@123'},'original'),'S @123');
  assert.equal(dashboardReply('unknown')(['a','b','c'],null,3),'anullb3c');
  let count=0;assert.equal(dashboardReply('test')`before ${++count}`,'Hi 1');assert.equal(count,1);
  assert.throws(()=>validateTemplate('welcome','hello'),/mention/);
  assert.throws(()=>validateTemplate('promotion','{mention} {oldRank} {newRank} {evil}'),/evil/);
  t.mock.method(Template,'find',()=>chain([]));await refreshDashboardTemplates();
  assert.equal(renderBotTemplate('welcome',{},'original'),'original');
});
test('custom commands cannot shadow originals or access prototypes',()=>{
  assert.throws(()=>validateCommand({trigger:'/مافيا',title:'x',permission:'everyone'}));
  assert.throws(()=>validateCommand({trigger:'/new_custom_test',title:'x',permission:'everyone',responsePath:'__proto__.x'}));
  assert.equal(validateCommand({trigger:'/new_custom_test',title:'x',permission:'developer'}).permission,'developer');
});
test('API edits preserve omitted secrets and reject private destinations',()=>{
  const result=validateApi({name:'demo',endpoint:'https://example.com/',method:'GET',responseType:'video_url',queryTemplate:'q={query}'});
  assert.equal(result.responseType,'video_url');assert.equal(result.queryTemplate,'q={query}');
  assert.ok(!Object.hasOwn(result,'encryptedHeaders'));assert.ok(!Object.hasOwn(result,'encryptedBody'));
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1'])assert.equal(isPublicAddress(ip),false,ip);
  assert.equal(isPublicAddress('8.8.8.8'),true);
  for(const url of ['http://example.com','https://localhost','https://user:pass@example.com','https://example.com:444','https://127.0.0.1'])assert.throws(()=>validateEndpoint(url));
});
test('kingdom data validates group roles, links, admins and timezone',()=>{
  const input={name:'Test',mainGroup:'123@g.us',admins:'123@lid',timeZone:'Asia/Amman'};
  assert.deepEqual(validateKingdom(input).groupIds,['123@g.us']);
  assert.throws(()=>validateKingdom({...input,receptionGroup:'123@g.us'}));
  assert.throws(()=>validateKingdom({...input,announcementLink:'https://example.com'}));
  assert.throws(()=>validateKingdom({...input,timeZone:'bad-zone'}));
  assert.equal(new RegExp('^'+escapeRegex('.*[x]')+'$').test('.*[x]'),true);
});
test('JSON reader validates bodies and byte-size limits',async()=>{
  assert.deepEqual(await readJson(Readable.from([Buffer.from('{"ok":true}') ])),{ok:true});
  await assert.rejects(readJson(Readable.from([Buffer.from('[]')])));
  await assert.rejects(readJson(Readable.from([Buffer.alloc(120001,97)])));
});
test('secrets are encrypted only when explicitly supplied',t=>{
  const previous=process.env.DASHBOARD_ENCRYPTION_KEY;process.env.DASHBOARD_ENCRYPTION_KEY='isolated-test-key';
  t.after(()=>{if(previous===undefined)delete process.env.DASHBOARD_ENCRYPTION_KEY;else process.env.DASHBOARD_ENCRYPTION_KEY=previous});
  const value=validateApi({name:'test',endpoint:'https://example.com',method:'GET',headers:{Authorization:'test-secret'}});
  assert.ok(!Object.hasOwn(value,'headers'));assert.ok(!value.encryptedHeaders.includes('test-secret'));
  assert.deepEqual(decryptDashboardValue(value.encryptedHeaders),{Authorization:'test-secret'});
});
test('member queries and writes stay within the selected kingdom',async t=>{
  let filter;
  t.mock.method(Kingdom,'exists',async()=>({_id:'k'}));
  t.mock.method(User,'find',query=>{filter=query;return chain([])});
  t.mock.method(User,'countDocuments',async()=>0);
  await dashboardRead(new URL('http://test/dashboard/api/members?kingdom=demo&q=a.*'));
  assert.equal(filter.kingdom_id,'demo');assert.equal(filter.$or[0].nickname.$regex,'a\\.\\*');
  t.mock.method(User,'findOne',async query=>{filter=query;return null});
  await assert.rejects(dashboardWrite('members/aaaaaaaaaaaaaaaaaaaaaaaa','PUT',{kingdom:'other'}));
  assert.deepEqual(filter,{_id:'aaaaaaaaaaaaaaaaaaaaaaaa',kingdom_id:'other'});
});
test('kingdom updates reject stale edits and deletion needs exact confirmation',async t=>{
  const current={id:'demo',name:'Demo',mainGroup:'123@g.us',admins:['123@lid'],groupIds:['123@g.us']};
  t.mock.method(Kingdom,'findOne',()=>chain(current));
  t.mock.method(Kingdom,'exists',async()=>null);
  t.mock.method(Kingdom,'updateOne',async()=>({matchedCount:0}));
  await assert.rejects(dashboardWrite('kingdoms/demo','PUT',{...current,updatedAt:'old'}),/تغيّرت/);
  await assert.rejects(dashboardWrite('kingdoms/demo','DELETE',{confirm:'wrong'}),/تأكيد/);
});
test('HTTP authentication, CSRF, templates, assets and disconnected gate',async t=>{
  let connected=true;let stored=[];
  t.mock.method(Command,'find',()=>chain([]));t.mock.method(Api,'find',()=>chain([]));
  t.mock.method(Template,'find',()=>chain(stored));
  t.mock.method(Template,'updateOne',async({key},update)=>{stored=[{key,text:update.$set.text}];return{matchedCount:1}});
  t.mock.method(Template,'deleteOne',async()=>{stored=[];return{deletedCount:1}});
  t.mock.method(Audit,'create',async value=>value);
  const server=http.createServer(createDashboardHandler({getBotStatus:()=>({connected}),password:'fixture-password'}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port+'/dashboard';
  assert.equal((await fetch(base+'/api/state')).status,401);
  const page=await fetch(base);assert.equal(page.status,200);assert.ok((await page.text()).includes('loginForm'));
  for(const asset of ['app.js','style.css','icons.js'])assert.equal((await fetch(base+'/'+asset)).status,200);
  const wrong=await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({password:'wrong'})});assert.equal(wrong.status,401);
  const login=await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({password:'fixture-password'})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];const{csrf}=await login.json();
  assert.match(login.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await fetch(base+'/api/templates/welcome',{method:'PUT',headers:{cookie},body:JSON.stringify({text:'Hi {mention}'})})).status,403);
  const headers={cookie,'x-dashboard-csrf':csrf};
  assert.equal((await fetch(base+'/api/templates/welcome',{method:'PUT',headers,body:JSON.stringify({text:'Hi {mention}'})})).status,200);
  assert.equal(renderBotTemplate('welcome',{mention:'@123'},'original'),'Hi @123');
  assert.equal((await fetch(base+'/api/templates/welcome',{method:'DELETE',headers})).status,200);
  assert.equal(renderBotTemplate('welcome',{},'original'),'original');
  assert.equal((await fetch(base+'/api/state',{headers})).status,200);
  connected=false;assert.equal((await fetch(base+'/api/state',{headers})).status,503);
  connected=true;await fetch(base+'/api/logout',{method:'POST',headers});assert.equal((await fetch(base+'/api/state',{headers})).status,401);
});
