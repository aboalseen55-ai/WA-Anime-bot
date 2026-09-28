import test from 'node:test';
import assert from 'node:assert/strict';
import BotControl from '../database/botControlModel.js';
import { setControlSnapshot, featureEnabled, outgoingAllowed, withBotContext, denyCommandIfPaused, saveBotControl, controlBlocked } from '../services/botControls.js';
import { filterRequestFields, validateRequestFields } from '../services/apiRequestFields.js';

test('pause precedence, independent output channels and expiry', async t => {
  t.after(()=>setControlSnapshot([]));
  setControlSnapshot([{key:'replies',enabled:false},{key:'automatic',enabled:true}]);
  assert.equal(await withBotContext('reply',async()=>outgoingAllowed()),false);
  assert.equal(await withBotContext('automatic',async()=>outgoingAllowed()),true);
  setControlSnapshot([{key:'bot',enabled:false},{key:'replies',enabled:true}]);
  assert.equal(featureEnabled('replies'),false);
  assert.equal(outgoingAllowed(),false);
  setControlSnapshot([{key:'bot',enabled:false,until:new Date(Date.now()-100)}]);
  assert.equal(featureEnabled('replies'),true);
});

test('command maintenance notices are throttled and scoped to chat and sender',async t=>{
  t.after(()=>setControlSnapshot([]));
  setControlSnapshot([{key:'command:/example',enabled:false,message:'صيانة'}]);
  const sent=[]; const sock={sendMessage:async(jid,payload)=>sent.push({jid,...payload})};
  assert.equal(await denyCommandIfPaused(sock,'chat','user','/example words'),true);
  await denyCommandIfPaused(sock,'chat','user','/example');
  await denyCommandIfPaused(sock,'other','user','/example');
  assert.equal(sent.length,2);
  assert.equal(sent[0].text,'صيانة');
  assert.equal(await denyCommandIfPaused(sock,'chat','user','/another'),false);
});

test('control writes become live only after persistence and reject stale revisions',async t=>{
  t.after(()=>setControlSnapshot([]));
  setControlSnapshot([]);
  t.mock.method(BotControl,'findOneAndUpdate',(query,update)=>({lean:async()=>({key:query.key,...update.$set,revision:1,history:update.$push.history.$each})}));
  const saved=await saveBotControl('bot',{enabled:false,minutes:10,reason:'repair'});
  assert.equal(saved.history[0].reason,'repair');
  assert.ok(saved.until>Date.now());
  assert.equal(featureEnabled('replies'),false);
  t.mock.method(BotControl,'findOneAndUpdate',()=>({lean:async()=>null}));
  await assert.rejects(saveBotControl('bot',{enabled:true,revision:1}),/تغيرت/);
  assert.ok(controlBlocked('bot'));
});

test('request blocks omit disabled values without destroying stored values',()=>{
  const fields=validateRequestFields({disabledheaders:['Authorization'],disabledbody:['secret'],disabledquery:['page']});
  const request={fieldOptions:fields};
  const headers={authorization:'token',Accept:'application/json'};
  assert.deepEqual(filterRequestFields(request,'headers',headers),{Accept:'application/json'});
  assert.equal(headers.authorization,'token');
  assert.deepEqual(filterRequestFields(request,'body',{secret:1,query:'hello'}),{query:'hello'});
  assert.equal(new URLSearchParams(filterRequestFields(request,'query','q={query}&page=1')).get('q'),'{query}');
  assert.equal(new URLSearchParams(filterRequestFields(request,'query','q={query}&page=1')).has('page'),false);
  assert.equal(filterRequestFields({fieldOptions:{body:false}},'body',{query:1}),undefined);
  assert.throws(()=>validateRequestFields({disabledheaders:['__proto__']}));
});

