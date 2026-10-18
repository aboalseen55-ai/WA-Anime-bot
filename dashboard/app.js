'use strict';
const $ = id => document.getElementById(id);
const labels = { overview:'نظرة عامة', commands:'الأوامر والردود', kingdoms:'الممالك', members:'الأعضاء', reports:'إنجازات الإدارة', games:'الألعاب', banks:'البنوك', services:'الخدمات', usage:'استهلاك الذكاء', audit:'سجل التغييرات' };
const icons = {overview:'layout-dashboard',commands:'message-square-text',kingdoms:'crown',members:'users',reports:'chart-no-axes-combined',games:'gamepad-2',banks:'landmark',services:'plug',usage:'sparkles',audit:'history'};
const roleNames = {member:'عضو',moderator:'مشرف',admin:'أدمن',super_admin:'أدمن رئيسي',everyone:'الجميع',developer:'المطور'};
labels.controls='التحكم والصيانة'; icons.controls='settings-2';
labels.business='الأعمال'; icons.business='briefcase';
labels.broadcast='رسائل جماعية'; icons.broadcast='send';
labels.overview='الرئيسية';
const NAV_GROUPS=[
  ['الرئيسية',['overview','broadcast']],
  ['البوت',['commands','services','controls','usage']],
  ['المجتمع',['kingdoms','members','games','banks','reports']],
  ['الأعمال',['business']],
  ['النظام',['audit']]
];
const HINTS={overview:'كل اشي مهم بنظرة وحدة',broadcast:'ابعت رسالة لقروبات أو أشخاص، واكتبها بمساعدة الذكاء الاصطناعي',commands:'الأوامر الأصلية والردود وأوامرك المضافة',services:'الخدمات الخارجية المربوطة بالأوامر',controls:'شغّل وطفّي أي قسم أو أمر أو خدمة',usage:'استهلاك الذكاء الاصطناعي يوميًا',kingdoms:'الممالك وقروباتها وروابطها',members:'أعضاء المملكة وصلاحياتهم',games:'جلسات المافيا والفعاليات',banks:'أرصدة البنوك وسجل العمليات',reports:'إنجازات الإدارة اليومية',business:'الردود التلقائية والطلبات والملخص اليومي',audit:'كل تعديل صار على اللوحة'};
const groupOf=key=>NAV_GROUPS.find(([,keys])=>keys.includes(key))?.[0]||'';
let csrf='', state={commands:[],apis:[]}, kingdoms=[], templates=[], catalog=[], section='overview', tab='builtin', page=1, query='', version=0, saveAction=null, toastTimer;
const e = (tag, text, className) => { const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(className)node.className=className; return node; };
const icon = name => { const node=e('i');node.dataset.lucide=name;return node; };
const paintIcons = () => window.lucide?.createIcons();
const number = value => Number(value||0).toLocaleString('ar-JO');
const date = value => value?new Date(value).toLocaleString('ar-JO'):'—';
const MODE_NAMES={all:'شخصي + قروبات',personal:'البوت الشخصي',fun:'بوت القروبات'};
function button(text, name, handler, className='secondary') { const node=e('button',undefined,className);node.type='button';if(name)node.append(icon(name));if(text)node.append(e('span',text));node.addEventListener('click',()=>Promise.resolve(handler()).catch(showError));return node; }
function action(name,title,handler) { const node=button('',name,handler,'icon-button');node.title=title;node.setAttribute('aria-label',title);return node; }
function toast(message) { $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000); }
function showError(error) { toast(error.message||'تعذر إكمال الطلب'); }
async function request(path,method='GET',body) {
  const response=await fetch('/dashboard/api/'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Dashboard-CSRF':csrf},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));
  if(response.status===401&&path!=='login') { stopPairing();$('pairing').hidden=true;$('app').hidden=true;$('login').hidden=false;csrf=''; }
  if(response.status===503&&data.code==='not_connected') showPairing();
  if(!response.ok){const error=Error(data.error||'تعذر الاتصال بالخادم');error.code=data.code;throw error;}return data;
}
// شاشة ربط واتساب: تظهر لما البوت مش متصل، وتعرض أحدث رمز QR من السيرفر فقط
let pairingTimer=null, pairingExpiry=null, pairingCountdown=null, pairingShownId=0;
function clearPairingImage(){const img=$('pairingQr');img.hidden=true;img.removeAttribute('src');pairingShownId=0;clearTimeout(pairingExpiry);clearInterval(pairingCountdown);$('pairingTimer').textContent='';$('pairingWait').hidden=false;$('pairingFrame').classList.add('idle');}
function stopPairing(){clearTimeout(pairingTimer);pairingTimer=null;clearPairingImage();}
function showPairing(){if(!$('pairing').hidden)return;$('login').hidden=true;$('app').hidden=true;$('pairing').hidden=false;$('pairingTitle').textContent='بنجهّز رمز الربط…';clearPairingImage();paintIcons();pollPairing();}
function renderPairing(data){
  if(data.status==='qr'){
    $('pairingTitle').textContent='امسح الرمز من واتساب';
    if(data.id!==pairingShownId){
      clearPairingImage();pairingShownId=data.id;const img=$('pairingQr');img.src=data.image;img.hidden=false;$('pairingWait').hidden=true;$('pairingFrame').classList.remove('idle');
      const ends=Date.now()+Math.max(0,data.expiresIn||0);
      const tick=()=>{const left=Math.ceil((ends-Date.now())/1000);$('pairingTimer').textContent=left>0?`الرمز صالح لـ ${number(left)} ثانية، وبيتحدّث تلقائيًا`:'';};
      tick();pairingCountdown=setInterval(tick,1000);
      pairingExpiry=setTimeout(()=>{clearPairingImage();$('pairingTitle').textContent='انتهى الرمز، بستنى رمز جديد…';},Math.max(0,data.expiresIn||0));
    }
  } else if(data.status==='connected'){
    stopPairing();$('pairingTitle').textContent='تم الاتصال بواتساب ✓';$('pairingWait').textContent='جاري فتح اللوحة…';
  } else {clearPairingImage();$('pairingTitle').textContent='بستنى رمز جديد من واتساب…';}
}
async function pollPairing(){
  clearTimeout(pairingTimer);pairingTimer=null;
  if($('pairing').hidden)return;
  try{
    const data=await request('pairing');if($('pairing').hidden)return;renderPairing(data);
    if(data.status==='connected'){$('pairing').hidden=true;$('pairingWait').textContent='بستنى رمز جديد من واتساب…';await bootstrap().catch(showError);return;}
  }catch(error){if($('pairing').hidden)return;$('pairingTitle').textContent=error.message;}
  pairingTimer=setTimeout(pollPairing,3000);
}
function scoped(route) { return route+'?'+new URLSearchParams({kingdom:$('scope').value,page:String(page),q:query}); }
async function bootstrap() {
  state=await request('state');csrf=state.csrf;
  kingdoms=(await request('kingdoms')).kingdoms;
  const selected=$('scope').value;$('scope').replaceChildren(new Option('جميع الممالك',''));
  kingdoms.forEach(k=>$('scope').add(new Option(k.name,k.id)));$('scope').value=kingdoms.some(k=>k.id===selected)?selected:'';
  $('login').hidden=true;$('app').hidden=false;$('password').value='';
  $('modeLabel').textContent='الوضع: '+(MODE_NAMES[state.mode]||MODE_NAMES.all);
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
  $('pageTitle').textContent=labels[section];$('pageGroup').textContent=groupOf(section)===labels[section]?'SAM BOT':groupOf(section);$('pageHint').textContent=HINTS[section]||'';document.title=labels[section]+' | Sam Bot';closeNav();document.querySelectorAll('.nav-link').forEach(a=>{a.classList.toggle('active',a.dataset.section===section);if(a.dataset.section===section)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  $('scope').hidden=['commands','services','usage','controls','business','broadcast'].includes(section);
  try {
    let render;
    if(section==='overview') {const data=await request(scoped('overview'));render=()=>overview(data);}
    else if(section==='commands') {if(!catalog.length)catalog=(await request('catalog')).commands;if(!templates.length)templates=(await request('templates')).templates;render=commands;}
    else if(section==='kingdoms') {kingdoms=(await request('kingdoms')).kingdoms;render=kingdomList;}
    else if(section==='members') {const data=await request(scoped('members'));render=()=>members(data);}
    else if(section==='services') render=services;
    else if(section==='broadcast') {const data=await request('broadcast/targets');render=()=>broadcastPage(data);}
    else if(section==='business') {const data=await request('business?'+new URLSearchParams({status:businessStatus,q:query}));render=()=>business(data);}
    else if(section==='controls') {
      const data=await request('controls');
      state=await request('state');
      if(!catalog.length)catalog=(await request('catalog')).commands;
      render=()=>renderControls(data);
    }
    else {const data=await request(scoped(section));render=()=>dataList(data);}
    if(token!==version)return;root.replaceChildren();render();$('updated').textContent='آخر تحديث '+new Date().toLocaleTimeString('ar-JO');paintIcons();
  } catch(error) {if(token!==version)return;root.replaceChildren(e('p',error.message,'error-state'),button('إعادة المحاولة','refresh-cw',load));paintIcons();}
}
let controlsKind='';
function renderControls(data) {
  const root=$('content');
  const entries = [
    ...Object.entries(data.labels).map(([key,name])=>({key,name,kind:'قسم'})),
    ...[...new Set([...catalog.map(row=>row.command.split(/\s/)[0].toLowerCase()),...state.commands.map(row=>row.trigger)])].map(name=>({key:'command:'+name,name,kind:'أمر'})),
    ...state.apis.map(api=>({key:'service:'+api._id,name:api.name,kind:'خدمة',api}))
  ];
  const kinds=[['','الكل'],['قسم','الأقسام'],['أمر','الأوامر'],['خدمة','الخدمات']];
  const kindTabs=e('div',undefined,'tabs');
  kinds.forEach(([kind,label])=>{const b=button(label+' · '+number(entries.filter(row=>!kind||row.kind===kind).length),null,()=>{controlsKind=kind;[...kindTabs.children].forEach(x=>x.classList.toggle('active',x===b));draw();paintIcons();},kind===controlsKind?'active':'');kindTabs.append(b)});
  const area=e('div');root.append(kindTabs,searchBar('ابحث عن أمر أو خدمة',draw),area);
  function draw() {
    const rows=entries.filter(row=>(!controlsKind||row.kind===controlsKind)&&(row.name+' '+row.kind).includes(query));
    area.replaceChildren(table(['العنصر','النوع','الحالة','العودة التلقائية',''],rows.map(row=>{
      const rule=data.controls.find(item=>item.key===row.key);
      const controlOff=rule?.enabled===false && (!rule.until || new Date(rule.until)>new Date());
      const apiOff=row.api?.enabled===false;
      const off=controlOff || apiOff;
      const toggle=e('input');toggle.type='checkbox';toggle.className='switch';toggle.checked=!off;toggle.setAttribute('aria-label',row.name);
      toggle.disabled=apiOff && !rule;
      toggle.title=apiOff && !rule?'الخدمة متوقفة من إعدادات الخدمات':'تعديل حالة التحكم';
      toggle.addEventListener('change',()=>{const enabled=toggle.checked;toggle.checked=!off;editControl(row,rule,enabled)});
      const actions=rowsActions([['settings-2','إعدادات '+row.name,()=>editControl(row,rule,!off)]]);actions.prepend(toggle);
      return [row.name,row.kind,e('span',apiOff&&!controlOff?'متوقف من إعداد الخدمة':off?'متوقف مؤقتًا':'مفعّل',off?'pill off':'pill'),controlOff&&rule.until?date(rule.until):'—',actions];
    })));
    // Switches use the same editor so duration and reason accompany each change.
  }
  function editControl(row, rule={}, enabled=true) {
    const history=e('div');
    history.append(table(['التاريخ','الحالة','السبب','المسؤول'],(rule.history||[]).slice().reverse().map(item=>[date(item.at),item.enabled?'تشغيل':'إيقاف',item.reason||'—',item.actor])));
    openEditor(row.name,[field('enabled','مفعّل',enabled,'checkbox'),field('minutes','مدة الإيقاف',0,'select',[[0,'حتى إعادة التشغيل يدويًا'],[10,'10 دقائق'],[60,'ساعة'],[1440,'يوم']]),field('message','رسالة الصيانة',rule.message||'هذا الأمر متوقف مؤقتًا للصيانة. جرّب لاحقًا.','textarea'),field('reason','سبب داخلي',rule.reason||'','textarea'),history],async()=>{
      await request('controls','PUT',{...values(),key:row.key,revision:rule.revision||0});await saved();
    });
  }
  draw();
}
function metricsRow(items){
  const stats=e('div',undefined,'metrics');
  items.forEach(([label,value,name])=>{const item=e('div',undefined,'metric'),title=e('span'),chip=e('span',undefined,'metric-icon');chip.append(icon(name||'activity'));title.append(chip,e('span',label));item.append(title,e('strong',number(value)));stats.append(item)});
  return stats;
}
function greeting(){const h=new Date().getHours();return h<5?'سهرانين؟':h<12?'صباح الخير':h<17?'نهارك سعيد':'مساء الخير';}
function leaderboard(rows,valueOf,label){
  const list=e('div',undefined,'leaderboard'),max=Math.max(1,...rows.map(valueOf));
  rows.forEach((row,index)=>{const item=e('div',undefined,'leader'),name=e('div',undefined,'leader-name'),bar=e('div',undefined,'bar'),fill=e('i');fill.style.width=Math.max(4,Math.round(valueOf(row)/max*100))+'%';bar.append(fill);name.append(e('strong',row.nickname||'—'),bar);item.append(e('span',number(index+1),'rank'),name,e('span',number(valueOf(row)),'leader-value'));item.title=label;list.append(item)});
  return rows.length?list:empty('ما في نشاط لسا اليوم');
}
function overview(data) {
  const root=$('content'),hero=e('section',undefined,'hero'),intro=e('div'),chips=e('div',undefined,'hero-chips');
  const scopeName=kingdoms.find(k=>k.id===$('scope').value)?.name;
  intro.append(e('span','SAM BOT · '+(scopeName||'كل الممالك'),'eyebrow'),e('h2',greeting()+' 👋'),e('p','البوت شغال وكل اشي تحت إيدك. ابعت رسالة، عدّل أمر، أو شوف مين متفاعل اليوم.'));
  const chip=(text,name,kind)=>{const node=e('span',undefined,'chip '+(kind||''));node.append(icon(name),e('span',text));return node;};
  chips.append(chip('متصل بواتساب','wifi','ok'),chip(MODE_NAMES[state.mode]||MODE_NAMES.all,'layers','info'),chip(state.openai?'OpenAI جاهز':'OpenAI غير مضبوط','sparkles',state.openai?'ok':'warn'),chip(number(state.commands.length)+' أمر مضاف','terminal'));
  intro.append(chips);
  const quick=e('div',undefined,'quick-grid');
  [['رسالة جماعية','لقروبات أو أشخاص','send',()=>navigate('broadcast')],['أمر جديد','رد أو خدمة','square-plus',()=>{tab='custom';navigate('commands');setTimeout(()=>editCommand(),300)}],['الصيانة','شغّل وطفّي الأقسام','toggle-left',()=>navigate('controls')],['الأعمال','الطلبات والردود','briefcase',()=>navigate('business')]].forEach(([title,sub,name,run])=>{const b=button('',name,run,'quick');b.querySelector('span')?.remove();b.append(e('strong',title),e('small',sub));quick.append(b)});
  hero.append(intro,quick);root.append(hero);
  root.append(metricsRow([['الممالك',data.totals.kingdoms,'crown'],['الأعضاء المسجّلون',data.totals.members,'users'],['رسائل اليوم',data.totals.dailyMessages,'message-circle'],['إجابات الألعاب اليوم',data.totals.answers,'gamepad-2']]));
  const split=e('div',undefined,'split'),activity=e('section',undefined,'band'),games=e('section',undefined,'band');
  activity.append(heading('🔥 الأكثر تفاعلًا','حسب رسائل اليوم'),leaderboard(data.top,u=>u.dailyMessages||0,'رسائل اليوم'));
  games.append(heading('🎮 أبطال الألعاب','حسب إجابات اليوم'),leaderboard(data.games,u=>u.dailyGameAnswers||0,'إجابات اليوم'));
  split.append(activity,games);root.append(split);
  const totals=e('section',undefined,'band'),row=e('div',undefined,'stat-row');
  [['كل الرسائل',data.totals.messages],['مجموع XP',data.totals.xp],['استقبال اليوم',data.totals.welcomes],['نجوم اليوم',data.totals.stars]].forEach(([label,value])=>{const stat=e('div',undefined,'stat');stat.append(e('span',label),e('strong',number(value)));row.append(stat)});
  totals.append(heading('📊 ملخص عام'),row);root.append(totals);
}
function commands() {
  const root=$('content'),tabs=e('div',undefined,'tabs');[['builtin','الأوامر الأصلية'],['replies','الردود والقوالب'],['custom','أوامري المضافة']].forEach(([id,label])=>tabs.append(button(label,null,()=>{tab=id;query='';page=1;commandsReset()},id===tab?'active':'')));root.append(tabs);
  const area=e('div');root.append(area);
  const bar=searchBar('ابحث عن أمر أو رد',()=>renderList());if(tab==='custom')bar.append(button('إضافة أمر','plus',()=>editCommand(),'primary'));area.append(bar);const results=e('div');area.append(results);
  function renderList() {
    results.replaceChildren();const source=tab==='builtin'?catalog:tab==='replies'?templates:state.commands;
    const list=source.filter(row=>JSON.stringify([row.command,row.title,row.description,row.text,row.trigger,row.file]).toLowerCase().includes(query.toLowerCase()));
    const visible=list.slice((page-1)*30,page*30);
    if(tab==='builtin') {const items=e('div',undefined,'command-list');visible.forEach(row=>{const item=e('div',undefined,'command');item.append(e('h3',row.title||row.command),e('p',row.description),e('small',row.usage));item.append(rowsActions([['pencil','تعديل الأمر الأصلي',()=>editBuiltinCommand(row)]]));items.append(item)});results.append(list.length?items:empty('لا توجد أوامر مطابقة'));}
    if(tab==='replies') results.append(table(['الرد','القسم','الحالة',''],visible.map(row=>{const title=e('span',row.title);title.title=row.text;return [title,sourceLabel(row.file),row.customized?'معدّل':'الأصلي',rowsActions([['pencil','تعديل الرد',()=>editTemplate(row)]])]})));
    if(tab==='custom')results.append(table(['الأمر','الاسم','الصلاحية','الحالة',''],visible.map(row=>[row.trigger,row.title,roleNames[row.permission],e('span',row.enabled?'مفعّل':'متوقف',row.enabled?'pill':'pill off'),rowsActions([['pencil','تعديل الأمر',()=>editCommand(row)],['trash-2','حذف الأمر',()=>remove('commands/'+row._id,row.title)]])])));
    results.append(pager(list.length,renderList));paintIcons();
  }
  renderList();
}
function commandsReset(){ $('content').replaceChildren();commands();paintIcons(); }
function editBuiltinCommand(row) {
  const key = btoa(unescape(encodeURIComponent(row.command))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const grid=e('div',undefined,'form-grid');
  grid.append(field('title','اسم العرض',row.title||row.command),field('description','الوصف',row.description||''),field('usage','طريقة الاستخدام',row.usage||''));
  openEditor('تعديل الأمر الأصلي '+row.command,[grid,e('p','هذا يعدل اسم الأمر ووصفه وطريقة عرضه في الداشبورد. لتعديل نصوص الردود استخدم قسم الردود والقوالب. منطق الأمر نفسه لا يتغير.','help')],async()=>{await request('builtin-commands/'+key,'PUT',values());catalog=[];await saved()});
}
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
async function duplicateService(api) { const name = prompt('اسم النسخة', `${api.name} - نسخة`); if (name) { await request('apis/'+api._id+'/duplicate','POST',{name}); await saved(); } }
function legacyServices() {
  const root=$('content'),title=heading('الخدمات المرتبطة',state.encryptionReady?'المفاتيح محفوظة بتشفير':'أضف مفتاح التشفير في إعدادات الخادم أولًا');title.append(button('إضافة خدمة','plus',()=>editApi(),'primary'));root.append(title);
  root.append(table(['الخدمة','الطريقة','الحالة',''],state.apis.map(api=>[api.name,api.method,api.enabled?'مفعّلة':'متوقفة',rowsActions([['pencil','تعديل الخدمة',()=>editApi(api)],['trash-2','حذف الخدمة',()=>remove('apis/'+api._id,api.name)]])])));
}
function services() {
  const root=$('content'), title=heading('الخدمات المرتبطة',state.encryptionReady?'المفاتيح محفوظة بتشفير':'أضف مفتاح التشفير في إعدادات الخادم أولًا');
  title.append(button('إضافة خدمة','plus',()=>editApi(),'primary')); root.append(title);
  root.append(table(['الخدمة','الطريقة','الحالة',''],state.apis.map(api=>[
    api.name,api.method,api.enabled?'مفعّلة':'متوقفة',
    rowsActions([['pencil','تعديل الخدمة',()=>editApi(api)],['copy','نسخ الخدمة',()=>duplicateService(api)],['trash-2','حذف الخدمة',()=>remove('apis/'+api._id,api.name)]])
  ])));
}
function dataList(data) {
  const root=$('content');
  if(section==='usage')root.append(heading('استهلاك الذكاء الاصطناعي','إجمالي البوت؛ لا تُقسّم سجلات الاستخدام الحالية حسب المملكة'),table(['اليوم','النموذج','الطلبات','الناجحة','الفاشلة','Input','Output','Tokens'],data.rows.map(r=>[r.dateKey,r.model,number(r.requests),number(r.successfulRequests),number(r.failedRequests),number(r.promptTokens),number(r.completionTokens),number(r.totalTokens)])));
  if(section==='audit')root.append(heading('سجل التغييرات'),table(['التاريخ','العملية','بواسطة','المملكة'],data.rows.map(r=>[date(r.createdAt),auditLabel(r.action),r.actorJid==='dashboard:owner'?'مالك اللوحة':r.actorJid,kingdoms.find(k=>k.id===r.kingdomId)?.name||r.kingdomId||'عام'])));
  if(section==='games') {const names={collecting_players:'تسجيل اللاعبين',collecting_config:'إعداد الجولة',roles_distributed:'جولة جارية',game_over:'انتهت الجولة',closed:'مغلقة'};root.append(heading('جلسات المافيا','الجلسات المحفوظة فقط؛ لا يتم عرض أدوار اللاعبين السرية'),table(['المضيف','الحالة','المجموعة','آخر تحديث'],data.rows.map(r=>[r.hostNickname||'—',names[r.status]||r.status,r.groupId,date(r.updatedAt)])),heading('الفعاليات المسجّلة','آخر جلسات الألعاب المتوفرة'),table(['المشرف','اللعبة','البداية','النهاية'],(data.sessions||[]).map(r=>[r.nickname,r.session.gameName,date(r.session.startTime),date(r.session.endTime)])));}
  if(section==='reports')root.append(heading('إنجازات الإدارة','العدّادات اليومية الحالية للأعضاء ذوي الصلاحيات الإدارية'),table(['الأدمن','استقبال','رسائل','فعاليات','إجابات ألعاب','XP الكلي','نجوم اليوم',''],data.rows.map(r=>[r.nickname,number(r.dailyWelcomes),number(r.dailyMessages),number(r.sessionCount),number(r.dailyGameAnswers),number(r.xp),number(r.dailyRankStarsEarned),rowsActions([['file-text','معاينة التقرير',()=>{openEditor('تقرير '+r.nickname,[e('div',r.report||'لا يوجد تقرير لهذا العضو اليوم','preview')],async()=>{});$('saveEditor').hidden=true;}]])])));
  if(section==='banks') {root.append(heading('بنوك الممالك'),table(['المملكة','الرصيد'],data.banks.map(b=>[kingdoms.find(k=>k.id===b.kingdom)?.name||b.kingdom,number(b.totalCoins)])),heading('سجل العمليات'),table(['النوع','القيمة','التاريخ','المملكة'],data.rows.map(r=>[({deposit:'إيداع',withdraw:'سحب',transfer:'تحويل',admin_grant:'منح من الأدمن',admin_take:'استرجاع من الأدمن'})[r.transaction.type]||r.transaction.type,number(r.transaction.amount),date(r.transaction.timestamp),kingdoms.find(k=>k.id===r.kingdom)?.name||r.kingdom])));}
  root.append(pager(data.total));
}
function auditLabel(value){return ({dashboard_template_updated:'تعديل رد',dashboard_template_restored:'استرجاع الرد الأصلي',dashboard_builtin_command_updated:'تعديل أمر أصلي',dashboard_kingdom_updated:'تعديل مملكة',dashboard_kingdom_created:'إضافة مملكة',dashboard_member_updated:'تعديل عضو',kingdom_deleted:'حذف مملكة',kingdom_created:'إنشاء مملكة',dashboard_commands_post:'إضافة أمر',dashboard_commands_put:'تعديل أمر',dashboard_commands_delete:'حذف أمر',dashboard_apis_post:'إضافة خدمة',dashboard_apis_put:'تعديل خدمة',dashboard_apis_delete:'حذف خدمة'})[value]||value;}

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
  const fieldControllers = {};
  function attachFieldBlocks(prefix, config, host) {
    const options=structuredClone(config.fieldOptions||{});
    fieldControllers[prefix]=options;
    for (const [kind,label,suffix] of [['query','معاملات الطلب','queryTemplate'],['headers','Headers','headers'],['body','Body','body']]) {
      const area=e('fieldset'),legend=e('legend',label),toggle=e('input');toggle.type='checkbox';toggle.checked=options[kind]!==false;toggle.setAttribute('aria-label','تفعيل '+label);legend.prepend(toggle);area.append(legend);
      const list=e('div');area.append(list);host.append(area);
      const source=$('field_'+prefix+suffix);
      const disabled=new Set(options['disabled'+kind]||[]);
      function redraw() {
        let keys=config.fieldNames?.[kind]||[];
        try {
          if(kind==='query')keys=[...new URLSearchParams(source?.value||'').keys()];
          else if(source?.value.trim())keys=Object.keys(JSON.parse(source.value));
        } catch { return; }
        list.replaceChildren();
        for(const key of new Set([...keys,...disabled])) {
          const line=e('label'),check=e('input');check.type='checkbox';check.checked=!disabled.has(key);check.disabled=!toggle.checked;
          check.addEventListener('change',()=>{check.checked?disabled.delete(key):disabled.add(key);options['disabled'+kind]=[...disabled]});
          line.append(check,e('span',key));list.append(line);
        }
      }
      toggle.addEventListener('change',()=>{options[kind]=toggle.checked;redraw()});source?.addEventListener('change',redraw);redraw();
    }
  }
  const grid=e('div',undefined,'form-grid');
  const typeValue = row.type || 'api';
  grid.append(field('name','اسم الخدمة',row.name),field('type','نوع الخدمة',typeValue,'select',[['api','Normal Service'],['series','Series Service']]),field('endpoint','رابط HTTPS — يدعم {query}',row.endpoint,'url'),field('queryTemplate','معاملات GET — مثال: q={query}&page=1',row.queryTemplate),field('method','طريقة الطلب',row.method||'GET','select',[['GET','GET'],['POST','POST']]),field('responseType','نوع النتيجة',row.responseType||'text','select',[['text','نص / JSON'],['image_url','رابط صورة داخل JSON'],['image','ملف صورة مباشر'],['video_url','رابط فيديو داخل JSON'],['video','ملف فيديو مباشر'],['audio_url','رابط صوت داخل JSON'],['audio','ملف صوت مباشر']]),field('timeoutMs','مهلة الطلب بالمللي ثانية',row.timeoutMs||12000,'number'),field('enabled','مفعّلة',row.enabled!==false,'checkbox'));
  const headerField=field('headers','Headers (JSON)','','textarea'),bodyField=field('body','Body (JSON)','','textarea');
  headerField.querySelector('textarea').placeholder=row.hasHeaders?'محفوظة ومشفّرة ✓ — اترك الحقل فارغًا للاحتفاظ بها':'مثال: {"Authorization":"Bearer ..."}';
  bodyField.querySelector('textarea').placeholder=row.hasBody?'محفوظ ومشفّر ✓ — اترك الحقل فارغًا للاحتفاظ به':'مثال: {"query":"{query}"}';
  const advanced=e('details');advanced.append(e('summary','الإعدادات المتقدمة'),e('p',row.hasHeaders||row.hasBody?'المفاتيح الحالية محفوظة ومشفّرة. اترك الحقل فارغًا للاحتفاظ بها، أو اكتب JSON جديدًا لاستبدالها. لفراغها نهائيًا اكتب {}.':'أضف Headers أو Body بصيغة JSON. ستُحفظ القيم الحساسة مشفّرة.','help'),headerField,bodyField);
  const testQuery=field('testQuery','قيمة اختبار', 'test'), testPath=field('testPath','مسار النتيجة (اختياري)','data.url'), testOutput=e('pre',undefined,'preview');
  const test=button('اختبار الخدمة','play',async()=>{test.disabled=true;testOutput.textContent='جارٍ اختبار الطلب...';try{const v=apiValues();const result=await request('apis/test','POST',{...v,apiId:row._id,testQuery:document.getElementById('field_testQuery').value,testPath:document.getElementById('field_testPath').value});testOutput.textContent=(v.type==='series'?'نجح اختبار البحث فقط؛ لم يُختبر التنزيل.':'نجح الطلب ✓')+'\n'+JSON.stringify(result,null,2);}catch(error){testOutput.textContent='فشل الطلب ✕\n'+error.message;}finally{test.disabled=false;}});
  // Series-specific fields
  const seriesSection=e('div');
  seriesSection.style.display = typeValue === 'series' ? 'block' : 'none';
  seriesSection.append(e('h3','Series Service configuration'));
  seriesSection.append(field('series_general_resultLimit','Result limit',row.seriesConfig?.general?.resultLimit||6,'number'));
  seriesSection.append(field('series_general_showThumbnails','صورة مصغّرة لكل نتيجة',row.seriesConfig?.general?.showThumbnails === true,'checkbox'));
  seriesSection.append(field('series_general_outputType','نوع الإخراج',row.seriesConfig?.general?.outputType||'video','select',[['video','فيديو'],['audio','صوت'],['image','صورة'],['file','ملف']]));
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
    const normalBlocks=e('div'),searchBlocks=e('div'),downloadBlocks=e('div');
    advanced.append(normalBlocks);seriesSection.append(e('h4','حقول طلب البحث'),searchBlocks,e('h4','حقول طلب التنزيل'),downloadBlocks);
    attachFieldBlocks('',row,normalBlocks);attachFieldBlocks('series_search_',row.seriesConfig?.searchRequest||{},searchBlocks);attachFieldBlocks('series_download_',row.seriesConfig?.downloadRequest||{},downloadBlocks);
    function toggleType() {
      const series=typeSelect.value==='series';seriesSection.style.display=series?'block':'none';advanced.hidden=series;testPath.hidden=series;
      for(const name of ['endpoint','queryTemplate','method','responseType','timeoutMs'])$('field_'+name).parentElement.hidden=series;
      for(const name of ['series_general_targetQuality','series_processing_generatedUrlLifetimeMs','series_processing_qualityMatchField'])$('field_'+name).parentElement.hidden=true;
    }
    if(typeSelect) {typeSelect.addEventListener('change',toggleType);toggleType();}
  },0);

  function apiValues() {
    const v=values();
    v.timeoutMs=Number(v.timeoutMs);
    v.fieldOptions=fieldControllers['']||row.fieldOptions||{};
    // Top-level headers/body handling
    for(const key of ['headers','body']){if(!v[key].trim())delete v[key];else {try{v[key]=JSON.parse(v[key])}catch{throw Error('تحقق من صيغة '+key)}}}
    // If series type, build seriesConfig
    if(v.type==='series'){
      const sc = { general: {}, searchRequest: {}, downloadRequest: {}, processing: {} };
      sc.searchRequest.fieldOptions=fieldControllers.series_search_||row.seriesConfig?.searchRequest?.fieldOptions||{};
      sc.downloadRequest.fieldOptions=fieldControllers.series_download_||row.seriesConfig?.downloadRequest?.fieldOptions||{};
      sc.general.resultLimit = Number(v.series_general_resultLimit) || 6;
      sc.general.showThumbnails = v.series_general_showThumbnails === true;
      sc.general.outputType = String(v.series_general_outputType || 'video');
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
    return v;
  }
  openEditor(row._id?'تعديل الخدمة':'إضافة خدمة',[grid,advanced,e('p','المتغيرات: {query} كل ما بعد الأمر، {arg1} أول كلمة، {args} كل الكلمات. في Body يمكن استخدامها مباشرة.','help'),e('h3','فحص قبل الحفظ'),testQuery,testPath,test,testOutput],async()=>{
    await request('apis'+(row._id?'/'+row._id:''),row._id?'PUT':'POST',apiValues());
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
// تنسيق واتساب بالمعاينة: *عريض* _مائل_ ~مشطوب~ `كود` ```كتلة``` و> اقتباس، زي ما بيطلع بالتطبيق بالزبط
const WA_MARKS={'*':'strong','_':'em','~':'s','`':'code'};
function waInline(text){
  const out=document.createDocumentFragment();
  const re=/(^|[\s.,:;!?()"'«»\-،؛؟])([*_~`])(?![\s])([^\n]*?[^\s])\2(?=$|[\s.,:;!?()"'«»\-،؛؟])/u;
  let rest=text;
  while(rest){
    const m=re.exec(rest);
    if(!m){out.append(waLinks(rest));break;}
    const start=m.index+m[1].length;
    out.append(waLinks(rest.slice(0,start)));
    const node=e(WA_MARKS[m[2]]);
    if(m[2]==='`')node.textContent=m[3];else node.append(waInline(m[3]));
    out.append(node);rest=rest.slice(start+m[2].length*2+m[3].length);
  }
  return out;
}
function waLinks(text){
  const out=document.createDocumentFragment();let last=0;
  for(const m of text.matchAll(/https?:\/\/[^\s]+/g)){out.append(text.slice(last,m.index));const a=e('a',m[0],'wa-link');a.href=m[0];a.target='_blank';a.rel='noopener noreferrer';out.append(a);last=m.index+m[0].length;}
  out.append(text.slice(last));return out;
}
function waFormat(text){
  const root=document.createDocumentFragment(),parts=String(text||'').split('```');
  parts.forEach((part,i)=>{
    if(i%2&&i<parts.length-1){root.append(e('pre',part.replace(/^\n|\n$/g,''),'wa-pre'));return;}
    const chunk=i%2?'```'+part:part;
    chunk.split('\n').forEach((line,index,lines)=>{
      if(/^>\s?/.test(line)){const q=e('span',undefined,'wa-quote');q.append(waInline(line.replace(/^>\s?/,'')));root.append(q);}
      else{root.append(waInline(line));if(index<lines.length-1&&!/^>\s?/.test(lines[index+1]))root.append(e('br'));}
    });
  });
  return root;
}
function waBubble(text){
  const wrap=e('div',undefined,'wa-chat'),bubble=e('div',undefined,'wa-bubble');bubble.dir='auto';
  bubble.append(waFormat(text),e('span',new Date().toLocaleTimeString('ar-JO',{hour:'2-digit',minute:'2-digit'}),'wa-time'));
  wrap.append(bubble);return wrap;
}
// بوابة الرسائل الجماعية: الصوت لنص وتحسين الرسالة بـ OpenAI، واختيار القروبات والأرقام
const broadcastDraft={text:'',numbers:'',selected:new Set(),filter:''};
function broadcastPage(data) {
  const root=$('content');
  const layout=e('div',undefined,'broadcast-layout'),compose=e('section',undefined,'band'),targets=e('section',undefined,'band');
  layout.append(compose,targets);root.append(layout);

  // الكتابة
  const h=e('h3');h.append(icon('pen-line'),e('span','الرسالة'));compose.append(h);
  const text=e('textarea');text.id='broadcastText';text.placeholder='اكتب الرسالة هون، أو اضغط المايك واحكي';text.value=broadcastDraft.text;text.dir='auto';
  const live=e('div',undefined,'wa-live');
  const refresh=()=>{counter.textContent=text.value.length.toLocaleString('ar')+' حرف';live.replaceChildren(e('p','معاينة واتساب','help'),text.value.trim()?waBubble(text.value):e('p','اكتب الرسالة لتشوف شكلها هون','help'))};
  text.addEventListener('input',()=>{broadcastDraft.text=text.value;refresh()});
  const counter=e('p',text.value.length.toLocaleString('ar')+' حرف','help');
  const tools=e('div',undefined,'toolbar broadcast-tools');
  const mic=button('سجّل بصوتك','mic',()=>toggleRecording(),'secondary');
  const tone=e('select');tone.setAttribute('aria-label','أسلوب الرسالة');[['friendly','ودّي'],['formal','رسمي'],['announcement','إعلان'],['hype','حماسي']].forEach(([v,l])=>tone.add(new Option(l,v)));tone.style.width='auto';
  const extra=e('input');extra.placeholder='ملاحظة للتحسين (اختياري): مثلًا اختصرها';extra.setAttribute('aria-label','ملاحظة للتحسين');
  let previous=null;
  const undo=button('رجّع النسخة القديمة','undo-2',()=>{if(previous===null)return;text.value=previous;broadcastDraft.text=previous;previous=null;undo.hidden=true;refresh()});undo.hidden=true;
  // وضعين: "حسّن مسودتي" بيرتب اللي كتبته، و"اكتبها إلي" بيكتب رسالة من وصفك
  let aiMode='enhance';
  const modes=e('div',undefined,'segmented');
  const setMode=mode=>{aiMode=mode;[...modes.children].forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));enhance.querySelector('span').textContent=mode==='compose'?'اكتبها إلي':'حسّن الرسالة';text.placeholder=mode==='compose'?'احكيلي شو بدك تكتب ولمين. مثلًا: رسالة للممالك عن مسابقة يوم الجمعة الساعة 8 والجائزة 500 كوين':'اكتب الرسالة هون، أو اضغط المايك واحكي';};
  [['enhance','حسّن مسودتي'],['compose','اكتبها إلي']].forEach(([mode,label])=>{const b=e('button',label);b.type='button';b.dataset.mode=mode;b.addEventListener('click',()=>setMode(mode));modes.append(b)});
  const enhance=button('حسّن الرسالة','sparkles',async()=>{
    enhance.disabled=true;
    try{const r=await request('broadcast/enhance','POST',{text:text.value,tone:tone.value,instructions:extra.value,mode:aiMode});previous=text.value;text.value=r.text;broadcastDraft.text=r.text;undo.hidden=false;refresh();toast(aiMode==='compose'?'كتبتلك الرسالة، راجعها قبل الإرسال':'تم تحسين الرسالة، راجعها قبل الإرسال');if(aiMode==='compose')setMode('enhance');}
    finally{enhance.disabled=false}
  },'primary');
  if(!data.openai){mic.disabled=true;enhance.disabled=true;}
  tools.append(mic,undo);
  const ai=e('div',undefined,'ai-row');ai.append(modes,tone,enhance);
  const aiBox=e('div',undefined,'card ai-box');const aiTitle=e('h3');aiTitle.append(icon('sparkles'),e('span','الذكاء الاصطناعي'));aiBox.append(aiTitle,ai,extra);
  compose.append(text,counter,tools,aiBox,live);setMode('enhance');refresh();
  if(!data.openai)compose.append(e('p','لتفعيل المايك والتحسين: أضف OPENAI_API_KEY بمتغيرات ريلوي.','help'));
  const status=e('p','','help');compose.append(status);

  let recorder=null,chunks=[];
  async function toggleRecording(){
    if(recorder){recorder.stop();return;}
    if(!navigator.mediaDevices?.getUserMedia)throw Error('المتصفح ما بيدعم التسجيل');
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    chunks=[];recorder=new MediaRecorder(stream);
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};
    recorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const type=recorder.mimeType||'audio/webm';recorder=null;
      mic.classList.remove('recording');mic.querySelector('span').textContent='سجّل بصوتك';mic.disabled=true;status.textContent='جارٍ تحويل الصوت لنص…';
      try{
        const response=await fetch('/dashboard/api/broadcast/transcribe',{method:'POST',credentials:'same-origin',headers:{'Content-Type':type,'X-Dashboard-CSRF':csrf},body:new Blob(chunks,{type})});
        const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||'فشل التحويل');
        text.value=(text.value.trim()?text.value.trim()+'\n':'')+result.text;broadcastDraft.text=text.value;refresh();status.textContent='';
      }catch(error){status.textContent='';showError(error)}
      finally{mic.disabled=false}
    };
    recorder.start();mic.classList.add('recording');mic.querySelector('span').textContent='وقّف التسجيل';status.textContent='🎙️ عم بسجّل… احكي واضغط وقّف لما تخلص';
  }

  // الجهات
  const th=e('h3');th.append(icon('users'),e('span','لمين؟'));targets.append(th);
  const search=e('input',undefined,'search');search.type='search';search.placeholder='دوّر على قروب أو مملكة';search.value=broadcastDraft.filter;search.setAttribute('aria-label','بحث بالقروبات');
  const summary=e('p','','help');
  const list=e('div',undefined,'target-list');
  const groupsByKingdom=new Map();
  data.groups.forEach(g=>{const key=g.kingdom||'قروبات ثانية';if(!groupsByKingdom.has(key))groupsByKingdom.set(key,[]);groupsByKingdom.get(key).push(g)});
  const updateSummary=()=>{const n=normalizedCount();summary.textContent=`مختار ${number(broadcastDraft.selected.size)} قروب و${number(n)} رقم`;sendButton.disabled=!broadcastDraft.selected.size&&!n;};
  function renderTargets(){
    list.replaceChildren();const filter=broadcastDraft.filter.trim();
    for(const [kingdom,groups] of groupsByKingdom){
      const shown=groups.filter(g=>!filter||g.name.includes(filter)||kingdom.includes(filter));if(!shown.length)continue;
      const box=e('div',undefined,'target-group'),head=e('label',undefined,'checkbox-label target-head'),all=e('input');all.type='checkbox';
      all.checked=shown.every(g=>broadcastDraft.selected.has(g.id));
      all.addEventListener('change',()=>{shown.forEach(g=>all.checked?broadcastDraft.selected.add(g.id):broadcastDraft.selected.delete(g.id));renderTargets();updateSummary()});
      head.append(all,e('strong',kingdom),e('small',`(${number(shown.length)})`));box.append(head);
      shown.forEach(g=>{const row=e('label',undefined,'checkbox-label'),input=e('input');input.type='checkbox';input.checked=broadcastDraft.selected.has(g.id);
        input.addEventListener('change',()=>{input.checked?broadcastDraft.selected.add(g.id):broadcastDraft.selected.delete(g.id);renderTargets();updateSummary()});
        row.append(input,e('span',g.name));if(g.role)row.append(e('span',g.role,'pill'));box.append(row)});
      list.append(box);
    }
    if(!list.children.length)list.append(empty('ما في قروبات مطابقة'));
  }
  search.addEventListener('input',()=>{broadcastDraft.filter=search.value;renderTargets()});
  const bar=e('div',undefined,'target-tools');bar.append(search,button('اختار الكل','check-check',()=>{data.groups.forEach(g=>broadcastDraft.selected.add(g.id));renderTargets();updateSummary()}),button('شيل الكل','x',()=>{broadcastDraft.selected.clear();renderTargets();updateSummary()}));
  const numbers=e('textarea');numbers.className='numbers-input';numbers.placeholder='أرقام إضافية، كل رقم بسطر: 0791234567 أو 962791234567';numbers.value=broadcastDraft.numbers;numbers.dir='ltr';numbers.setAttribute('aria-label','أرقام إضافية');
  numbers.addEventListener('input',()=>{broadcastDraft.numbers=numbers.value;updateSummary()});
  function normalizedCount(){return broadcastDraft.numbers.split(/[\n,،;]+/).filter(x=>x.replace(/\D/g,'').length>=8).length}
  const sendButton=button('أرسل الرسالة','send',sendNow,'primary full');
  targets.append(bar,list,e('label','أرقام أشخاص'),numbers,summary,sendButton);
  renderTargets();updateSummary();

  async function sendNow(){
    const message=text.value.trim();if(!message)throw Error('اكتب الرسالة أول');
    const total=broadcastDraft.selected.size+normalizedCount();
    const preview=waBubble(message);
    openEditor(`تأكيد الإرسال لـ ${number(total)} جهة`,[e('p','هيك رح توصل الرسالة:','help'),preview,e('p','بينبعت بفاصل ثانية ونص بين كل رسالة حتى ما يعتبره واتساب سبام.','help')],async()=>{
      const job=await request('broadcast/send','POST',{text:message,groups:[...broadcastDraft.selected],numbers:broadcastDraft.numbers});
      $('editor').close();summary.textContent=`عم بنبعت… 0 من ${number(job.total)}`;sendButton.disabled=true;
      const poll=async()=>{
        const s=await request('broadcast/jobs/'+job.id);
        summary.textContent=s.finished?`✅ انبعتت لـ ${number(s.sent)} من ${number(s.total)}${s.failed?` · فشل ${number(s.failed)}${s.failedTargets?.length?': '+s.failedTargets.join('، '):''}`:''}`:`عم بنبعت… ${number(s.done)} من ${number(s.total)}`;
        if(s.error)summary.textContent='❌ '+s.error;
        if(!s.finished)setTimeout(()=>poll().catch(showError),1500);else{sendButton.disabled=false;toast(s.error?s.error:'خلص الإرسال');}
      };
      await poll();
    });
    // زر الحفظ بيصير "أرسل" لهالنافذة بس
    const save=$('saveEditor'),label=[...save.childNodes].find(n=>n.nodeType===3);
    if(label){const original=label.textContent;label.textContent='أرسل الآن';$('editor').addEventListener('close',()=>{label.textContent=original},{once:true});}
  }
}
let businessTab='orders', businessStatus='';
const dayNames=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
function business(data) {
  const root=$('content'),s=data.settings,t=data.today||{};
  const title=heading('وضع الأعمال',s.enabled?'مفعّل: البوت يرد على عملاء الخاص':'متوقف: لا يرد البوت على العملاء حتى تفعّله من الإعدادات');
  title.append(button(s.enabled?'إيقاف':'تفعيل',s.enabled?'pause':'play',()=>saveBusiness({...s,enabled:!s.enabled}).then(load),s.enabled?'secondary':'primary'));root.append(title);
  root.append(metricsRow([['رسائل العملاء اليوم',t.messages,'messages-square'],['عملاء جدد اليوم',t.newContacts,'user-plus'],['أسئلة أُجيب عنها',t.faqHits,'circle-help'],['بانتظار المتابعة',data.openCount,'clock']]));
  const tabs=e('div',undefined,'tabs');[['orders','الطلبات والحجوزات'],['faq','الأسئلة الشائعة'],['settings','الإعدادات والملخص']].forEach(([id,label])=>tabs.append(button(label,null,()=>{businessTab=id;query='';load()},id===businessTab?'active':'')));root.append(tabs);
  if(businessTab==='orders')businessOrders(root,data);
  if(businessTab==='faq')businessFaq(root,s);
  if(businessTab==='settings')businessSettings(root,s);
}
async function saveBusiness(settings){await request('business/settings','PUT',settings);toast('تم حفظ إعدادات الأعمال');}
function businessOrders(root,data) {
  const bar=searchBar('ابحث بالاسم أو الرقم أو التفاصيل',load),status=e('select');status.setAttribute('aria-label','الحالة');status.add(new Option('كل الحالات',''));Object.entries(data.statuses).forEach(([key,label])=>status.add(new Option(label,key)));status.value=businessStatus;status.style.width='auto';
  status.addEventListener('change',()=>{businessStatus=status.value;load().catch(showError)});bar.append(status);root.append(bar);
  if(!data.orders.length){root.append(empty('لا توجد طلبات بعد. عندما يكتب عميل "'+(data.settings.orders?.keywords?.[0]||'طلب')+'" في الخاص سيظهر طلبه هنا.'));return;}
  root.append(table(['الرقم','العميل','التفاصيل','التاريخ','الحالة',''],data.orders.map(order=>{
    const select=e('select');Object.entries(data.statuses).forEach(([key,label])=>select.add(new Option(label,key)));select.value=order.status;select.setAttribute('aria-label','حالة الطلب #'+order.ref);
    select.addEventListener('change',()=>request('business/orders/'+order._id,'PUT',{status:select.value,note:order.note}).then(()=>{order.status=select.value;toast('تم تحديث الحالة')}).catch(error=>{select.value=order.status;showError(error)}));
    const customer=e('span',order.customerName||'—');if(order.customerPhone)customer.title='+'+order.customerPhone;
    return ['#'+order.ref,customer,String(order.answers?.[0]?.answer||'—').slice(0,60),date(order.createdAt),select,rowsActions([['eye','تفاصيل الطلب',()=>businessOrderDetails(order,data.statuses)]])];
  })));
}
function businessOrderDetails(order,statuses) {
  const details=e('div');details.append(e('p',(order.customerName||'—')+(order.customerPhone?' · +'+order.customerPhone:''),'help'));
  (order.answers||[]).forEach(row=>{details.append(e('h3',row.question),e('p',row.answer))});
  if(order.customerPhone){const link=e('a','فتح المحادثة في واتساب');link.href='https://wa.me/'+order.customerPhone;link.target='_blank';link.rel='noopener noreferrer';link.className='help';details.append(link);}
  const grid=e('div',undefined,'form-grid');grid.append(field('status','الحالة',order.status,'select',Object.entries(statuses)),field('note','ملاحظة داخلية',order.note,'textarea'));
  openEditor(order.label+' #'+order.ref,[details,grid],async()=>{await request('business/orders/'+order._id,'PUT',values());$('editor').close();toast('تم الحفظ');await load();});
}
function businessFaq(root,s) {
  const bar=e('div',undefined,'toolbar');bar.append(button('إضافة سؤال','plus',()=>editFaq(s,-1),'primary'));root.append(bar,e('p','يرد البوت بالجواب عندما تحتوي رسالة العميل على إحدى الكلمات المفتاحية. المتغيرات: {name} اسم العميل، {business} اسم النشاط.','help'));
  if(!s.faq.length){root.append(empty('أضف أسئلة مثل الأسعار، الموقع، أوقات الدوام، التوصيل.'));return;}
  root.append(table(['السؤال','الكلمات المفتاحية','الحالة',''],s.faq.map((item,index)=>[item.question||item.keywords[0],item.keywords.join('، '),item.enabled===false?'متوقف':'مفعّل',rowsActions([['pencil','تعديل السؤال',()=>editFaq(s,index)],['trash-2','حذف السؤال',()=>openEditor('حذف السؤال',[e('p','هل تريد حذف هذا السؤال؟')],async()=>{await saveBusiness({...s,faq:s.faq.filter((_,i)=>i!==index)});$('editor').close();await load();})]])])));
}
function editFaq(s,index) {
  const item=s.faq[index]||{enabled:true,keywords:[]},grid=e('div',undefined,'form-grid');
  grid.append(field('question','عنوان السؤال',item.question),field('keywords','الكلمات المفتاحية (افصلها بفاصلة)',item.keywords.join('، ')),field('answer','الجواب',item.answer,'textarea'),field('enabled','مفعّل',item.enabled!==false,'checkbox'));
  openEditor(index<0?'إضافة سؤال شائع':'تعديل سؤال شائع',[grid],async()=>{const v=values(),faq=[...s.faq],row={question:v.question,keywords:v.keywords,answer:v.answer,enabled:v.enabled};if(index<0)faq.push(row);else faq[index]=row;await saveBusiness({...s,faq});$('editor').close();await load();});
}
function businessSettings(root,s) {
  const bar=e('div',undefined,'toolbar');
  bar.append(button('تعديل الإعدادات','pencil',()=>editBusinessSettings(s),'primary'),button('معاينة الملخص اليومي','eye',async()=>{const {text}=await request('business/summary');openEditor('معاينة الملخص',[e('pre',text,'help')]);$('saveEditor').hidden=true;}),button('إرسال الملخص الآن','send',async()=>{const r=await request('business/summary','POST',{});toast(r.sent?'تم الإرسال إلى '+r.sent+' رقم':'لم يُرسل؛ تحقق من أرقام المالك');}));
  root.append(bar);
  const hours=s.hours.enabled?s.hours.start+'–'+s.hours.end+' · '+s.hours.days.map(d=>dayNames[d]).join('، '):'بدون أوقات دوام (الترحيب دائمًا)';
  root.append(table(['الإعداد','القيمة'],[
    ['اسم النشاط',s.businessName||'—'],['أرقام المالك',(s.ownerJids.length?s.ownerJids:['رقم المطور الافتراضي']).map(j=>j.split('@')[0]).join('، ')],
    ['أوقات الدوام',hours],['المنطقة الزمنية',s.timeZone],
    ['الطلبات',s.orders.enabled?'مفعّلة · الكلمات: '+s.orders.keywords.join('، '):'متوقفة'],['أسئلة الطلب',s.orders.questions.join(' ← ')],
    ['الملخص اليومي',s.summary.enabled?'يوميًا الساعة '+s.summary.time:'متوقف']
  ]));
  root.append(e('p','لا يتأثر عمل البوت في المجموعات. يرد وضع الأعمال على المحادثات الخاصة فقط، ويتجاهل رسائل المالك والمطور والأوامر التي تبدأ بـ /.','help'));
}
function editBusinessSettings(s) {
  const general=e('div',undefined,'form-grid');
  general.append(field('enabled','تفعيل وضع الأعمال',s.enabled,'checkbox'),field('businessName','اسم النشاط',s.businessName),field('ownerJids','أرقام المالك للإشعارات (بالصيغة الدولية، افصلها بفاصلة)',s.ownerJids.map(j=>j.split('@')[0]).join('، ')),field('timeZone','المنطقة الزمنية',s.timeZone),field('greeting','رسالة الترحيب',s.greeting,'textarea'),field('awayMessage','رسالة خارج الدوام',s.awayMessage,'textarea'));
  const hours=e('div',undefined,'form-grid');hours.append(field('hoursEnabled','تحديد أوقات الدوام',s.hours.enabled,'checkbox'),field('hoursStart','بداية الدوام',s.hours.start,'time'),field('hoursEnd','نهاية الدوام',s.hours.end,'time'));
  dayNames.forEach((name,day)=>hours.append(field('day'+day,name,s.hours.days.includes(day),'checkbox')));
  const orders=e('div',undefined,'form-grid');orders.append(field('ordersEnabled','استقبال الطلبات والحجوزات',s.orders.enabled,'checkbox'),field('ordersLabel','اسم الطلب (مثل: طلب، حجز، موعد)',s.orders.label),field('ordersKeywords','كلمات بدء الطلب (افصلها بفاصلة)',s.orders.keywords.join('، ')),field('ordersQuestions','أسئلة الطلب (سؤال في كل سطر، حتى 6)',s.orders.questions.join('\n'),'textarea'),field('ordersConfirmation','رسالة التأكيد للعميل',s.orders.confirmation,'textarea'),field('ordersNotify','أرسل لي كل طلب جديد على الخاص',s.orders.notifyOwner,'checkbox'));
  const summary=e('div',undefined,'form-grid');summary.append(field('summaryEnabled','ملخص يومي للمالك',s.summary.enabled,'checkbox'),field('summaryTime','وقت الملخص',s.summary.time,'time'));
  openEditor('إعدادات الأعمال',[general,e('p','المتغيرات: {name} اسم العميل، {business} اسم النشاط، {hours} أوقات الدوام، {ref} رقم الطلب، {label} اسم الطلب.','help'),e('h3','أوقات الدوام'),hours,e('h3','الطلبات والحجوزات'),orders,e('h3','الملخص اليومي'),summary],async()=>{
    const v=values();
    await saveBusiness({...s,enabled:v.enabled,businessName:v.businessName,ownerJids:v.ownerJids,timeZone:v.timeZone,greeting:v.greeting,awayMessage:v.awayMessage,
      hours:{enabled:v.hoursEnabled,start:v.hoursStart,end:v.hoursEnd,days:dayNames.map((_,day)=>day).filter(day=>v['day'+day])},
      orders:{enabled:v.ordersEnabled,label:v.ordersLabel,keywords:v.ordersKeywords,questions:v.ordersQuestions.split('\n'),confirmation:v.ordersConfirmation,notifyOwner:v.ordersNotify},
      summary:{enabled:v.summaryEnabled,time:v.summaryTime}});
    $('editor').close();await load();
  });
}
function navigate(next){section=Object.hasOwn(labels,next)?next:'overview';page=1;query='';history.replaceState(null,'','#'+section);load().catch(showError);}
NAV_GROUPS.forEach(([group,keys])=>{
  $('navigation').append(e('p',group,'nav-group'));
  keys.forEach(key=>{const link=e('a',undefined,'nav-link');link.href='#'+key;link.dataset.section=key;link.append(icon(icons[key]),e('span',labels[key]));if(key==='broadcast')link.append(e('span','AI','nav-badge'));link.addEventListener('click',event=>{event.preventDefault();navigate(key)});$('navigation').append(link)});
});
function openNav(){document.body.classList.add('nav-open');$('scrim').hidden=false;}
function closeNav(){document.body.classList.remove('nav-open');$('scrim').hidden=true;}
$('menuToggle').addEventListener('click',()=>document.body.classList.contains('nav-open')?closeNav():openNav());
$('scrim').addEventListener('click',closeNav);

// البحث السريع (Ctrl+K): أي قسم أو إجراء بضغطة
function paletteActions(){
  return [
    ...NAV_GROUPS.flatMap(([group,keys])=>keys.map(key=>({group:'الأقسام',label:labels[key],hint:group,icon:icons[key],run:()=>navigate(key)}))),
    {group:'إجراءات',label:'رسالة جماعية جديدة',hint:'اكتب وابعت',icon:'send',run:()=>navigate('broadcast')},
    {group:'إجراءات',label:'إضافة أمر جديد',hint:'الأوامر',icon:'plus',run:()=>{tab='custom';navigate('commands');setTimeout(()=>editCommand(),300)}},
    {group:'إجراءات',label:'إضافة مملكة',hint:'الممالك',icon:'crown',run:()=>{navigate('kingdoms');setTimeout(()=>editKingdom(),300)}},
    {group:'إجراءات',label:'إضافة خدمة',hint:'الخدمات',icon:'plug',run:()=>{navigate('services');setTimeout(()=>editApi(),300)}},
    {group:'إجراءات',label:'إيقاف أو تشغيل قسم',hint:'التحكم والصيانة',icon:'toggle-left',run:()=>navigate('controls')},
    {group:'إجراءات',label:'إعادة تشغيل البوت',hint:'قطع لحظي',icon:'power',run:()=>$('restart').click()},
    {group:'إجراءات',label:'تحديث البيانات',hint:'',icon:'refresh-cw',run:()=>$('refresh').click()},
    {group:'إجراءات',label:'تسجيل الخروج',hint:'',icon:'log-out',run:()=>$('logout').click()}
  ];
}
let paletteIndex=0,paletteItems=[];
function drawPalette(){
  const q=$('paletteInput').value.trim();
  paletteItems=paletteActions().filter(item=>!q||(item.label+' '+item.hint).includes(q));
  paletteIndex=Math.min(paletteIndex,Math.max(0,paletteItems.length-1));
  const list=$('paletteList');list.replaceChildren();let lastGroup='';
  paletteItems.forEach((item,index)=>{
    if(item.group!==lastGroup){list.append(e('p',item.group,'palette-section'));lastGroup=item.group;}
    const row=e('button',undefined,'palette-item'+(index===paletteIndex?' selected':''));row.type='button';row.setAttribute('role','option');
    row.append(icon(item.icon),e('span',item.label));if(item.hint)row.append(e('small',item.hint));
    row.addEventListener('click',()=>runPalette(index));row.addEventListener('mousemove',()=>{if(paletteIndex!==index){paletteIndex=index;drawPalette()}});
    list.append(row);
  });
  if(!paletteItems.length)list.append(e('p','ما في نتائج','palette-section'));
  paintIcons();list.querySelector('.selected')?.scrollIntoView({block:'nearest'});
}
function openPalette(){if($('app').hidden)return;$('paletteInput').value='';paletteIndex=0;drawPalette();$('palette').showModal();$('paletteInput').focus();}
function runPalette(index){const item=paletteItems[index];if(!item)return;$('palette').close();Promise.resolve(item.run()).catch(showError);}
$('paletteInput').addEventListener('input',()=>{paletteIndex=0;drawPalette()});
$('paletteInput').addEventListener('keydown',event=>{
  if(event.key==='ArrowDown'){event.preventDefault();paletteIndex=(paletteIndex+1)%Math.max(1,paletteItems.length);drawPalette();}
  else if(event.key==='ArrowUp'){event.preventDefault();paletteIndex=(paletteIndex-1+paletteItems.length)%Math.max(1,paletteItems.length);drawPalette();}
  else if(event.key==='Enter'){event.preventDefault();runPalette(paletteIndex);}
});
$('palette').addEventListener('click',event=>{if(event.target===$('palette'))$('palette').close()});
$('openPalette').addEventListener('click',openPalette);$('openPaletteSide').addEventListener('click',openPalette);
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openPalette();}});
$('loginForm').addEventListener('submit',async event=>{event.preventDefault();const submit=event.submitter;submit.disabled=true;$('loginNotice').textContent='';try{csrf=(await request('login','POST',{password:$('password').value})).csrf;$('password').value='';await bootstrap();}catch(error){if(error.code!=='not_connected')$('loginNotice').textContent=error.message;}finally{submit.disabled=false;}});
$('logout').addEventListener('click',()=>request('logout','POST').finally(()=>location.reload()));
$('restart').addEventListener('click',async()=>{if(!confirm('سيتم قطع اتصال واتساب لحظيًا وإعادة تشغيل البوت. هل تريد المتابعة؟'))return;try{await request('restart','POST');toast('بدأت إعادة التشغيل؛ انتظر عودة البوت.');}catch(error){showError(error);}});
$('refresh').addEventListener('click',()=>{templates=[];bootstrap().catch(showError)});
$('scope').addEventListener('change',()=>{page=1;load().catch(showError)});
$('closeEditor').addEventListener('click',()=>$('editor').close());$('cancelEditor').addEventListener('click',()=>$('editor').close());
$('editorForm').addEventListener('submit',async event=>{event.preventDefault();$('saveEditor').disabled=true;$('editorError').textContent='';try{await saveAction();}catch(error){$('editorError').textContent=error.message;}finally{$('saveEditor').disabled=false;}});
section=Object.hasOwn(labels,location.hash.slice(1))?location.hash.slice(1):'overview';paintIcons();
$('pairingLogout').addEventListener('click',()=>request('logout','POST').finally(()=>location.reload()));
bootstrap().catch(error=>{if(error.message!=='يلزم تسجيل الدخول'&&error.code!=='not_connected')$('loginNotice').textContent=error.message;});
