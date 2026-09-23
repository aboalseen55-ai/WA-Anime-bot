'use strict';
const $ = id => document.getElementById(id);
const labels = { overview:'نظرة عامة', commands:'الأوامر والردود', kingdoms:'الممالك', members:'الأعضاء', reports:'إنجازات الإدارة', games:'الألعاب', banks:'البنوك', services:'الخدمات', usage:'استهلاك الذكاء', audit:'سجل التغييرات' };
const icons = {overview:'layout-dashboard',commands:'message-square-text',kingdoms:'crown',members:'users',reports:'chart-no-axes-combined',games:'gamepad-2',banks:'landmark',services:'plug',usage:'sparkles',audit:'history'};
const roleNames = {member:'عضو',moderator:'مشرف',admin:'أدمن',super_admin:'أدمن رئيسي',everyone:'الجميع',developer:'المطور'};
let csrf='', state={commands:[],apis:[]}, kingdoms=[], templates=[], catalog=[], section='overview', tab='builtin', page=1, query='', version=0, saveAction=null, toastTimer;
const e = (tag, text, className) => { const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(className)node.className=className; return node; };
const icon = name => { const node=e('i');node.dataset.lucide=name;return node; };
const paintIcons = () => window.lucide?.createIcons();
const number = value => Number(value||0).toLocaleString('ar-JO');
const date = value => value?new Date(value).toLocaleString('ar-JO'):'—';
function button(text, name, handler, className='secondary') { const node=e('button',undefined,className);node.type='button';if(name)node.append(icon(name));if(text)node.append(e('span',text));node.addEventListener('click',()=>Promise.resolve(handler()).catch(showError));return node; }
function action(name,title,handler) { const node=button('',name,handler,'icon-button');node.title=title;node.setAttribute('aria-label',title);return node; }
function toast(message) { $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000); }
function showError(error) { toast(error.message||'تعذر إكمال الطلب'); }
async function request(path,method='GET',body) {
  const response=await fetch('/dashboard/api/'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Dashboard-CSRF':csrf},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));
  if(response.status===401&&path!=='login') { $('app').hidden=true;$('login').hidden=false;csrf=''; }
  if(!response.ok)throw Error(data.error||'تعذر الاتصال بالخادم');return data;
}
function scoped(route) { return route+'?'+new URLSearchParams({kingdom:$('scope').value,page:String(page),q:query}); }
async function bootstrap() {
  state=await request('state');csrf=state.csrf;
  kingdoms=(await request('kingdoms')).kingdoms;
  const selected=$('scope').value;$('scope').replaceChildren(new Option('جميع الممالك',''));
  kingdoms.forEach(k=>$('scope').add(new Option(k.name,k.id)));$('scope').value=kingdoms.some(k=>k.id===selected)?selected:'';
  $('login').hidden=true;$('app').hidden=false;$('password').value='';
  await load();
}
function heading(title,subtitle='') { const row=e('div',undefined,'section-heading'),text=e('div');text.append(e('h2',title));if(subtitle)text.append(e('p',subtitle));row.append(text);return row; }
function empty(text) { const node=e('div',undefined,'empty');node.append(icon('inbox'),e('p',text));return node; }
function table(headers,rows) {
  const wrap=e('div',undefined,'table-wrap'),node=e('table'),head=e('thead'),tr=e('tr');headers.forEach(h=>tr.append(e('th',h)));head.append(tr);node.append(head);
  const body=e('tbody');rows.forEach(row=>{const tr=e('tr');row.forEach(value=>{const td=e('td');if(value instanceof Node)td.append(value);else td.textContent=value??'—';tr.append(td)});body.append(tr)});node.append(body);wrap.append(node);return rows.length?wrap:empty('لا توجد بيانات لعرضها');
}
function pager(total,onChange=load,size=30) { const node=e('div',undefined,'pagination');const prev=action('chevron-right','الصفحة السابقة',()=>{page--;return onChange()}),next=action('chevron-left','الصفحة التالية',()=>{page++;return onChange()});prev.disabled=page<=1;next.disabled=page*size>=total;node.append(prev,e('span',`${number(page)} / ${number(Math.max(1,Math.ceil(total/size)))} · ${number(total)} نتيجة`),next);return node; }
function searchBar(placeholder,onSearch) { const wrap=e('div',undefined,'toolbar'),input=e('input',undefined,'search');input.type='search';input.placeholder=placeholder;input.setAttribute('aria-label',placeholder);input.value=query;let timer;input.addEventListener('input',()=>{query=input.value;page=1;clearTimeout(timer);timer=setTimeout(onSearch,250)});wrap.append(input);return wrap; }
function rowsActions(items) { const node=e('div',undefined,'row-actions');items.forEach(item=>node.append(action(...item)));return node; }
function sourceLabel(file){if(!file)return 'النماذج الأساسية';if(file.startsWith('games/'))return 'الألعاب';if(file.includes('kingdom'))return 'الممالك';if(file.includes('admin'))return 'إدارة الأعضاء';if(file.includes('user'))return 'خدمات الأعضاء';if(file.includes('quran'))return 'القرآن';if(file.includes('Report'))return 'التقارير';if(file.includes('commandsList')||file.includes('CommandGuide')||file.includes('dynamicCommands'))return 'القوائم';return 'ردود البوت';}

async function load() {
  const token=++version;const root=$('content');root.replaceChildren(e('p','جارٍ تحميل البيانات…','loading'));
  $('pageTitle').textContent=labels[section];document.querySelectorAll('.nav-link').forEach(a=>{a.classList.toggle('active',a.dataset.section===section);if(a.dataset.section===section)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  $('scope').hidden=['commands','services','usage'].includes(section);
  try {
    let render;
    if(section==='overview') {const data=await request(scoped('overview'));render=()=>overview(data);}
    else if(section==='commands') {if(!catalog.length)catalog=(await request('catalog')).commands;if(!templates.length)templates=(await request('templates')).templates;render=commands;}
    else if(section==='kingdoms') {kingdoms=(await request('kingdoms')).kingdoms;render=kingdomList;}
    else if(section==='members') {const data=await request(scoped('members'));render=()=>members(data);}
    else if(section==='services') render=services;
    else {const data=await request(scoped(section));render=()=>dataList(data);}
    if(token!==version)return;root.replaceChildren();render();$('updated').textContent='آخر تحديث '+new Date().toLocaleTimeString('ar-JO');paintIcons();
  } catch(error) {if(token!==version)return;root.replaceChildren(e('p',error.message,'error-state'),button('إعادة المحاولة','refresh-cw',load));paintIcons();}
}
function overview(data) {
  const root=$('content'),stats=e('div',undefined,'metrics');
  [['الممالك',data.totals.kingdoms],['الأعضاء المسجّلون',data.totals.members],['الرسائل اليومية الحالية',data.totals.dailyMessages],['إجابات الألعاب اليومية',data.totals.answers]].forEach(([title,value])=>{const item=e('div',undefined,'metric');item.append(e('span',title),e('strong',number(value)));stats.append(item)});
  root.append(stats);const split=e('div',undefined,'split'),activity=e('section',undefined,'band'),games=e('section',undefined,'band');
  activity.append(heading('الأكثر تفاعلًا','العدّادات الحالية منذ آخر تصفير يومي'),table(['العضو','الرسائل','المستوى'],data.top.map(u=>[u.nickname,number(u.dailyMessages),number(u.level)])));
  games.append(heading('متصدّرو الألعاب'),table(['العضو','الإجابات','XP الألعاب'],data.games.map(u=>[u.nickname,number(u.dailyGameAnswers),number(u.dailyGameXp)])));split.append(activity,games);root.append(split);
  root.append(heading('ملخص النشاط'),table(['الرسائل الكلية','XP الكلي','الاستقبال اليومي','نجوم اليوم'],[[number(data.totals.messages),number(data.totals.xp),number(data.totals.welcomes),number(data.totals.stars)]]));
}
function commands() {
  const root=$('content'),tabs=e('div',undefined,'tabs');[['builtin','الأوامر الأصلية'],['replies','الردود والقوالب'],['custom','أوامري المضافة']].forEach(([id,label])=>tabs.append(button(label,null,()=>{tab=id;query='';page=1;commandsReset()},id===tab?'active':'')));root.append(tabs);
  const area=e('div');root.append(area);
  const bar=searchBar('ابحث عن أمر أو رد',()=>renderList());if(tab==='custom')bar.append(button('إضافة أمر','plus',()=>editCommand(),'primary'));area.append(bar);const results=e('div');area.append(results);
  function renderList() {
    results.replaceChildren();const source=tab==='builtin'?catalog:tab==='replies'?templates:state.commands;
    const list=source.filter(row=>JSON.stringify([row.command,row.title,row.description,row.text,row.trigger,row.file]).toLowerCase().includes(query.toLowerCase()));
    const visible=list.slice((page-1)*30,page*30);
    if(tab==='builtin') {const items=e('div',undefined,'command-list');visible.forEach(row=>{const item=e('div',undefined,'command');item.append(e('h3',row.command),e('p',row.description),e('small',row.usage));items.append(item)});results.append(list.length?items:empty('لا توجد أوامر مطابقة'));}
    if(tab==='replies') results.append(table(['الرد','القسم','الحالة',''],visible.map(row=>{const title=e('span',row.title);title.title=row.text;return [title,sourceLabel(row.file),row.customized?'معدّل':'الأصلي',rowsActions([['pencil','تعديل الرد',()=>editTemplate(row)]])]})));
    if(tab==='custom')results.append(table(['الأمر','الاسم','الصلاحية','الحالة',''],visible.map(row=>[row.trigger,row.title,roleNames[row.permission],row.enabled?'مفعّل':'متوقف',rowsActions([['pencil','تعديل الأمر',()=>editCommand(row)],['trash-2','حذف الأمر',()=>remove('commands/'+row._id,row.title)]])])));
    results.append(pager(list.length,renderList));paintIcons();
  }
  renderList();
}
function commandsReset(){ $('content').replaceChildren();commands();paintIcons(); }
function kingdomList() {
  const root=$('content'),title=heading('الممالك المسجّلة',number(kingdoms.length)+' مملكة');title.append(button('إضافة مملكة','plus',()=>editKingdom(),'primary'));root.append(title);
  const grid=e('div',undefined,'kingdom-grid');kingdoms.filter(k=>!$('scope').value||k.id===$('scope').value).forEach(k=>{
    const item=e('article',undefined,'kingdom-item');item.append(e('span',k.isActive?'نشطة':'متوقفة',k.isActive?'pill':'pill off'),e('h2',k.name),e('p',k.timeZone||'Asia/Amman'),e('p','الإدارة: '+(k.adminGroup?'مرتبطة':'غير مرتبطة')+' · الاستقبال: '+(k.receptionGroup?'مرتبط':'غير مرتبط')));
    const actions=e('div',undefined,'row-actions');actions.append(button('الأعضاء','users',()=>{$('scope').value=k.id;navigate('members')}),button('تعديل','settings-2',()=>editKingdom(k)));item.append(actions);grid.append(item);
  });root.append(grid.children.length?grid:empty('لا توجد ممالك مسجّلة'));
}
function members(data) {
  const root=$('content');if(!$('scope').value){root.append(empty('اختر مملكة من القائمة بالأعلى لعرض أعضائها'));return;}
  const title=heading('أعضاء المملكة',number(data.total)+' عضو'),results=e('div');let pending=0;
  root.append(title,searchBar('ابحث باللقب أو اسم واتساب',async()=>{
    const token=++pending;
    try { const next=await request(scoped('members'));if(token!==pending||!results.isConnected)return;data=next;draw();paintIcons(); } catch(error){showError(error)}
  }),results);
  function draw(){results.replaceChildren(table(['العضو','الصلاحية','المستوى','XP','النجوم','الحالة',''],data.users.map(u=>[u.nickname,roleNames[u.role],number(u.level),number(u.xp),number(u.rankStarsByKingdom?.[u.kingdom_id]),u.isBanned?'محظور':'نشط',rowsActions([['contact','تفاصيل العضو',()=>editMember(u)]])])),pager(data.total));title.querySelector('p').textContent=number(data.total)+' عضو';}
  draw();
}
function services() {
  const root=$('content'),title=heading('الخدمات المرتبطة',state.encryptionReady?'المفاتيح محفوظة بتشفير':'أضف مفتاح التشفير في إعدادات الخادم أولًا');title.append(button('إضافة خدمة','plus',()=>editApi(),'primary'));root.append(title);
  root.append(table(['الخدمة','الطريقة','الحالة',''],state.apis.map(api=>[api.name,api.method,api.enabled?'مفعّلة':'متوقفة',rowsActions([['pencil','تعديل الخدمة',()=>editApi(api)],['trash-2','حذف الخدمة',()=>remove('apis/'+api._id,api.name)]])])));
}
function dataList(data) {
  const root=$('content');
  if(section==='usage')root.append(heading('استهلاك الذكاء الاصطناعي','إجمالي البوت؛ لا تُقسّم سجلات الاستخدام الحالية حسب المملكة'),table(['اليوم','النموذج','الطلبات','الناجحة','الفاشلة','Input','Output','Tokens'],data.rows.map(r=>[r.dateKey,r.model,number(r.requests),number(r.successfulRequests),number(r.failedRequests),number(r.promptTokens),number(r.completionTokens),number(r.totalTokens)])));
  if(section==='audit')root.append(heading('سجل التغييرات'),table(['التاريخ','العملية','بواسطة','المملكة'],data.rows.map(r=>[date(r.createdAt),auditLabel(r.action),r.actorJid==='dashboard:owner'?'مالك اللوحة':r.actorJid,kingdoms.find(k=>k.id===r.kingdomId)?.name||r.kingdomId||'عام'])));
  if(section==='games') {const names={collecting_players:'تسجيل اللاعبين',collecting_config:'إعداد الجولة',roles_distributed:'جولة جارية',game_over:'انتهت الجولة',closed:'مغلقة'};root.append(heading('جلسات المافيا','الجلسات المحفوظة فقط؛ لا يتم عرض أدوار اللاعبين السرية'),table(['المضيف','الحالة','المجموعة','آخر تحديث'],data.rows.map(r=>[r.hostNickname||'—',names[r.status]||r.status,r.groupId,date(r.updatedAt)])),heading('الفعاليات المسجّلة','آخر جلسات الألعاب المتوفرة'),table(['المشرف','اللعبة','البداية','النهاية'],(data.sessions||[]).map(r=>[r.nickname,r.session.gameName,date(r.session.startTime),date(r.session.endTime)])));}
  if(section==='reports')root.append(heading('إنجازات الإدارة','العدّادات اليومية الحالية للأعضاء ذوي الصلاحيات الإدارية'),table(['الأدمن','استقبال','رسائل','فعاليات','إجابات ألعاب','XP الكلي','نجوم اليوم',''],data.rows.map(r=>[r.nickname,number(r.dailyWelcomes),number(r.dailyMessages),number(r.sessionCount),number(r.dailyGameAnswers),number(r.xp),number(r.dailyRankStarsEarned),rowsActions([['file-text','معاينة التقرير',()=>{openEditor('تقرير '+r.nickname,[e('div',r.report||'لا يوجد تقرير لهذا العضو اليوم','preview')],async()=>{});$('saveEditor').hidden=true;}]])])));
  if(section==='banks') {root.append(heading('بنوك الممالك'),table(['المملكة','الرصيد'],data.banks.map(b=>[kingdoms.find(k=>k.id===b.kingdom)?.name||b.kingdom,number(b.totalCoins)])),heading('سجل العمليات'),table(['النوع','القيمة','التاريخ','المملكة'],data.rows.map(r=>[({deposit:'إيداع',withdraw:'سحب',transfer:'تحويل'})[r.transaction.type]||r.transaction.type,number(r.transaction.amount),date(r.transaction.timestamp),kingdoms.find(k=>k.id===r.kingdom)?.name||r.kingdom])));}
  root.append(pager(data.total));
}
function auditLabel(value){return ({dashboard_template_updated:'تعديل رد',dashboard_template_restored:'استرجاع الرد الأصلي',dashboard_kingdom_updated:'تعديل مملكة',dashboard_kingdom_created:'إضافة مملكة',dashboard_member_updated:'تعديل عضو',kingdom_deleted:'حذف مملكة',kingdom_created:'إنشاء مملكة',dashboard_commands_post:'إضافة أمر',dashboard_commands_put:'تعديل أمر',dashboard_commands_delete:'حذف أمر',dashboard_apis_post:'إضافة خدمة',dashboard_apis_put:'تعديل خدمة',dashboard_apis_delete:'حذف خدمة'})[value]||value;}

function field(name,label,value='',type='text',options) {
  const wrap=e('div',undefined,'form-field'+(type==='textarea'?' full':'')),id='field_'+name;
  let control;
  if(type==='select'){control=e('select');options.forEach(([key,text])=>control.add(new Option(text,key)));}
  else {control=e(type==='textarea'?'textarea':'input');if(type!=='textarea')control.type=type;}
  control.id=id;control.name=name;
  if(type==='checkbox')control.checked=Boolean(value);else control.value=value??'';
  const title=e('label',label);title.htmlFor=id;
  if(type==='checkbox'){title.className='checkbox-label';title.prepend(control);wrap.append(title);}else wrap.append(title,control);
  return wrap;
}
function openEditor(title,fields,save) { $('editorTitle').textContent=title;$('editorError').textContent='';$('saveEditor').hidden=false;$('editorFields').replaceChildren(...fields);saveAction=save;$('editor').showModal();paintIcons(); }
function values() {const data=Object.fromEntries(new FormData($('editorForm')));$('editorFields').querySelectorAll('input[type=checkbox]').forEach(input=>data[input.name]=input.checked);return data;}
async function saved(){ $('editor').close();toast('تم حفظ التغييرات');await bootstrap(); }
async function remove(path,name,body={}) {
  openEditor('حذف '+name,[e('p','هل تريد حذف هذا العنصر؟ لا يمكن التراجع عن الحذف.')],async()=>{await request(path,'DELETE',body);await saved()});
}
function editCommand(row={}) {
  const grid=e('div',undefined,'form-grid');grid.append(field('trigger','الأمر',row.trigger),field('title','الاسم',row.title),field('responseTemplate','الرد',row.responseTemplate,'textarea'),field('permission','متاح لـ',row.permission||'everyone','select',[['everyone','الجميع'],['moderator','المشرفين'],['developer','المطور فقط']]),field('apiId','الخدمة',row.apiId||'','select',[['','بدون خدمة'],...state.apis.map(a=>[a._id,a.name])]),field('responsePath','مسار النتيجة',row.responsePath),field('enabled','مفعّل',row.enabled!==false,'checkbox'));
  openEditor(row._id?'تعديل الأمر':'إضافة أمر',[grid,e('p','المتغيرات: {name} اسم المرسل، {api} نتيجة الخدمة','help')],async()=>{await request('commands'+(row._id?'/'+row._id:''),row._id?'PUT':'POST',values());await saved()});
}
function editApi(row={}) {
  const grid=e('div',undefined,'form-grid');
  const typeValue = row.type || 'api';
  grid.append(field('name','اسم الخدمة',row.name),field('type','نوع الخدمة',typeValue,'select',[['api','Normal Service'],['series','Series Service']]),field('endpoint','رابط HTTPS — يدعم {query}',row.endpoint,'url'),field('queryTemplate','معاملات GET — مثال: q={query}&page=1',row.queryTemplate),field('method','طريقة الطلب',row.method||'GET','select',[['GET','GET'],['POST','POST']]),field('responseType','نوع النتيجة',row.responseType||'text','select',[['text','نص / JSON'],['image_url','رابط صورة داخل JSON'],['image','ملف صورة مباشر'],['video_url','رابط فيديو داخل JSON'],['video','ملف فيديو مباشر'],['audio_url','رابط صوت داخل JSON'],['audio','ملف صوت مباشر']]),field('timeoutMs','مهلة الطلب بالمللي ثانية',row.timeoutMs||12000,'number'),field('enabled','مفعّلة',row.enabled!==false,'checkbox'));
  const headerField=field('headers','Headers (JSON)','','textarea'),bodyField=field('body','Body (JSON)','','textarea');
  headerField.querySelector('textarea').placeholder=row.hasHeaders?'محفوظة ومشفّرة ✓ — اترك الحقل فارغًا للاحتفاظ بها':'مثال: {"Authorization":"Bearer ..."}';
  bodyField.querySelector('textarea').placeholder=row.hasBody?'محفوظ ومشفّر ✓ — اترك الحقل فارغًا للاحتفاظ به':'مثال: {"query":"{query}"}';
  const advanced=e('details');advanced.append(e('summary','الإعدادات المتقدمة'),e('p',row.hasHeaders||row.hasBody?'المفاتيح الحالية محفوظة ومشفّرة. اترك الحقل فارغًا للاحتفاظ بها، أو اكتب JSON جديدًا لاستبدالها. لفراغها نهائيًا اكتب {}.':'أضف Headers أو Body بصيغة JSON. ستُحفظ القيم الحساسة مشفّرة.','help'),headerField,bodyField);
  const testQuery=field('testQuery','قيمة اختبار', 'test'), testPath=field('testPath','مسار النتيجة (اختياري)','data.url'), testOutput=e('pre',undefined,'preview');
  const test=button('اختبار الخدمة','play',async()=>{test.disabled=true;testOutput.textContent='جارٍ اختبار الطلب...';try{const v=values();v.timeoutMs=Number(v.timeoutMs);for(const key of ['headers','body']){if(!v[key].trim())delete v[key];else {try{v[key]=JSON.parse(v[key])}catch{throw Error('تحقق من صيغة '+key)}}}const result=await request('apis/test','POST',{...v,apiId:row._id,testQuery:document.getElementById('field_testQuery').value,testPath:document.getElementById('field_testPath').value});testOutput.textContent='نجح الطلب ✓\n'+JSON.stringify(result,null,2);}catch(error){testOutput.textContent='فشل الطلب ✕\n'+error.message;}finally{test.disabled=false;}});
  // Series-specific fields
  const seriesSection=e('div');
  seriesSection.style.display = typeValue === 'series' ? 'block' : 'none';
  seriesSection.append(e('h3','Series Service configuration'));
  seriesSection.append(field('series_general_resultLimit','Result limit',row.seriesConfig?.general?.resultLimit||6,'number'));
  seriesSection.append(field('series_general_targetQuality','Target quality',row.seriesConfig?.general?.targetQuality||'480'));
  seriesSection.append(e('h4','Search Request'));
  seriesSection.append(field('series_search_endpoint','Search Endpoint',row.seriesConfig?.searchRequest?.endpoint||row.endpoint||'','url'));
  seriesSection.append(field('series_search_queryTemplate','Search Query Template',row.seriesConfig?.searchRequest?.queryTemplate||'','text'));
  seriesSection.append(field('series_search_method','Search Method',row.seriesConfig?.searchRequest?.method||'GET','select',[['GET','GET'],['POST','POST']]));
  seriesSection.append(field('series_search_timeoutMs','Search timeout (ms)',row.seriesConfig?.searchRequest?.timeoutMs||12000,'number'));
  seriesSection.append(field('series_search_headers','Search Headers (JSON)',row.seriesConfig?.searchRequest? '':'','textarea'));
  seriesSection.append(field('series_search_body','Search Body (JSON)',row.seriesConfig?.searchRequest? '':'','textarea'));
  seriesSection.append(field('series_search_responseMapping','Search response mapping',Object.entries(row.seriesConfig?.searchResponseMapping || {videoId:'video_id',title:'title'}).map(([key,value])=>`${key}=${value}`).join('\n'),'textarea'));
  seriesSection.append(e('h4','Download Request'));
  seriesSection.append(field('series_download_endpoint','Download Endpoint',row.seriesConfig?.downloadRequest?.endpoint||'','url'));
  seriesSection.append(field('series_download_queryTemplate','Download Query Template',row.seriesConfig?.downloadRequest?.queryTemplate||'','text'));
  seriesSection.append(field('series_download_method','Download Method',row.seriesConfig?.downloadRequest?.method||'GET','select',[['GET','GET'],['POST','POST']]));
  seriesSection.append(field('series_download_timeoutMs','Download timeout (ms)',row.seriesConfig?.downloadRequest?.timeoutMs||12000,'number'));
  seriesSection.append(field('series_download_headers','Download Headers (JSON)',row.seriesConfig?.downloadRequest? '':'','textarea'));
  seriesSection.append(field('series_download_body','Download Body (JSON)',row.seriesConfig?.downloadRequest? '':'','textarea'));
  seriesSection.append(field('series_download_responseMapping','Download response mapping',Object.entries(row.seriesConfig?.downloadResponseMapping || {downloadUrl:'file',backupUrl:'reserved_file'}).map(([key,value])=>`${key}=${value}`).join('\n'),'textarea'));
  seriesSection.append(e('h4','Processing'));
  seriesSection.append(field('series_processing_initialWaitMs','Initial wait (ms)',row.seriesConfig?.processing?.initialWaitMs||20000,'number'));
  seriesSection.append(field('series_processing_pollIntervalMs','Poll interval (ms)',row.seriesConfig?.processing?.pollIntervalMs||10000,'number'));
  seriesSection.append(field('series_processing_maxPreparationMs','Max preparation (ms)',row.seriesConfig?.processing?.maxPreparationMs||300000,'number'));
  seriesSection.append(field('series_processing_generatedUrlLifetimeMs','Generated URL lifetime (ms)',row.seriesConfig?.processing?.generatedUrlLifetimeMs||600000,'number'));
  seriesSection.append(field('series_processing_pendingStatusCodes','Pending status codes (comma separated)',(row.seriesConfig?.processing?.pendingStatusCodes||[404]).join(','),'text'));
  seriesSection.append(field('series_processing_qualityMatchField','Quality match field',row.seriesConfig?.processing?.qualityMatchField||'id'));
  grid.append(seriesSection);
  // Toggle section visibility when type changes
  setTimeout(()=>{
    const typeSelect = document.getElementById('field_type');
    if(typeSelect) typeSelect.addEventListener('change',()=>{ seriesSection.style.display = typeSelect.value === 'series' ? 'block' : 'none'; });
  },0);

  openEditor(row._id?'تعديل الخدمة':'إضافة خدمة',[grid,advanced,e('p','المتغيرات: {query} كل ما بعد الأمر، {arg1} أول كلمة، {args} كل الكلمات. في Body يمكن استخدامها مباشرة.','help'),e('h3','فحص قبل الحفظ'),testQuery,testPath,test,testOutput],async()=>{
    const v=values();
    v.timeoutMs=Number(v.timeoutMs);
    // Top-level headers/body handling
    for(const key of ['headers','body']){if(!v[key].trim())delete v[key];else {try{v[key]=JSON.parse(v[key])}catch{throw Error('تحقق من صيغة '+key)}}}
    // If series type, build seriesConfig
    if(v.type==='series'){
      const sc = { general: {}, searchRequest: {}, downloadRequest: {}, processing: {} };
      sc.general.resultLimit = Number(v.series_general_resultLimit) || 6;
      sc.general.targetQuality = String(v.series_general_targetQuality || '480');
      sc.searchRequest.endpoint = String(v.series_search_endpoint || '');
      sc.searchRequest.queryTemplate = String(v.series_search_queryTemplate || '');
      sc.searchRequest.method = String(v.series_search_method || 'GET');
      sc.searchRequest.timeoutMs = Number(v.series_search_timeoutMs) || 12000;
      if(v.series_search_headers && v.series_search_headers.trim()){ try{ sc.searchRequest.headers = JSON.parse(v.series_search_headers); }catch{ throw Error('تحقق من صيغة search headers'); } }
      if(v.series_search_body && v.series_search_body.trim()){ try{ sc.searchRequest.body = JSON.parse(v.series_search_body); }catch{ throw Error('تحقق من صيغة search body'); } }
      try{ sc.searchResponseMapping = Object.fromEntries(String(v.series_search_responseMapping||'').split(/\n|\r\n/).map(l=>l.trim()).filter(Boolean).map(l=>{const [k,...rest]=l.split('=');return [k.trim(),rest.join('=').trim()];})); }catch{ sc.searchResponseMapping = {}; }
      sc.downloadRequest.endpoint = String(v.series_download_endpoint || '');
      sc.downloadRequest.queryTemplate = String(v.series_download_queryTemplate || '');
      sc.downloadRequest.method = String(v.series_download_method || 'GET');
      sc.downloadRequest.timeoutMs = Number(v.series_download_timeoutMs) || 12000;
      if(v.series_download_headers && v.series_download_headers.trim()){ try{ sc.downloadRequest.headers = JSON.parse(v.series_download_headers); }catch{ throw Error('تحقق من صيغة download headers'); } }
      if(v.series_download_body && v.series_download_body.trim()){ try{ sc.downloadRequest.body = JSON.parse(v.series_download_body); }catch{ throw Error('تحقق من صيغة download body'); } }
      try{ sc.downloadResponseMapping = Object.fromEntries(String(v.series_download_responseMapping||'').split(/\n|\r\n/).map(l=>l.trim()).filter(Boolean).map(l=>{const [k,...rest]=l.split('=');return [k.trim(),rest.join('=').trim()];})); }catch{ sc.downloadResponseMapping = {}; }
      sc.processing.initialWaitMs = Number(v.series_processing_initialWaitMs) || 20000;
      sc.processing.pollIntervalMs = Number(v.series_processing_pollIntervalMs) || 10000;
      sc.processing.maxPreparationMs = Number(v.series_processing_maxPreparationMs) || 300000;
      sc.processing.generatedUrlLifetimeMs = Number(v.series_processing_generatedUrlLifetimeMs) || 600000;
      sc.processing.pendingStatusCodes = String(v.series_processing_pendingStatusCodes||'404').split(',').map(s=>Number(s.trim())).filter(Boolean);
      sc.processing.qualityMatchField = String(v.series_processing_qualityMatchField||'id');
      v.seriesConfig = sc;
    }
    await request('apis'+(row._id?'/'+row._id:''),row._id?'PUT':'POST',v);
    await saved();
  });
}
function editTemplate(row) {
  const input=field('text','نص الرد',row.text,'textarea'),tokens=e('div',undefined,'tokens'),preview=e('div',undefined,'preview');
  row.fields.forEach(key=>tokens.append(button('{'+key+'}',null,()=>{const area=$('field_text');area.setRangeText('{'+key+'}',area.selectionStart,area.selectionEnd,'end');area.focus();updatePreview();})));
  function updatePreview(){preview.textContent=$('field_text').value.replace(/\{([^{}]+)\}/g,(_,key)=>({nickname:'لقب العضو',mention:'@العضو',kingdomName:'اسم المملكة',oldRank:'عضو',newRank:'مشرف',signature:'الإدارة',moderatorName:'المشرف'})[key]||'['+key+']');}
  const reset=button('استعادة الرد الأصلي','rotate-ccw',()=>{
    if(!confirm('استعادة النص الأصلي لهذا الرد؟'))return;
    return request('templates/'+row.key,'DELETE').then(async()=>{templates=[];await saved()});
  });
  openEditor('تعديل الرد',[input,tokens,e('p','المتغيرات تمثل بيانات الرسالة الفعلية؛ يجب الاحتفاظ بها.','help'),e('h3','معاينة'),preview,reset],async()=>{await request('templates/'+row.key,'PUT',values());templates=[];await saved()});
  $('field_text').addEventListener('input',updatePreview);updatePreview();
}
async function editKingdom(row={}) {
  const {groups}=await request('groups');
  const grid=e('div',undefined,'form-grid');grid.append(field('name','اسم المملكة',row.name),field('timeZone','المنطقة الزمنية',row.timeZone||'Asia/Amman'),field('isActive','مملكة نشطة',row.isActive!==false,'checkbox'));
  const roles=[['mainGroup','المجموعة الأساسية'],['receptionGroup','مجموعة الاستقبال'],['workGroup','مجموعة إنجازات الإدارة'],['adminGroup','مجموعة الإدارة']];roles.forEach(([key,label])=>{const choices=[['','بدون مجموعة'],...groups.map(group=>[group.id,group.name])];if(row[key]&&!groups.some(group=>group.id===row[key]))choices.push([row[key],row[key]+' (المجموعة الحالية)']);grid.append(field(key,label,row[key]||'','select',choices));});
  const assigned=roles.map(([key])=>row[key]);grid.append(field('extraGroupIds','المجموعات الإضافية',(row.groupIds||[]).filter(j=>!assigned.includes(j)).join('\n'),'textarea'),field('admins','معرّفات أدمن المملكة',(row.admins||[]).join('\n'),'textarea'));
  [['mainGroupInviteLink','رابط المجموعة الأساسية'],['receptionGroupInviteLink','رابط الاستقبال'],['workGroupInviteLink','رابط الوورك'],['adminGroupInviteLink','رابط الإدارة'],['announcementLink','رابط الإعلانات']].forEach(([key,label])=>grid.append(field(key,label,row[key],'url')));
  const items=[grid];if(row.id){const danger=e('div',undefined,'danger-zone');danger.append(button('حذف المملكة','trash-2',()=>{openEditor('حذف المملكة نهائيًا',[e('p','سيتم حذف أعضاء المملكة وبنكها وجلسات المافيا المرتبطة بها. اكتب الاسم: '+row.name),field('confirm','اسم المملكة')],async()=>{await request('kingdoms/'+row.id,'DELETE',values());await saved()})},'danger'));items.push(danger);}
  openEditor(row.id?'تعديل '+row.name:'إضافة مملكة',items,async()=>{await request('kingdoms'+(row.id?'/'+row.id:''),row.id?'PUT':'POST',{...values(),updatedAt:row.updatedAt});await saved()});
}
function editMember(user) {
  const details=e('div',undefined,'details-grid');[['اسم واتساب',user.whatsappName],['معرّف العضو',user.jid],['المستوى',user.level],['XP الكلي',user.xp],['XP المحادثة',user.chatXp],['XP الألعاب',user.gameXp],['نقاط الألعاب',user.points],['العملات',user.coins],['الرسائل الكلية',user.totalMessages],['الاستقبال اليومي',user.dailyWelcomes],['نجوم اليوم',user.dailyRankStarsEarned],['آخر نشاط',date(user.lastActivityAt)]].forEach(([label,value])=>{const row=e('div');row.append(e('span',label),e('strong',String(value??'—')));details.append(row)});
  const grid=e('div',undefined,'form-grid');grid.append(field('nickname','اللقب',user.nickname),field('role','الصلاحية داخل البوت',user.role,'select',Object.entries(roleNames).filter(([key])=>['member','moderator','admin','super_admin'].includes(key))),field('isBanned','محظور داخل البوت',user.isBanned,'checkbox'),field('banReason','سبب الحظر',user.banReason));
  openEditor(user.nickname,[details,grid],async()=>{await request('members/'+user._id,'PUT',{...values(),kingdom:user.kingdom_id});await saved()});
}
function navigate(next){section=Object.hasOwn(labels,next)?next:'overview';page=1;query='';history.replaceState(null,'','#'+section);load().catch(showError);}
Object.entries(labels).forEach(([key,label])=>{const link=e('a',undefined,'nav-link');link.href='#'+key;link.dataset.section=key;link.append(icon(icons[key]),e('span',label));link.addEventListener('click',event=>{event.preventDefault();navigate(key)});$('navigation').append(link)});
$('loginForm').addEventListener('submit',async event=>{event.preventDefault();const submit=event.submitter;submit.disabled=true;$('loginNotice').textContent='';try{csrf=(await request('login','POST',{password:$('password').value})).csrf;await bootstrap();}catch(error){$('loginNotice').textContent=error.message;}finally{submit.disabled=false;}});
$('logout').addEventListener('click',()=>request('logout','POST').finally(()=>location.reload()));
$('restart').addEventListener('click',async()=>{if(!confirm('سيتم قطع اتصال واتساب لحظيًا وإعادة تشغيل البوت. هل تريد المتابعة؟'))return;try{await request('restart','POST');toast('بدأت إعادة التشغيل؛ انتظر عودة البوت.');}catch(error){showError(error);}});
$('refresh').addEventListener('click',()=>{templates=[];bootstrap().catch(showError)});
$('scope').addEventListener('change',()=>{page=1;load().catch(showError)});
$('closeEditor').addEventListener('click',()=>$('editor').close());$('cancelEditor').addEventListener('click',()=>$('editor').close());
$('editorForm').addEventListener('submit',async event=>{event.preventDefault();$('saveEditor').disabled=true;$('editorError').textContent='';try{await saveAction();}catch(error){$('editorError').textContent=error.message;}finally{$('saveEditor').disabled=false;}});
section=Object.hasOwn(labels,location.hash.slice(1))?location.hash.slice(1):'overview';paintIcons();
bootstrap().catch(error=>{if(error.message!=='يلزم تسجيل الدخول')$('loginNotice').textContent=error.message;});
