'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('jsdom');
const {build}=require('../tools/build');
const {createGasEnv}=require('./fake-gas');
const root=path.join(__dirname,'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'family-quiz-'));
build({outDir:dir});
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const plain=v=>JSON.parse(JSON.stringify(v));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<6;i++)await tick()}
async function open(t,{storage={},query='',frame=false,fetchDelay=0}={}){
  const errors=[],navigation=[],requests=[],fetchUrls=[];
  const vc=new VirtualConsole();
  vc.on('jsdomError',e=>{if(e.message.includes('navigation'))navigation.push(e);else errors.push(e)});
  const dom=new JSDOM(html,{url:'https://quiz.invalid/'+query,runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    if(frame)Object.defineProperty(w,'self',{value:{}});
    w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
    w.speechSynthesis={cancel(){},getVoices(){return []},speak(){},addEventListener(){}};
    Object.defineProperty(w,'fetch',{configurable:true,set(fn){Object.defineProperty(w,'fetch',{configurable:true,writable:true,value:async(url,options)=>{fetchUrls.push(String(url));if(String(url)==='mock://gas')requests.push(JSON.parse(options.body));if(fetchDelay)await new Promise(r=>w.setTimeout(r,fetchDelay));return fn(url,options)}})}});
    for(const [k,v] of Object.entries(storage))w.localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));
  }});
  t.after(()=>{dom.window.close();assert.deepEqual(errors,[])});await settle();
  const w=dom.window;
  return {w,errors,navigation,requests,fetchUrls,storage:()=>Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]))};
}
function blockingStylesheets(source){
  const active=source.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,'');
  return [...active.matchAll(/<link\b[^>]*>/gi)].filter(([tag])=>/\brel\s*=\s*["']stylesheet["']/i.test(tag)&&!/\bmedia\s*=\s*["']print["']/i.test(tag)).length;
}
function bytesBeforeContent(source){
  const at=source.indexOf('<p class="lead">載入中……');
  return at<0?Infinity:Buffer.byteLength(source.slice(0,at),'utf8');
}

test('T012 G3: measurement baits and nonblocking first content within 64KB',()=>{
  assert.equal(blockingStylesheets('<link rel="stylesheet" href="x">'),1);
  assert.equal(blockingStylesheets('<link rel="stylesheet" href="x" media="print"><noscript><link rel="stylesheet" href="x"></noscript>'),0);
  assert.equal(bytesBeforeContent('<main id="app"></main>'),Infinity);
  assert.equal(bytesBeforeContent('字<p class="lead">載入中……'),3);
  const original=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const [name,source] of [['root',original],['dist',html]]){
    assert.equal(blockingStylesheets(source),0,name+' blocking stylesheets');
    assert.ok(bytesBeforeContent(source)<=64*1024,name+' first content bytes');
    assert.match(source.match(/\bbody\s*\{([^}]+)\}/)[1],/\bline-height\s*:\s*1\.4\s*;/);
  }
});

test('T012 G3: mock boot follows main, static banner precedes it, missing main rejected',()=>{
  const main=html.indexOf('<main id="app">');
  assert.ok(html.indexOf('createGasEnv')>html.indexOf('</main>',main));
  const banner=html.indexOf('假後端示範。家長設定碼：MOCK2345');
  assert.ok(banner>=0&&banner<main);
  assert.throws(()=>build({outDir:dir,html:"const CONFIG={API_URL:'x'};\n<html></html>"}),/app container/);
});

test('T012 G3: home and parent replace skeleton, startup fetches stay mock, one banner',async t=>{
  for(const query of ['', '#parent']){
    const {w,fetchUrls}=await open(t,{query});
    const app=w.document.getElementById('app');
    assert.ok(app.textContent.trim().length>0);
    assert.notEqual(app.textContent.trim(),'載入中……');
    assert.ok(fetchUrls.length>0);
    assert.deepEqual(fetchUrls.filter(url=>url!=='mock://gas'),[]);
    assert.equal(w.document.body.textContent.split('假後端示範。家長設定碼：MOCK2345').length-1,1);
    if(query)assert.ok(w.document.getElementById('parent-page'));
  }
});
function bank(){return {id:'bank-test',title:'測試題庫',updatedAt:100,p1At:100,rec:{q1:{seen:7}},days:{p1:1},summary:{text:'p1'},badge:{earned:[]},concepts:[{id:'c1',text:'加法'}],questions:[{id:'q1',c:'c1',t:'mc',lv:1,q:'一加一？',o:['一','二'],a:'二',why:'測試'}],players:{p2:{rec:{q1:{seen:2}},days:{p2:1},summary:null,badge:{earned:[]},updatedAt:200}}}}

test('T005 build: mock only, CONFIG bait, root clean, every inline script compiles',()=>{
  assert.ok(html.includes('mock://gas'));assert.ok(!html.includes('script.google.com'));
  assert.ok(fs.existsSync(path.join(dir,'zhuyin-tw.txt')));
  assert.throws(()=>build({outDir:dir,html:'<html><script>void 0</script></html>'}),/CONFIG/);
  assert.throws(()=>build({outDir:dir,html:"const CONFIG={API_URL:'x'};\nscript.google.com"}),/endpoint/);
  const original=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(!original.includes('mock://gas'));assert.ok(!original.includes('createGasEnv'));
  for(const [name,source] of [['root',original],['dist',html]])for(const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1],{filename:name});
});

test('T005 mock startup, balances, fixed setup code, reload persistence, empty and slow modes',async t=>{
  const a=await open(t),{w}=a;assert.deepEqual(a.errors,[]);
  assert.equal(w.document.getElementById('player-button').textContent,'🌱');
  assert.ok(w.document.body.textContent.includes('假後端示範。家長設定碼：MOCK2345'));
  const list=await w.api('playerList',{withBalance:true});
  assert.deepEqual(plain(list.players.map(p=>[p.id,p.name,p.balance.silver.available,p.balance.gold.available])),[['p1','小葉子',5,2],['p2','小石頭',1,0]]);
  assert.ok(!JSON.parse(w.localStorage.getItem('players-cache'))[0].balance);
  assert.equal((await w.api('rewardList',{playerId:'p1'})).rewards.length,3);
  const added=await w.api('playerSave',{name:'新玩家',icon:'🦊'});
  const b=await open(t,{storage:a.storage()});assert.ok((await b.w.api('playerList')).players.some(p=>p.id===added.player.id));
  const empty=await open(t,{query:'?mock=empty'});assert.equal((await empty.w.api('rewardList')).rewards.length,0);
  const slow=await open(t,{storage:a.storage(),query:'?mock=slow'});const start=Date.now();await slow.w.api('ping');assert.ok(Date.now()-start>=1450);
  // The mock's fixed code really matches the backend setup hash.
  const status=await w.api('parentSetPin',{setupCode:'MOCK2345',pin:'246810'});assert.equal(status.ok,true);
});

test('T005 A2: form adds, edits nickname/icon; switch waits for queued and active saves',async t=>{
  const {w,errors}=await open(t);await w.playerSheet();
  assert.equal(w.document.querySelectorAll('[data-player-icon]').length,12);
  assert.equal(w.document.getElementById('player-name').placeholder,'不要填真名');
  w.document.getElementById('player-name').value='小星';w.document.querySelector('[data-player-icon="⭐"]').click();
  await w.document.querySelector('#player-form form').onsubmit({preventDefault(){}});
  let p=(await w.api('playerList')).players.find(p=>p.name==='小星');assert.equal(p.icon,'⭐');
  w.document.querySelector(`[data-edit-player="${p.id}"]`).click();w.document.getElementById('player-name').value='小彩虹';w.document.querySelector('[data-player-icon="🌈"]').click();
  await w.document.querySelector('#player-form form').onsubmit({preventDefault(){}});
  p=(await w.api('playerList')).players.find(x=>x.id===p.id);assert.equal(p.name,'小彩虹');assert.equal(p.icon,'🌈');
  w.testBank=bank();w.eval('BANKS=[testBank];scheduleSave(testBank)');
  const fetch=w.fetch;let release;const gate=new Promise(r=>release=r);
  w.fetch=async(url,options)=>{if(JSON.parse(options.body).action==='saveBank')await gate;return fetch(url,options)};
  w.eval('bsSave(testBank);testBank.rec.q1.seen=8;scheduleSave(testBank)');
  const switching=w.switchPlayer('p2');await settle();assert.equal(w.localStorage.getItem('player'),null);
  release();await switching;assert.equal(JSON.parse(w.localStorage.getItem('player')),'p2');
  const cloud=(await w.api('listBanks')).banks[0];assert.equal(cloud.rec.q1.seen,8);assert.deepEqual(errors,[]);
});

test('T005 A2: p2 answers/badges persist under players; p1 survives roundtrip; clean wire',async t=>{
  const a=await open(t,{storage:{player:'"p2"'}}),{w}=a;
  await w.api('saveBank',{bank:bank()});await w.bsLoad();
  assert.equal(w.eval('BANKS[0].rec.q1.seen'),2);
  w.eval('BANKS[0].rec.q1.seen=3;BANKS[0].days={today:2};BANKS[0].summary={text:"p2"};BANKS[0].badge={earned:[{at:Date.now()-100,dark:true}]}');
  await w.eval('bsSave(BANKS[0])');
  const sent=a.requests.filter(r=>r.action==='saveBank').at(-1);
  assert.equal(sent.playerId,'p2');assert.deepEqual(Object.keys(sent.bank.players),['p2']);assert.ok(!JSON.stringify(sent).includes('__p1'));assert.ok(!JSON.stringify(sent).includes('__view'));
  const cloud=(await w.api('listBanks')).banks[0];assert.equal(cloud.rec.q1.seen,7);assert.equal(cloud.players.p2.rec.q1.seen,3);assert.equal(cloud.summary.text,'p1');assert.equal(cloud.players.p2.summary.text,'p2');
  const local=JSON.parse(w.localStorage.getItem('custom-banks'))['bank-test'];assert.equal(local.rec.q1.seen,7);assert.equal(local.players.p2.rec.q1.seen,3);
  assert.equal(w.document.getElementById('player-button').textContent,'🐢');
  const b=await open(t,{storage:{...a.storage(),player:'"p1"'}});await b.w.bsLoad();assert.equal(b.w.eval('BANKS[0].rec.q1.seen'),7);
  await b.w.eval('bsSave(BANKS[0])');const p1send=b.requests.filter(r=>r.action==='saveBank').at(-1);assert.deepEqual(Object.keys(p1send.bank.players),[]);
  assert.equal((await b.w.api('listBanks')).banks[0].players.p2.rec.q1.seen,3);
  await w.badgeSync();assert.equal(a.requests.filter(r=>r.action==='badges').at(-1).playerId,'p2');
});

test('T005 scopeKey: all four scoped families, p1 legacy, clearProgress targets active player',async t=>{
  const {w}=await open(t,{storage:{player:'"p2"'}});
  for(const key of ['badges','progress-demo','lib-rec:book','g3plants-rec'])assert.equal(w.scopeKey(key),'p2:'+key);
  for(const key of ['family','ui-style','reader','custom-banks','resume','zy-test'])assert.equal(w.scopeKey(key),key);
  w.localStorage.setItem('progress-demo','{}');w.localStorage.setItem('p2:progress-demo','{}');w.clearProgress({key:'demo'});
  assert.equal(w.localStorage.getItem('p2:progress-demo'),null);assert.equal(w.localStorage.getItem('progress-demo'),'{}');
  const p1=await open(t);assert.equal(p1.w.scopeKey('badges'),'badges');
});

test('T005 A4: successful list prunes missing pid keys only; failure prunes nothing',async t=>{
  const base={player:'"p2"','p2:badges-dirty':'0','pdead:badges':'{}','pdead:lib-rec:x':'{}','p2:badges':'{}',badges:'{}','progress-demo':'{}'};
  const a=await open(t,{storage:base});assert.equal(a.w.localStorage.getItem('pdead:badges'),null);assert.equal(a.w.localStorage.getItem('pdead:lib-rec:x'),null);
  for(const k of ['p2:badges','badges','progress-demo'])assert.equal(a.w.localStorage.getItem(k),'{}');
  const b=await open(t,{storage:base,query:'?mock=offline'});for(const [k,v] of Object.entries(base))assert.equal(b.w.localStorage.getItem(k),v);
  await b.w.playerSheet();assert.ok(b.w.document.getElementById('player-message').textContent.includes('連不到雲端'));
});

test('T005 reader mode: p1 scope, no player button or playerId on badges',async t=>{
  const seed=await open(t);
  const reader=(await seed.w.api('readerCreate',{note:'測試閱讀'})).reader;
  const {w,requests}=await open(t,{storage:{...seed.storage(),player:'"p2"',reader:{code:reader,name:'閱讀'}}});
  assert.equal(w.scopeKey('badges'),'badges');assert.equal(w.document.getElementById('player-button'),null);
  await w.badgeSync();const sent=requests.find(r=>r.action==='badges');assert.ok(sent);assert.ok(!('playerId' in sent));
});

test('T005 adversarial offline p2 save preserves full p1 backup; reload keeps p2 view',async t=>{
  const b=bank();const {w,errors}=await open(t,{query:'?mock=offline',storage:{player:'"p2"','custom-banks':{[b.id]:b}}});
  await w.bsLoad();w.eval('BANKS[0].rec.q1.seen=99');await w.eval('bsSave(BANKS[0])');
  const saved=JSON.parse(w.localStorage.getItem('custom-banks'))[b.id];assert.deepEqual(saved.rec,b.rec);assert.equal(saved.players.p2.rec.q1.seen,99);assert.ok(!('__view' in saved));assert.ok(!('__p1' in saved));
  await w.bsLoad();assert.equal(w.eval('BANKS[0].rec.q1.seen'),99);assert.deepEqual(errors,[]);
});

test('T005 stale local metadata must not hide newer cloud p1 or other players',async t=>{
  const a=await open(t,{storage:{player:'"p2"'}}),{w}=a;
  const cloud=bank();cloud.p1At=500;cloud.rec.q1.seen=20;cloud.players.p2.updatedAt=600;cloud.players.p2.rec.q1.seen=30;
  await w.api('saveBank',{bank:cloud});
  const local=bank();local.updatedAt=900;local.title='本機新標題';
  w.localStorage.setItem('custom-banks',JSON.stringify({[local.id]:local}));await w.bsLoad();
  assert.equal(w.eval('BANKS[0].rec.q1.seen'),30);assert.equal(w.eval('BANKS[0].__p1.rec.q1.seen'),20);
  const sent=a.requests.filter(r=>r.action==='saveBank').at(-1);assert.equal(sent.bank.rec.q1.seen,7);assert.equal(sent.bank.players.p2.rec.q1.seen,2);assert.ok(!('__view' in sent.bank));
  const cached=JSON.parse(w.localStorage.getItem('custom-banks'))[local.id];assert.equal(cached.rec.q1.seen,20);assert.equal(cached.players.p2.rec.q1.seen,30);
});

test('T005 fake snapshot preserves dates, formats, properties and cache across JSON reload',()=>{
  const env=createGasEnv();env.run('setup');env.props.setProperty('demo','value');env.cache.put('demo','cached');
  const sh=env.sheets.get('玩家');sh.appendRow(['TEST-0000','p2','x','🌱',1,'啟用',new Date(1234),new Date(5678),'']);sh.getRange(2,3).setNumberFormat('@');
  const snapshot=JSON.parse(JSON.stringify(env.snapshot()));const copy=createGasEnv();copy.restore(snapshot);
  assert.ok(copy.sheets.get('玩家').data[1][6] instanceof Date);assert.equal(copy.sheets.get('玩家').data[1][6].getTime(),1234);assert.equal(copy.sheets.get('玩家').formats.get('2,3'),'@');assert.equal(copy.props.getProperty('demo'),'value');assert.equal(copy.cache.get('demo'),'cached');
  assert.deepEqual(copy.snapshot(),env.snapshot());
});

test('T005 disabled rows are hidden; rejected/removed active players reload as p1 with notice',async t=>{
  const first=await open(t);const fetch=first.w.fetch;
  first.w.fetch=async(url,options)=>{
    const res=await fetch(url,options);if(JSON.parse(options.body).action!=='playerList')return res;
    const j=await res.json();j.players.find(p=>p.id==='p2').status='停用';return {json:async()=>j};
  };
  await first.w.playerSheet();const picks=first.w.document.querySelectorAll('[data-player]');assert.ok(![...picks].some(p=>p.dataset.player==='p2'));assert.ok(picks[0].textContent.includes('使用中'));
  assert.equal(first.w.document.querySelector('[data-edit-player="p2"]'),null);
  for(const code of ['player_disabled','bad_player'])for(const action of ['saveBank','badges']){
    const a=await open(t,{storage:{player:'"p2"'}}),{w}=a;
    w.fetch=async()=>({json:async()=>({ok:false,code})});
    if(action==='badges')await w.badgeSync();else {w.testBank=bank();w.eval('applyView(testBank)');await w.eval('bsSave(testBank)')}
    assert.equal(JSON.parse(w.localStorage.getItem('player')),'p1');assert.equal(JSON.parse(w.localStorage.getItem('player-notice')),'這位玩家已被家長停用，先切回 小葉子');assert.ok(a.navigation.length>=1);
  }
  for(const absent of [false,true]){
    const a=await open(t,{storage:{player:'"p2"'}}),{w}=a;const fetch=w.fetch;
    w.fetch=async(url,options)=>{const res=await fetch(url,options);const j=await res.json();if(absent)j.players=j.players.filter(p=>p.id!=='p2');else j.players.find(p=>p.id==='p2').status='停用';return {json:async()=>j}};
    await w.refreshPlayers();assert.equal(JSON.parse(w.localStorage.getItem('player')),'p1');assert.ok(a.navigation.length>=1);
  }
});

test('T005 reader entry reloads to p1 scope; leaving reader restores saved family player',async t=>{
  const a=await open(t,{storage:{player:'"p2"'}});const reader=(await a.w.api('readerCreate',{note:'閱讀'})).reader;
  const msg=a.w.document.createElement('p');await a.w.verifyReader(reader,msg);assert.ok(a.navigation.length>=1);
  const b=await open(t,{storage:a.storage()});assert.equal(b.w.scopeKey('badges'),'badges');assert.equal(b.w.document.getElementById('player-button'),null);
  b.w.codePage();await b.w.document.getElementById('rcclr').onclick();assert.ok(b.navigation.length>=1);
  const c=await open(t,{storage:b.storage()});assert.equal(c.w.scopeKey('badges'),'p2:badges');assert.equal(c.w.document.getElementById('player-button').textContent,'🐢');
});

test('T005 player clocks sync offline answers even when cloud metadata is newer',async t=>{
  const {w,requests}=await open(t,{storage:{player:'"p2"'}});
  const third=(await w.api('playerSave',{name:'另一位',icon:'🦊'})).player.id;
  const cloud=bank();cloud.updatedAt=900;cloud.title='雲端新題目';cloud.players[third]={rec:{q1:{seen:60}},updatedAt:700};
  await w.api('saveBank',{bank:cloud});
  const local=bank();local.updatedAt=600;local.players.p2.updatedAt=600;local.players.p2.rec.q1.seen=40;local.players[third]={rec:{q1:{seen:1}},updatedAt:100};
  w.localStorage.setItem('custom-banks',JSON.stringify({[local.id]:local}));await w.bsLoad();
  const saved=(await w.api('listBanks')).banks[0];assert.equal(saved.title,'雲端新題目');assert.equal(saved.rec.q1.seen,7);assert.equal(saved.players.p2.rec.q1.seen,40);assert.equal(saved.players[third].rec.q1.seen,60);
  assert.equal(w.eval('BANKS[0].rec.q1.seen'),40);
  const wire=requests.filter(r=>r.action==='saveBank').at(-1);assert.deepEqual(Object.keys(wire.bank.players),['p2']);
  w.eval('applyView(BANKS[0])');assert.equal(w.eval('BANKS[0].__p1.rec.q1.seen'),7);
  assert.equal(w.eval('toWire(BANKS[0],true).players.p2.updatedAt'),600);
});

test('T005 legacy p1 clock survives p2 save; new p2 view starts empty',async t=>{
  const {w}=await open(t,{storage:{player:'"p2"'}});const b=bank();delete b.p1At;delete b.players;
  await w.api('saveBank',{bank:b});await w.bsLoad();assert.deepEqual(plain(w.eval('BANKS[0].rec')),{});
  w.eval('BANKS[0].rec={q1:{seen:1}}');await w.eval('bsSave(BANKS[0])');const saved=(await w.api('listBanks')).banks[0];
  assert.equal(saved.p1At,100);assert.equal(saved.rec.q1.seen,7);assert.equal(saved.players.p2.rec.q1.seen,1);
});

test('T006 regression: cloud-only banks never cached or resurrected; local originals updated',async t=>{
  const {w,requests}=await open(t);const b=bank();await w.api('saveBank',{bank:b});
  await w.bsLoad();assert.ok(!JSON.parse(w.localStorage.getItem('custom-banks')||'{}')[b.id]);
  await w.api('deleteBank',{id:b.id});requests.length=0;await w.bsLoad();
  assert.ok(!requests.some(r=>r.action==='saveBank'&&r.bank.id===b.id));
  w.localStorage.setItem('custom-banks',JSON.stringify({[b.id]:b}));b.updatedAt=900;b.title='雲端更新';await w.api('saveBank',{bank:b});await w.bsLoad();
  assert.equal(JSON.parse(w.localStorage.getItem('custom-banks'))[b.id].title,'雲端更新');
});

test('T006 startup balance opt-in and homepage visibility',async t=>{
  const a=await open(t);const startup=a.requests.filter(r=>r.action==='playerList');assert.ok(startup.length);assert.ok(startup.every(r=>!('withBalance' in r)));
  assert.equal(a.w.document.getElementById('rewards-home').textContent,'🎁 獎勵兌換');await a.w.playerSheet();assert.equal(a.requests.filter(r=>r.action==='playerList').at(-1).withBalance,true);
  a.w.eval("READER={code:'reader',name:'x'};LIB=[]");await a.w.libHome();assert.equal(a.w.document.getElementById('rewards-home'),null);
  a.w.eval("READER={code:''};FAMILY={code:''}");await a.w.libHome();assert.equal(a.w.document.getElementById('rewards-home'),null);
});

async function parent(w){return (await w.api('parentSetPin',{setupCode:'MOCK2345',pin:'246810'})).session}

const disabledNotice='這位玩家已被家長停用，先切回 小葉子';
function assertPlayerFallback(a){
  assert.equal(JSON.parse(a.w.localStorage.getItem('player')),'p1');
  assert.equal(JSON.parse(a.w.localStorage.getItem('player-notice')),disabledNotice);
  assert.equal(JSON.parse(a.w.localStorage.getItem('resume')),null);
  assert.ok(a.navigation.length>=1);
}
function practice(w,group=false){
  w.HTMLElement.prototype.scrollIntoView=function(){};
  const b=bank();b.rec={};b.badge={cells:[],ok:[0,0,0],earned:[]};
  b.questions=[...Array.from({length:3},(_,i)=>({...b.questions[0],id:'q'+(i+1)}))];
  if(group){b.passages=[{id:'passage',title:'測試文章',text:'一加一是二。'}];b.questions.slice(0,2).forEach(q=>q.p='passage')}
  w.practiceBank=b;w.eval('CTX=bankCtx(practiceBank);start(practiceBank.questions)');
}
function gradePractice(w,group=false){
  if(group){
    w.document.querySelectorAll('.opt[data-v="二"]').forEach(b=>b.click());
    w.document.getElementById('gok').onclick();
  }else {const btn=w.document.querySelector('.opt[data-v="二"]');btn.onclick()}
  assert.ok(w.document.getElementById('nx'));
}

test('T011 A3 a: disabled player hidden, restored identity and badge balances preserved',async t=>{
  const {w}=await open(t),session=await parent(w);
  const before=(await w.api('playerList',{withBalance:true})).players.find(p=>p.id==='p2');
  await w.api('playerDisable',{session,playerId:'p2'});await w.playerSheet();
  assert.equal(w.document.querySelector('[data-player="p2"]'),null);
  assert.equal(w.document.querySelector('[data-edit-player="p2"]'),null);
  await w.api('playerRestore',{session,playerId:'p2'});await w.playerSheet();
  const pick=w.document.querySelector('[data-player="p2"]');assert.ok(pick);assert.equal(pick.disabled,false);
  assert.ok(w.document.querySelector('[data-edit-player="p2"]'));
  const after=(await w.api('playerList',{withBalance:true})).players.find(p=>p.id==='p2');
  assert.equal(after.name,before.name);assert.equal(after.icon,before.icon);assert.deepEqual(plain(after.balance),plain(before.balance));
  assert.ok(pick.textContent.includes(`銀 ${before.balance.silver.available}・金 ${before.balance.gold.available}`));
});

test('T011 A3 b: reload detects disabled p2 and keeps local player keys',async t=>{
  const a=await open(t,{storage:{player:'"p2"','p2:badges':{earned:[]},'p2:any-custom-key':'保留'}});
  const session=await parent(a.w);await a.w.api('playerDisable',{session,playerId:'p2'});
  const b=await open(t,{storage:a.storage()});assertPlayerFallback(b);
  for(const [k,v] of Object.entries(a.storage()).filter(([k])=>k.startsWith('p2:')))assert.equal(b.storage()[k],v);
  assert.equal(b.requests.filter(r=>r.action==='playerList').length,1);
  const c=await open(t,{storage:b.storage()});assert.ok(c.w.document.body.textContent.includes(disabledNotice));
  assert.equal(JSON.parse(c.w.localStorage.getItem('player-notice')),'');
});

test('T011 A3 c: returning to libHome detects disabled p2 and clears resume',async t=>{
  const a=await open(t,{storage:{player:'"p2"'}}),{w}=a,session=await parent(w);
  await w.api('playerDisable',{session,playerId:'p2'});
  w.localStorage.setItem('resume',JSON.stringify({p:'plantai',t:Date.now()}));
  await w.libHome();await settle();assertPlayerFallback(a);
});

for(const group of [false,true])test(`T011 A3 d: ${group?'gradeGroup':'answer'} blocks next question after disable and retains every pXX key`,async t=>{
  const a=await open(t,{storage:{player:'"p2"','p2:any-custom-key':'保留','p2:lib-rec:book':{seen:2}}}),{w}=a;
  const session=await parent(w);practice(w,group);
  await w.api('playerDisable',{session,playerId:'p2'});gradePractice(w,group);
  const pos=w.eval('S.pos'),keys=Object.fromEntries(Object.entries(a.storage()).filter(([k])=>/^p[a-z0-9]+:/.test(k)));
  assert.ok(Object.keys(keys).includes('p2:progress-bank-test'));
  w.localStorage.setItem('resume',JSON.stringify({p:'plantai',t:Date.now()}));
  const nx=w.document.getElementById('nx');await nx.onclick();
  assert.equal(w.eval('S.pos'),pos);assert.equal(w.document.getElementById('nx'),nx);
  assertPlayerFallback(a);
  for(const [k,v] of Object.entries(keys))assert.equal(a.storage()[k],v,k);
});

test('T011 A3 e: offline playerList allows next question without switching',async t=>{
  const a=await open(t,{storage:{player:'"p2"'}}),{w}=a;practice(w);
  const fetch=w.fetch;let checks=0;
  w.fetch=async(u,o)=>{if(JSON.parse(o.body).action==='playerList'){checks++;throw Error('offline')}return fetch(u,o)};
  gradePractice(w);await w.document.getElementById('nx').onclick();
  assert.equal(checks,1);assert.equal(w.eval('S.pos'),1);assert.equal(JSON.parse(w.localStorage.getItem('player')),'p2');assert.equal(a.navigation.length,0);
});

test('T011 A3 e: playerList timeout allows next question without switching',async t=>{
  const a=await open(t,{storage:{player:'"p2"'}}),{w}=a;practice(w);
  const fetch=w.fetch;w.fetch=(u,o)=>JSON.parse(o.body).action==='playerList'?new Promise(()=>{}):fetch(u,o);
  gradePractice(w);const start=Date.now();await w.document.getElementById('nx').onclick();
  assert.ok(Date.now()-start>=2900);assert.equal(w.eval('S.pos'),1);
  assert.equal(JSON.parse(w.localStorage.getItem('player')),'p2');assert.equal(a.navigation.length,0);
});

test('T011 A3 f: p1 returns home and advances synchronously without extra playerList',async t=>{
  const a=await open(t),{w}=a,count=a.requests.filter(r=>r.action==='playerList').length;
  await w.libHome();await settle();practice(w);gradePractice(w);
  const result=w.document.getElementById('nx').onclick();assert.equal(result,undefined);assert.equal(w.eval('S.pos'),1);
  assert.equal(a.requests.filter(r=>r.action==='playerList').length,count);assert.equal(a.navigation.length,0);
});

test('T011 A3 g: parent management still lists disabled p2 with restore button',async t=>{
  const {w}=await parentUI(t),session=w.eval('PARENT_SESSION');
  await w.api('playerDisable',{session,playerId:'p2'});await w.parentMain('players');
  const row=w.document.querySelector('[data-manage-player="p2"]');assert.ok(row);assert.ok(row.textContent.includes('停用'));
  assert.ok(row.querySelector('[data-player-action="playerRestore"]'));
});

async function newReward(w,session,reward){return (await w.api('rewardSave',{session,reward})).reward.id}
const text=w=>w.document.getElementById('reward-page').textContent;
const clickApply=(w,id)=>w.document.querySelector('[data-apply="'+id+'"]').click();
async function sendSheet(w){await w.document.getElementById('reward-send').onclick()}

test('T006 D1: three costs, wallet, backend reasons, unlimited and gold substitution',async t=>{
  const {w}=await open(t);await w.rewardPage();
  assert.deepEqual([...w.document.querySelectorAll('.reward-card')].map(c=>c.querySelector('div').textContent),['需要 銀 2','需要 金 1','需要 銀 3・金 1']);
  assert.equal(w.document.querySelectorAll('.reward-pot').length,2);assert.equal(w.document.querySelectorAll('.reward-pot span:last-child')[0].textContent,'保留 0');
  const token=await parent(w);
  const gold3=await newReward(w,token,{name:'金不足',silver:0,gold:3,weeklyLimit:0});
  const sub=await newReward(w,token,{name:'金抵銀',silver:6,gold:0,weeklyLimit:1,goldForSilver:true});
  await w.rewardPage();assert.ok(text(w).includes('還差金 1'));assert.equal(w.document.querySelector('[data-apply="'+gold3+'"]').disabled,true);
  const card=w.document.querySelector('[data-apply="'+gold3+'"]').closest('article');assert.ok(!card.textContent.includes('本週剩'));
  assert.ok(text(w).includes('銀不夠的 1 枚會用金補'));
  clickApply(w,sub);await sendSheet(w);await w.rewardPage();assert.ok(text(w).includes('下週一再來'));assert.equal(w.document.querySelector('[data-apply="'+sub+'"]').disabled,true);
});

test('T006 D2 D9: reserve/cancel actual silver and gold, no balance cache',async t=>{
  const {w}=await open(t);const token=await parent(w);const sub=await newReward(w,token,{name:'抵銀',silver:6,gold:0,goldForSilver:true,weeklyLimit:0,enabled:true});
  await w.rewardPage();clickApply(w,sub);assert.ok(w.document.querySelector('.reward-sheet').textContent.includes('會先保留 銀 5・金 1'));await sendSheet(w);
  assert.ok(text(w).includes('已送出，等家長核准'));assert.deepEqual([...w.document.querySelectorAll('.reward-pot')].map(c=>c.textContent),['銀色可用0保留 5','金色可用1保留 1']);
  await w.rewardPage('mine');assert.ok(text(w).includes('等家長核准'));assert.ok(text(w).includes('保留 銀 5・金 1'));
  w.document.querySelector('[data-cancel]').click();await sendSheet(w);assert.ok(text(w).includes('已取消'));assert.ok(text(w).includes('退回 銀 5・金 1'));
  assert.deepEqual([...w.document.querySelectorAll('.reward-pot')].map(c=>c.textContent),['銀色可用5保留 0','金色可用2保留 0']);
  assert.ok(!JSON.stringify(JSON.parse(w.localStorage.getItem('players-cache'))).includes('balance'));
});

test('T006 D6 XSS: four states, newest first, escaped names/reasons, zero colors omitted',async t=>{
  const {w}=await open(t);const token=await parent(w),ids=[];
  for(let i=0;i<4;i++){
    const id=await newReward(w,token,{name:i===0?'<img src=x>':'狀態'+i,silver:1,gold:0,weeklyLimit:0,enabled:true});
    const j=await w.api('redeemRequest',{rewardId:id,requestId:w.rewardRequestId()});ids.push(j.redeem.id);
    if(i===1)await w.api('redeemDecide',{session:token,id:j.redeem.id,decision:'approve'});
    if(i===2)await w.api('redeemDecide',{session:token,id:j.redeem.id,decision:'reject',reason:'<b>原因</b>'});
    if(i===3)await w.api('redeemCancel',{id:j.redeem.id});
    await new Promise(r=>setTimeout(r,2));
  }
  await w.rewardPage('mine');for(const s of ['等家長核准','已核准','被拒絕','已取消','家長說：<b>原因</b>','用掉 銀 1','退回 銀 1'])assert.ok(text(w).includes(s),s);
  assert.equal(w.document.querySelector('.reward-list h2').textContent,'狀態3');assert.ok(text(w).includes('<img src=x>'));assert.equal(w.document.querySelector('#reward-list img,#reward-list b'),null);
  assert.equal(w.document.querySelectorAll('#reward-list .reward-gold').length,0);
  const fetch=w.fetch;w.fetch=async(u,o)=>{const j=await (await fetch(u,o)).json();if(JSON.parse(o.body).action==='rewardList')j.rewards[0].name='<img src=x onerror=alert(1)>';return {json:async()=>j}};
  await w.rewardPage();assert.ok(text(w).includes('<img src=x onerror=alert(1)>'));assert.equal(w.document.querySelector('#reward-list img'),null);
});

test('T006 D3: double send, lost response manual retry and busy retry retain UUID',async t=>{
  const {w}=await open(t);await w.rewardPage();const fetch=w.fetch,sent=[];let release;
  const gate=new Promise(r=>release=r);
  w.fetch=async(u,o)=>{const r=JSON.parse(o.body);if(r.action==='redeemRequest'){sent.push(r);await gate;const res=await fetch(u,o);if(sent.length===1)throw Error('lost response');return res}return fetch(u,o)};
  clickApply(w,'mock-s');const send=w.document.getElementById('reward-send');const first=send.onclick();const second=send.onclick();assert.equal(sent.length,1);assert.equal(send.disabled,true);assert.equal(w.document.getElementById('reward-send'),null);release();await Promise.all([first,second]);
  assert.ok(text(w).includes('送出失敗，請再試一次'));clickApply(w,'mock-s');await sendSheet(w);assert.equal(sent.length,2);assert.equal(sent[0].requestId,sent[1].requestId);assert.match(sent[0].requestId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal((await w.api('myRedeems')).redeems.length,1);
  const busy=[];w.fetch=async(u,o)=>{const r=JSON.parse(o.body);if(r.action==='redeemRequest'){busy.push(r);if(busy.length===1)return {json:async()=>({ok:false,code:'busy'})}}return fetch(u,o)};
  clickApply(w,'mock-g');await sendSheet(w);assert.equal(busy.length,2);assert.equal(busy[0].requestId,busy[1].requestId);
  Object.defineProperty(w.crypto,'randomUUID',{value:undefined});assert.match(w.rewardRequestId(),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('T006 G2: slow skeleton, offline without numbers or apply, empty rewards',async t=>{
  const a=await open(t,{query:'?mock=slow'});const loading=a.w.rewardPage();assert.equal(a.w.document.querySelectorAll('.reward-skeleton').length,3);assert.equal(a.w.document.querySelectorAll('[data-apply]').length,0);await loading;
  const b=await open(t,{query:'?mock=offline'});await b.w.rewardPage();assert.ok(text(b.w).includes('連不到雲端，現在不能申請'));assert.equal(b.w.document.querySelector('#reward-wallet').textContent,'');assert.equal(b.w.document.querySelectorAll('[data-apply]').length,0);assert.ok(b.w.document.getElementById('reward-retry'));
  const c=await open(t,{query:'?mock=empty'});await c.w.rewardPage();assert.ok(text(c.w).includes('還沒有獎勵，請家長新增'));
});

test('T006 race: late rewardList or myRedeems cannot replace active tab or homepage',async t=>{
  const {w}=await open(t);const fetch=w.fetch;let release;const gate=new Promise(r=>release=r);let count=0;
  w.fetch=async(u,o)=>{if(JSON.parse(o.body).action==='rewardList'&&++count===1)await gate;return fetch(u,o)};
  const old=w.rewardPage();await settle();await w.rewardPage('mine');release();await old;
  assert.equal(w.document.querySelector('[aria-selected=true]').textContent,'我的申請');assert.ok(text(w).includes('還沒有申請'));
  let releaseMine;const gateMine=new Promise(r=>releaseMine=r);w.fetch=async(u,o)=>{if(JSON.parse(o.body).action==='rewardList')await gateMine;return fetch(u,o)};
  const pending=w.rewardPage('mine');await settle();await w.libHome();releaseMine();await pending;assert.equal(w.document.getElementById('reward-page'),null);assert.ok(w.document.getElementById('rewards-home'));
});

test('T006 server rejections refresh with plain messages; cancellation conflict; disabled fallback',async t=>{
  const {w,requests}=await open(t);const fetch=w.fetch;
  for(const [code,message] of [['insufficient','後端不足'],['quota','後端額度'],['reward_disabled','這個獎項剛剛停用了'],['not_found','找不到這個獎項，請重新整理']]){
    w.fetch=fetch;await w.rewardPage();clickApply(w,'mock-s');const count=requests.filter(r=>r.action==='rewardList').length;
    w.fetch=async(u,o)=>JSON.parse(o.body).action==='redeemRequest'?{json:async()=>({ok:false,code,reason:message})}:fetch(u,o);
    await sendSheet(w);assert.ok(text(w).includes(message));assert.ok(requests.filter(r=>r.action==='rewardList').length>count);assert.equal(w.document.querySelector('.reward-dialog'),null);
  }
  w.fetch=fetch;await w.api('redeemRequest',{rewardId:'mock-s',requestId:w.rewardRequestId()});await w.rewardPage('mine');w.document.querySelector('[data-cancel]').click();
  w.fetch=async(u,o)=>JSON.parse(o.body).action==='redeemCancel'?{json:async()=>({ok:false,code:'conflict'})}:fetch(u,o);
  await sendSheet(w);assert.ok(text(w).includes('家長剛剛已經決定了'));
  const b=await open(t,{storage:{player:'"p2"'}});await b.w.rewardPage();const f=b.w.fetch;
  // p2 cannot afford the seeded rewards: use a one-silver offer from the real fake backend.
  const token=await parent(b.w);const id=await newReward(b.w,token,{name:'一枚',silver:1,gold:0,weeklyLimit:0});await b.w.rewardPage();clickApply(b.w,id);
  b.w.fetch=async(u,o)=>JSON.parse(o.body).action==='redeemRequest'?{json:async()=>({ok:false,code:'player_disabled'})}:f(u,o);
  await sendSheet(b.w);assert.equal(JSON.parse(b.w.localStorage.getItem('player')),'p1');assert.ok(b.navigation.length);
});

async function parentRoute(w){w.location.hash='parent';await settle()}

test('T014 player sheet closes on parent route and PIN keypad responds',async t=>{
  const {w}=await open(t);
  await w.api('parentSetPin',{setupCode:'MOCK2345',pin:'246810'});
  await w.playerSheet();assert.ok(w.document.getElementById('player-sheet'));
  await parentRoute(w);
  assert.equal(w.document.getElementById('player-sheet'),null);
  await typePin(w,'2');
  assert.equal(w.document.querySelectorAll('.parent-dots .filled').length,1);
});

test('T014 player sheet closes on other hash routes',async t=>{
  const {w}=await open(t);
  await w.playerSheet();assert.ok(w.document.getElementById('player-sheet'));
  w.location.hash='x';await settle();
  assert.equal(w.document.getElementById('player-sheet'),null);
});

test('T014 libHome directly closes the player sheet',async t=>{
  const {w}=await open(t);
  await w.playerSheet();assert.ok(w.document.getElementById('player-sheet'));
  await w.libHome();
  assert.equal(w.document.getElementById('player-sheet'),null);
});

test('T014 overlay cleanup is safe without a sheet and preserves focus',async t=>{
  const {w}=await open(t);
  const button=w.document.getElementById('player-button');button.focus();
  assert.doesNotThrow(()=>{w.closePlayerSheet();w.closeChildOverlays()});
  assert.equal(w.document.activeElement,button);
});

test('T014 parent route cancels confirmation promises and empties MODALS',async t=>{
  const {w}=await open(t);
  const first=w.confirmBox('測試確認'),second=w.confirmBox('第二個確認');
  assert.equal(w.document.querySelectorAll('.modal').length,2);
  await parentRoute(w);
  assert.equal(w.document.querySelector('.modal'),null);
  assert.deepEqual(await Promise.all([first,second]),[false,false]);
  assert.equal(w.eval('MODALS.length'),0);
});

test('T014 other hash routes cancel confirmation and empty MODALS',async t=>{
  const {w}=await open(t);
  const confirmation=w.confirmBox('測試確認');
  assert.ok(w.document.querySelector('.modal'));
  w.location.hash='x';await settle();
  assert.equal(w.document.querySelector('.modal'),null);
  assert.equal(await confirmation,false);
  assert.equal(w.eval('MODALS.length'),0);
});

test('T014 parentPage directly closes the player sheet on the parent route',async t=>{
  const {w}=await open(t,{query:'#parent'});
  await w.playerSheet();assert.ok(w.document.getElementById('player-sheet'));
  await w.parentPage();
  assert.equal(w.location.hash,'#parent');
  assert.equal(w.document.getElementById('player-sheet'),null);
});

test('T014 delayed forced tour does not open on parent route',async t=>{
  const {w}=await open(t);
  const setTimeout=w.setTimeout;let delayed;
  w.setTimeout=(fn,ms,...args)=>ms===350?(delayed=fn,0):setTimeout(fn,ms,...args);
  // Supply a visible step: jsdom normally reports no client rects for any node.
  w.eval('tourSteps=()=>[{node:document.body,title:"測試",text:"導覽"}]');
  w.runTour('lib',true);w.setTimeout=setTimeout;
  assert.equal(typeof delayed,'function');
  await parentRoute(w);
  delayed();
  assert.equal(w.document.getElementById('tour-block'),null);
  assert.equal(w.eval('MODALS.length'),0);
});

async function setupParentUI(w,pin='246810',code='MOCK2345',repeat=pin){
  w.document.getElementById('parent-code').value=code;
  w.document.getElementById('parent-new-pin').value=pin;
  w.document.getElementById('parent-repeat-pin').value=repeat;
  await w.document.querySelector('#parent-setup').onsubmit({preventDefault(){}});await settle();
}
async function parentUI(t,options){const a=await open(t,options);await parentRoute(a.w);await setupParentUI(a.w);return a}
async function typePin(w,pin,confirm=false){for(const n of pin)w.document.querySelector(`[data-pin-key="${n}"]`).click();if(confirm)w.document.querySelector('[data-pin-key="確定"]').click();await settle()}
const ptext=w=>w.document.getElementById('parent-page')?.textContent||'';
function pinKey(w,key,target=w.document,options={}){
  const e=new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options});
  target.dispatchEvent(e);return e;
}
function pinKeys(w,digits){for(const key of digits)pinKey(w,key)}
const pinDots=w=>w.document.querySelectorAll('.parent-dots .filled').length;

test('T016 pinKeyAction follows key, modifier, editable, button and repeat rules',async t=>{
  const {w}=await open(t),d=w.document;
  const cases=[...['0','5','9'].map(key=>[{key},'digit']),
    ...['a','!','Tab','Escape',' '].map(key=>[{key},null]),
    [{key:'Backspace'},'back'],[{key:'Enter',target:d.body},'enter'],
    ...['ctrlKey','altKey','metaKey','isComposing'].map(flag=>[{key:'1',[flag]:true},null]),
    [{key:'1',target:d},'digit'],[{key:'1',repeat:true},null],
    [{key:'Enter',repeat:true},null],[{key:'Backspace',repeat:true},'back']];
  for(const tag of ['input','textarea','select'])cases.push([{key:'1',target:d.createElement(tag)},null]);
  for(const [value,expected] of [['',null],['true',null],['false','digit']]){
    const el=d.createElement('div');el.setAttribute('contenteditable',value);
    const child=d.createElement('span');el.append(child);cases.push([{key:'1',target:child},expected]);
  }
  for(const isPin of [true,false]){
    const button=d.createElement('button'),child=d.createElement('span');button.append(child);
    if(isPin)button.setAttribute('data-pin-key','2');
    cases.push([{key:'Enter',target:child},isPin?'enter':null]);
  }
  for(const [event,expected] of cases)assert.equal(w.pinKeyAction(event),expected,event.key);
});

test('T016 unlock six digits once, keep PIN private, ignore keys after main and home',async t=>{
  const {w,requests}=await parentUI(t);w.parentLock();await settle();
  pinKeys(w,'24681');assert.equal(pinDots(w),5);
  assert.ok(!w.document.documentElement.outerHTML.includes('24681'));
  pinKey(w,'0');await settle();
  assert.ok(w.document.querySelector('[data-parent-tab="pending"]'));
  assert.equal(requests.filter(r=>r.action==='parentLogin').length,1);
  assert.equal(pinKey(w,'2').defaultPrevented,false);
  w.document.querySelector('#parent-exit').click();await settle();
  assert.equal(pinKey(w,'2').defaultPrevented,false);
  assert.equal(requests.filter(r=>r.action==='parentLogin').length,1);
});

test('T016 four digit Enter login, three digits cannot submit, keypad focus Enter submits once',async t=>{
  const {w,requests}=await open(t);await parentRoute(w);await setupParentUI(w,'2486');
  w.parentLock();await settle();pinKeys(w,'248');pinKey(w,'Enter');await settle();
  assert.equal(requests.filter(r=>r.action==='parentLogin').length,0);
  const button=w.document.querySelector('[data-pin-key="6"]');button.click();button.focus();
  assert.equal(pinDots(w),4);
  assert.equal(pinKey(w,'Enter',button).defaultPrevented,true);await settle();
  assert.deepEqual(requests.filter(r=>r.action==='parentLogin').map(r=>r.pin),['2486']);
  assert.ok(w.document.querySelector('[data-parent-tab="pending"]'));
});

test('T016 Backspace, cancellation, mixed input and held keys',async t=>{
  const {w,requests}=await parentUI(t);w.parentLock();await settle();
  w.document.querySelector('[data-pin-key="2"]').click();pinKeys(w,'46');assert.equal(pinDots(w),3);
  assert.equal(pinKey(w,'Backspace',w.document,{repeat:true}).defaultPrevented,true);assert.equal(pinDots(w),2);
  assert.equal(pinKey(w,'a').defaultPrevented,false);
  assert.equal(pinKey(w,'4',w.document,{repeat:true}).defaultPrevented,false);
  assert.equal(pinKey(w,'Enter',w.document,{repeat:true}).defaultPrevented,false);
  assert.equal(pinDots(w),2);assert.equal(requests.filter(r=>r.action==='parentLogin').length,0);
  assert.equal(pinKey(w,'6').defaultPrevented,true);assert.equal(pinDots(w),3);
});

test('T016 sending and locked states consume valid keys without more login requests',async t=>{
  const {w,requests}=await parentUI(t);w.parentLock();await settle();
  const fetch=w.fetch;let release;const gate=new Promise(resolve=>release=resolve);
  w.fetch=async(u,o)=>{if(JSON.parse(o.body).action==='parentLogin')await gate;return fetch(u,o)};
  pinKeys(w,'000000');assert.equal(pinKey(w,'1').defaultPrevented,true);
  assert.equal(pinKey(w,'Enter').defaultPrevented,true);assert.equal(pinDots(w),0);
  release();await settle();w.fetch=fetch;
  assert.equal(requests.filter(r=>r.action==='parentLogin').length,1);
  for(let i=0;i<4;i++){pinKeys(w,'000000');await settle()}
  assert.ok(ptext(w).includes('輸入錯太多次'));
  const count=requests.filter(r=>r.action==='parentLogin').length;
  pinKeys(w,'246810');assert.equal(pinKey(w,'Backspace').defaultPrevented,true);pinKey(w,'Enter');await settle();
  assert.equal(pinDots(w),0);assert.equal(requests.filter(r=>r.action==='parentLogin').length,count);
});

test('T016 setup keyboard fills PINs, caps length, deletes repeat first and submits Enter',async t=>{
  const {w,requests}=await open(t);await parentRoute(w);const d=w.document;
  const a=d.querySelector('#parent-new-pin'),b=d.querySelector('#parent-repeat-pin'),code=d.querySelector('#parent-code');
  code.value='MOCK2345';pinKeys(w,'246810');assert.equal(a.value,'246810');assert.equal(b.value,'');
  pinKeys(w,'246810');assert.equal(b.value,'246810');pinKey(w,'9');assert.equal(b.value,'246810');
  assert.equal(code.value,'MOCK2345');assert.ok(!d.documentElement.outerHTML.includes('246810'));
  pinKey(w,'Backspace');assert.equal(b.value,'24681');assert.equal(a.value,'246810');
  for(let i=0;i<6;i++)pinKey(w,'Backspace');assert.equal(b.value,'');assert.equal(a.value,'24681');
  // A partially filled repeat PIN remains the digit target even if the new PIN is short.
  b.value='24';pinKey(w,'6');assert.equal(b.value,'246');assert.equal(a.value,'24681');
  b.value='';pinKey(w,'0');pinKeys(w,'246810');
  assert.equal(pinKey(w,'Enter').defaultPrevented,true);await settle();
  const calls=requests.filter(r=>r.action==='parentSetPin');assert.equal(calls.length,1);
  assert.equal(calls[0].pin,'246810');assert.equal(calls[0].setupCode,'MOCK2345');
  assert.ok(d.querySelector('[data-parent-tab="pending"]'));
});

test('T016 setup editable fields keep native key handling',async t=>{
  const {w,requests}=await open(t);await parentRoute(w);
  const fields=['#parent-code','#parent-new-pin','#parent-repeat-pin'].map(s=>w.document.querySelector(s));
  for(const [i,field] of fields.entries())field.value=['MOCK2345','2468','2468'][i];
  for(const field of fields){
    field.focus();
    for(const key of ['1','Backspace','Enter'])assert.equal(pinKey(w,key,field).defaultPrevented,false);
  }
  assert.deepEqual(fields.map(f=>f.value),['MOCK2345','2468','2468']);
  assert.equal(requests.filter(r=>r.action==='parentSetPin').length,0);
});

test('T016 redraws do not accumulate handlers and modals suppress PIN input',async t=>{
  const {w}=await parentUI(t);
  for(let i=0;i<3;i++){w.parentLock();await settle()}
  pinKey(w,'2');assert.equal(pinDots(w),1);
  const modal=w.confirmBox('測試確認','確定');
  assert.equal(pinKey(w,'4').defaultPrevented,false);assert.equal(pinDots(w),1);
  w.document.querySelector('.modal button').click();await modal;
  pinKey(w,'4');assert.equal(pinDots(w),2);
});

function inputValue(w,selector,value){const el=w.document.querySelector(selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));return el}
async function saveParentReward(w){await w.document.querySelector('#parent-reward-form form').onsubmit({preventDefault(){}});await settle()}

test('T007 setup: validation stays local, wrong code left, weak PIN second submit, pin_exists refresh',async t=>{
  const a=await open(t),{w,requests}=a;await parentRoute(w);
  assert.ok(ptext(w).includes('第一次設定家長 PIN'));
  assert.equal(w.document.querySelector('#parent-code').getAttribute('autocapitalize'),'characters');
  const count=()=>requests.filter(r=>r.action==='parentSetPin').length;
  await setupParentUI(w,'246810','MOCK2345','246811');assert.equal(count(),0);assert.ok(ptext(w).includes('兩次輸入的 PIN 不一樣'));
  await setupParentUI(w,'123','MOCK2345');assert.equal(count(),0);assert.ok(ptext(w).includes('PIN 要 4～6 位數字'));
  await setupParentUI(w,'246810','WRONG');assert.equal(count(),1);assert.ok(ptext(w).includes('設定碼不對，還可以再試 4 次'));
  await setupParentUI(w,'111111');assert.equal(count(),1);assert.ok(ptext(w).includes('這組 PIN 很容易被猜到，建議換一組'));
  await setupParentUI(w,'111111');assert.ok(w.document.querySelector('[data-parent-tab]'));assert.ok(w.eval('PARENT_SESSION'));
  const b=await open(t);await parentRoute(b.w);await b.w.api('parentSetPin',{setupCode:'MOCK2345',pin:'246810'});await setupParentUI(b.w);assert.ok(ptext(b.w).includes('輸入家長 PIN'));assert.equal(b.w.document.querySelector('#parent-setup'),null);
});

test('T007 PIN: six auto, four confirm, dots only, lock at five and no more login requests',async t=>{
  const {w,requests}=await parentUI(t);w.parentLock();await settle();
  assert.equal(w.document.querySelector('.parent-pad').children.length,12);
  assert.equal([...w.document.querySelectorAll('button')].find(b=>b.textContent.includes('Face ID')).disabled,true);
  await typePin(w,'24681');assert.equal(requests.filter(r=>r.action==='parentLogin').length,0);assert.equal(w.document.querySelectorAll('.parent-dots .filled').length,5);
  assert.ok(!w.document.documentElement.outerHTML.includes('24681'));
  await typePin(w,'0');assert.ok(w.document.querySelector('[data-parent-tab]'));
  w.parentLock();await settle();await typePin(w,'0000',true);assert.ok(ptext(w).includes('PIN 不對，還可以再試 4 次'));
  for(let i=0;i<4;i++)await typePin(w,'000000');
  assert.ok(ptext(w).includes('輸入錯太多次，請 15 分鐘後再試'));
  assert.ok([...w.document.querySelectorAll('[data-pin-key]')].every(b=>b.disabled));
  const n=requests.filter(r=>r.action==='parentLogin').length;w.document.querySelector('[data-pin-key="1"]').click();await settle();assert.equal(requests.filter(r=>r.action==='parentLogin').length,n);
  const b=await parentUI(t);b.w.parentLock();await settle();
  // A real four-digit credential uses the same keypad confirmation path.
  const c=await open(t);await parentRoute(c.w);await setupParentUI(c.w,'2486');c.w.parentLock();await settle();await typePin(c.w,'2486',true);assert.ok(c.w.document.querySelector('[data-parent-tab]'));
});

test('T007 B5: memory-only session, hidden clears DOM/logs out; idle reset and no_session lock',async t=>{
  const a=await parentUI(t),{w,requests}=a,token=w.eval('PARENT_SESSION');
  for(const value of [JSON.stringify(a.storage()),JSON.stringify(Object.fromEntries(Object.entries(w.sessionStorage))),w.location.href,w.document.documentElement.outerHTML])assert.ok(!value.includes(token));
  await w.parentMain('players');assert.ok(ptext(w).includes('小石頭'));
  Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'hidden'});w.document.dispatchEvent(new w.Event('visibilitychange'));await settle();
  assert.equal(w.eval('PARENT_SESSION'),null);assert.equal(w.document.querySelector('[data-manage-player]'),null);assert.ok(ptext(w).includes('輸入家長 PIN'));assert.ok(requests.some(r=>r.action==='parentLogout'&&r.session===token));
  Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'visible'});await typePin(w,'246810');
  const set=w.setTimeout,clear=w.clearTimeout;let next=40000;const timers=new Map();w.setTimeout=(fn,ms)=>{if(ms===180000){timers.set(++next,fn);return next}return set(fn,ms)};w.clearTimeout=id=>{timers.delete(id);return clear(id)};
  w.parentActivity();assert.equal(w.eval('PARENT_IDLE_MS'),180000);assert.equal(timers.size,1);const first=[...timers.keys()][0];
  w.document.dispatchEvent(new w.Event('pointerdown'));assert.equal(timers.size,1);assert.ok(!timers.has(first));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'a'}));assert.equal(timers.size,1);[...timers.values()][0]();await settle();assert.equal(w.eval('PARENT_SESSION'),null);
  w.setTimeout=set;w.clearTimeout=clear;await typePin(w,'246810');const fetch=w.fetch;
  w.fetch=async(u,o)=>JSON.parse(o.body).action==='redeemList'?{json:async()=>({ok:false,code:'no_session'})}:fetch(u,o);
  await w.parentMain();await settle();assert.equal(w.eval('PARENT_SESSION'),null);assert.ok(ptext(w).includes('輸入家長 PIN'));
});

test('T007 B5 race: late login and list after lock never restore session or protected DOM',async t=>{
  const {w}=await parentUI(t);w.parentLock();await settle();const fetch=w.fetch;let release;let gate=new Promise(r=>release=r);
  w.fetch=async(u,o)=>{const response=await fetch(u,o);if(JSON.parse(o.body).action==='parentLogin')await gate;return response};
  await typePin(w,'246810');w.parentLock();release();await settle();assert.equal(w.eval('PARENT_SESSION'),null);assert.ok(!w.document.querySelector('[data-parent-tab]'));
  w.fetch=fetch;await typePin(w,'246810');gate=new Promise(r=>release=r);
  w.fetch=async(u,o)=>{const response=await fetch(u,o);if(JSON.parse(o.body).action==='redeemList')await gate;return response};
  const pending=w.parentMain();await settle();w.parentLock();release();await pending;await settle();assert.equal(w.eval('PARENT_SESSION'),null);assert.ok(ptext(w).includes('輸入家長 PIN'));
});

test('T007 C1 D7: reward form ranges/preview, child consistency, edit/disable still visible to parent',async t=>{
  const {w,requests}=await parentUI(t);
  for(const [silver,gold] of [[2,0],[0,1],[1,1]]){
    await w.parentMain('rewards');w.document.querySelector('#parent-add-reward').click();
    assert.equal(w.document.querySelector('#parent-save-reward').disabled,true);
    inputValue(w,'#parent-reward-name',`測試${silver}${gold}`);assert.equal(w.document.querySelector('#parent-save-reward').disabled,true);
    for(const [key,n] of [['silver',silver],['gold',gold]])for(let i=0;i<n;i++)w.document.querySelector(`[data-step="${key}"][data-delta="1"]`).click();
    assert.ok(w.document.querySelector('#parent-preview').textContent.includes('小孩會看到 需要'));
    assert.equal(w.document.querySelector('#parent-substitute').getAttribute('aria-pressed'),'true');
    if(silver){assert.ok(ptext(w).includes('（銀不夠可以用金補）'));w.document.querySelector('#parent-substitute').click();assert.ok(ptext(w).includes('（只收銀，不能用金抵）'))}
    else assert.ok(!w.document.querySelector('#parent-preview').textContent.includes('（'));
    const n=requests.filter(r=>r.action==='rewardSave').length;inputValue(w,'#parent-reward-name',' ');await saveParentReward(w);assert.equal(requests.filter(r=>r.action==='rewardSave').length,n);
    inputValue(w,'#parent-reward-name',`測試${silver}${gold}`);await saveParentReward(w);
    const r=(await w.api('rewardList',{playerId:'p1'})).rewards.find(r=>r.name===`測試${silver}${gold}`);assert.deepEqual([r.silver,r.gold],[silver,gold]);
    await w.rewardPage();const card=[...w.document.querySelectorAll('.reward-card')].find(c=>c.textContent.includes(r.name));assert.ok(card);for(const [color,n] of [['銀',silver],['金',gold]])if(n)assert.ok(card.textContent.includes(color+' '+n));
    await w.parentPage();await w.parentMain('rewards');w.document.querySelector(`[data-edit-reward="${r.id}"]`).click();
    inputValue(w,'#parent-reward-name',r.name+'改');w.document.querySelector('#parent-enabled').click();await saveParentReward(w);
    assert.ok(w.document.querySelector(`[data-edit-reward="${r.id}"]`).closest('article').classList.contains('parent-off'));
    assert.ok(!(await w.api('rewardList',{playerId:'p1'})).rewards.some(x=>x.id===r.id));
  }
  await w.parentMain('rewards');w.document.querySelector('#parent-add-reward').click();
  for(let i=0;i<105;i++)w.document.querySelector('[data-step="silver"][data-delta="1"]').click();assert.equal(w.document.querySelector('[data-value="silver"]').textContent,'99');
  for(let i=0;i<18;i++)w.document.querySelector('[data-step="weeklyLimit"][data-delta="1"]').click();assert.equal(w.document.querySelector('[data-value="weeklyLimit"]').textContent,'14');
});

test('T007 E1 D7: pending facts/snapshots, approve once, reject reason reaches child, badge vanishes at zero',async t=>{
  const {w,requests}=await parentUI(t);const session=w.eval('PARENT_SESSION');
  const ids=[];for(const [silver,gold] of [[1,0],[0,1],[1,1]]){const id=await newReward(w,session,{name:`組合${silver}${gold}`,silver,gold,weeklyLimit:0});ids.push((await w.api('redeemRequest',{rewardId:id,requestId:w.rewardRequestId(),playerId:'p1'})).redeem.id)}
  await w.parentMain();assert.equal(w.document.querySelector('#parent-count').textContent,'3');
  for(const [i,id] of ids.entries()){const card=w.document.querySelector(`[data-request="${id}"]`);for(const label of ['小葉子','需要','這筆保留','他目前可用','本週已換 1 次'])assert.ok(card.textContent.includes(label));const cost=[...card.children].find(el=>el.textContent.startsWith('需要'));for(const [color,n] of [['銀',[1,0,1][i]],['金',[0,1,1][i]]]){if(n)assert.ok(cost.textContent.includes(color+' '+n));else assert.ok(!cost.textContent.includes(color))}}
  let approve=w.document.querySelector(`[data-request="${ids[0]}"] [data-approve]`);approve.click();assert.equal(approve.disabled,true);approve.click();await settle();assert.equal(requests.filter(r=>r.action==='redeemDecide'&&r.id===ids[0]).length,1);assert.equal(w.document.querySelector('#parent-count').textContent,'2');
  let card=w.document.querySelector(`[data-request="${ids[1]}"]`);card.querySelector('[data-reject]').click();assert.equal(card.querySelector('[data-reason-area]').hidden,false);assert.equal(card.querySelector('input').maxLength,40);card.querySelector('input').value='先寫完功課';card.querySelector('[data-confirm-reject]').click();await settle();
  w.document.querySelector('[data-approve]').click();await settle();assert.equal(w.document.querySelector('.parent-count'),null);assert.ok(ptext(w).includes('現在沒有待核准的申請'));
  await w.parentMain('log');assert.ok(ptext(w).includes('核准'));assert.ok(ptext(w).includes('拒絕'));assert.ok(ptext(w).includes('先寫完功課'));
  await w.rewardPage('mine');assert.ok(text(w).includes('家長說：先寫完功課'));
});

test('T007 E1: gold substitution, busy retries once, conflict refresh and insufficient retry',async t=>{
  const {w}=await parentUI(t);const session=w.eval('PARENT_SESSION');const rid=await newReward(w,session,{name:'抵銀',silver:6,gold:0,weeklyLimit:0});
  const req=(await w.api('redeemRequest',{rewardId:rid,requestId:w.rewardRequestId()})).redeem;await w.parentMain();assert.ok(ptext(w).includes('其中金 1 枚用來抵銀'));
  const fetch=w.fetch;let tries=0;w.fetch=async(u,o)=>{if(JSON.parse(o.body).action==='redeemDecide'&&++tries===1)return {json:async()=>({ok:false,code:'busy'})};return fetch(u,o)};
  w.document.querySelector('[data-approve]').click();await settle();assert.equal(tries,2);assert.ok(ptext(w).includes('現在沒有待核准'));
  w.fetch=fetch;const gold=await newReward(w,session,{name:'金',silver:0,gold:1,weeklyLimit:0});await w.api('redeemRequest',{rewardId:gold,requestId:w.rewardRequestId()});await w.parentMain();
  for(const [code,msg] of [['insufficient','他的徽章不夠，不能核准'],['conflict','這筆剛剛已經被決定了']]){
    w.fetch=async(u,o)=>JSON.parse(o.body).action==='redeemDecide'?{json:async()=>({ok:false,code})}:fetch(u,o);w.document.querySelector('[data-approve]').click();await settle();assert.ok(ptext(w).includes(msg));
    if(code==='insufficient'){assert.ok([...w.document.querySelectorAll('button')].some(b=>b.textContent==='再試一次'));await w.parentMain()}
  }
  assert.ok(req.id);
});

test('T007 A3 A4: p1 protected, disable/restore ordering, exact purge name, pid keys and active fallback',async t=>{
  const {w}=await parentUI(t);const third=(await w.api('playerSave',{name:'第三位',icon:'🦊'})).player.id;
  await w.parentMain('players');assert.equal(w.document.querySelector('[data-manage-player="p1"] [data-player-action]'),null);
  const row=()=>w.document.querySelector('[data-manage-player="p2"]');
  row().querySelector('[data-player-action="playerDisable"]').click();assert.ok(row().textContent.includes('他的待核准申請會自動取消'));row().querySelector('[data-player-confirm] button').click();await settle();
  assert.equal([...w.document.querySelectorAll('[data-manage-player]')].at(-1).dataset.managePlayer,'p2');
  await w.playerSheet();assert.equal(w.document.querySelector('[data-player="p2"]'),null);assert.equal(w.document.querySelector('[data-edit-player="p2"]'),null);w.document.getElementById('player-close').click();
  await w.parentMain('players');row().querySelector('[data-player-action="playerRestore"]').click();await settle();assert.equal([...w.document.querySelectorAll('[data-manage-player]')][1].dataset.managePlayer,'p2');
  row().querySelector('[data-player-action="playerDisable"]').click();row().querySelector('[data-player-confirm] button').click();await settle();
  w.localStorage.setItem('p2:badges','{}');w.localStorage.setItem('p2:any-custom-key','x');w.localStorage.setItem(third+':badges','{}');
  row().querySelector('[data-player-action="playerPurge"]').click();assert.ok(row().textContent.includes('這位玩家的徽章、兌換紀錄都會刪除，不能復原。'));
  let confirm=row().querySelector('[data-player-confirm] button');assert.equal(confirm.disabled,true);inputValue(w,'[data-manage-player="p2"] input','小石頭 ');assert.equal(confirm.disabled,true);inputValue(w,'[data-manage-player="p2"] input','小石頭');assert.equal(confirm.disabled,false);confirm.click();await settle();
  assert.equal(row(),null);assert.ok(!Object.keys(w.localStorage).some(k=>k.startsWith('p2:')));assert.equal(w.localStorage.getItem(third+':badges'),'{}');
  const b=await parentUI(t,{storage:{player:'"p2"'}});await b.w.parentMain('players');b.w.document.querySelector('[data-manage-player="p2"] [data-player-action="playerDisable"]').click();b.w.document.querySelector('[data-manage-player="p2"] [data-player-confirm] button').click();await settle();assert.equal(JSON.parse(b.w.localStorage.getItem('player')),'p1');assert.ok(b.navigation.length);
});

test('T007 G2 routing, offline/retry without stale data, notice sentences, iframe placeholder hidden',async t=>{
  const {w}=await parentUI(t);assert.ok(ptext(w).includes('現在沒有待核准的申請'));await w.parentMain('log');assert.ok(ptext(w).includes('還沒有紀錄'));
  await w.parentMain('players');for(const line of ['這裡存了什麼：暱稱、圖示、徽章數、兌換紀錄。','存在哪裡：這個家庭的 Google 試算表。','怎麼刪除：先停用這位玩家，再按「永久刪除」。','家長 PIN 只存雜湊，看不到原本的數字。','暱稱請用代號，不要填真名。'])assert.ok(ptext(w).includes(line));
  const fetch=w.fetch;w.fetch=async()=>{throw Error('offline')};await w.parentMain('players');assert.ok(ptext(w).includes('連不到雲端，請稍後再試'));assert.ok(!ptext(w).includes('小石頭'));w.fetch=fetch;w.document.querySelector('#parent-list button').click();await settle();assert.ok(ptext(w).includes('小石頭'));
  w.location.hash='other';await settle();assert.equal(w.eval('PARENT_SESSION'),null);assert.equal(w.document.getElementById('parent-page'),null);
  const offline=await open(t,{query:'?mock=offline#parent'});assert.ok(ptext(offline.w).includes('連不到雲端，請稍後再試'));assert.ok(ptext(offline.w).includes('再試一次'));
  w.eval("FAMILY={code:''}");await parentRoute(w);assert.ok(ptext(w).includes('這台裝置還沒有輸入家庭邀請碼，請先到首頁輸入。'));assert.ok(w.document.getElementById('parent-exit'));
  const framed=await parentUI(t,{frame:true});framed.w.parentLock();await settle();assert.ok(!ptext(framed.w).includes('Face ID'));
  const reader=await parentUI(t);reader.w.eval("READER={code:'READER'}");reader.w.parentLock();await settle();assert.ok(ptext(reader.w).includes('這台裝置同時存了閱讀碼，家長頁要先清除閱讀碼。'));assert.ok(reader.w.document.getElementById('parent-clear-reader'));
});

test('T007 XSS: player/reward/rejection and anomaly text escaped in all parent views',async t=>{
  const {w}=await parentUI(t),session=w.eval('PARENT_SESSION'),bait='<img src=x onerror=1>';
  const fetch=w.fetch;w.fetch=async(u,o)=>{const res=await fetch(u,o),j=await res.json(),action=JSON.parse(o.body).action;
    if(action==='redeemList'){j.pendingCount=1;j.redeems=[{id:'rtest',playerName:bait,playerIcon:bait,name:bait,silver:2,gold:1,pay:{silver:1,gold:2},balance:{silver:{available:2},gold:{available:3}},weekUsed:1}]}
    if(action==='rewardList')j.rewards[0].name=bait;
    if(action==='playerList')j.players[0].name=bait;
    if(action==='parentLog')j.entries=[{at:0,type:'decision',playerName:bait,name:bait,status:'拒絕',reason:bait},{at:0,type:'anomaly',playerName:bait,color:'金',reason:bait}];
    return {json:async()=>j};
  };
  for(const tab of ['pending','rewards','players','log']){await w.parentMain(tab);assert.ok(ptext(w).includes(bait));assert.equal(w.document.querySelector('#parent-page img'),null)}
  assert.ok(ptext(w).includes('異常'));assert.ok(session);
});

test('T007 routing race: late homepage cannot replace PIN; old no_session cannot lock a new login',async t=>{
  const {w}=await open(t);const fetch=w.fetch;let release;const gate=new Promise(r=>release=r);
  w.eval("LIB=null;LIBERR=''");w.fetch=async(u,o)=>{if(JSON.parse(o.body).action==='libList')await gate;return fetch(u,o)};
  const home=w.libHome();await settle();await parentRoute(w);release();await home;await settle();assert.ok(ptext(w).includes('第一次設定家長 PIN'));await setupParentUI(w);
  const old=w.eval('PARENT_SESSION');let releaseOld;const oldGate=new Promise(r=>releaseOld=r);
  w.fetch=async(u,o)=>{const req=JSON.parse(o.body);if(req.action==='redeemList'&&req.session===old){await oldGate;return {json:async()=>({ok:false,code:'no_session'})}}return fetch(u,o)};
  const pending=w.parentMain();await settle();w.parentLock();await settle();await typePin(w,'246810');const current=w.eval('PARENT_SESSION');assert.ok(current&&current!==old);releaseOld();await pending;assert.equal(w.eval('PARENT_SESSION'),current);assert.ok(w.document.querySelector('[data-parent-tab]'));
  w.fetch=async()=>({json:async()=>({ok:false,code:'no_session'})});await assert.rejects(w.api('parentLog',{session:current}));assert.equal(w.eval('PARENT_SESSION'),null);
});

function t020DelayFetch(w){const f=w.fetch;w.fetch=async(u,o)=>{await new Promise(r=>w.setTimeout(r,2000));return f(u,o)}}
const t020Wait=()=>new Promise(r=>setTimeout(r,300));
function t020Disabled(w,selector){const buttons=[...w.document.querySelectorAll(selector)];assert.ok(buttons.length);for(const b of buttons){assert.equal(b.disabled,true);assert.equal(b.onclick,null)}}
function t025OldCache(w){const cache=w.rewardCacheGet();delete cache.at;w.rewardCacheSet(cache)}

test('T020 R3 rewards: cached wallet immediately, disabled until fresh and no credentials',async t=>{
  const {w}=await open(t);await w.rewardPage();t025OldCache(w);
  const raw=w.localStorage.getItem('p1:reward-cache:TEST-0000');assert.ok(raw);assert.doesNotMatch(raw,/session|pin|requestId/i);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(),['balance','redeems','rewards']);
  const wallet=w.document.querySelector('#reward-wallet').textContent;
  t020DelayFetch(w);const p=w.rewardPage();
  assert.equal(w.document.querySelector('#reward-wallet').textContent,wallet);
  await t020Wait();assert.equal(w.document.querySelector('#reward-wallet').textContent,wallet);
  assert.equal(w.document.querySelector('#reward-updating').textContent,'更新中…');t020Disabled(w,'[data-apply]');
  await p;assert.equal(w.document.querySelector('#reward-updating'),null);assert.equal(w.document.querySelector('[data-apply="mock-s"]').disabled,false);
});

test('T020 R3 mine: cached pending request cannot cancel until fresh',async t=>{
  const {w}=await open(t);await w.api('redeemRequest',{rewardId:'mock-s',requestId:w.rewardRequestId()});await w.rewardPage('mine');
  t025OldCache(w);
  t020DelayFetch(w);const p=w.rewardPage('mine');await t020Wait();
  assert.ok(text(w).includes('等家長核准'));assert.equal(w.document.querySelector('#reward-updating').textContent,'更新中…');t020Disabled(w,'[data-cancel]');
  await p;assert.equal(w.document.querySelector('#reward-updating'),null);assert.equal(w.document.querySelector('[data-cancel]').disabled,false);
});

test('T020 both reward tabs use a single rewardList with redeems',async t=>{
  const {w,requests}=await open(t);
  for(const tab of ['rewards','mine']){const start=requests.length;await w.rewardPage(tab);const reads=requests.slice(start).filter(r=>['rewardList','myRedeems'].includes(r.action));assert.equal(reads.length,1);assert.equal(reads[0].action,'rewardList');assert.equal(reads[0].withRedeems,true)}
});

test('T020 R4 apply and cancel invalidate before redraw, next cache has fresh balances',async t=>{
  const {w}=await open(t);await w.rewardPage();const before=JSON.parse(w.localStorage.getItem(w.rewardCacheKey())).balance.silver.available;
  clickApply(w,'mock-s');await sendSheet(w);
  const after=JSON.parse(w.localStorage.getItem(w.rewardCacheKey())).balance.silver.available;assert.ok(after<before);
  assert.equal(Number(w.document.querySelector('.reward-silver strong').textContent),after);
  const f=w.fetch;t020DelayFetch(w);const p=w.rewardPage();await t020Wait();assert.equal(Number(w.document.querySelector('.reward-silver strong').textContent),after);await p;
  w.fetch=f;await w.rewardPage('mine');w.document.querySelector('[data-cancel]').click();await sendSheet(w);
  assert.equal(JSON.parse(w.localStorage.getItem(w.rewardCacheKey())).balance.silver.available,before);
});

test('T020 offline discards displayed cached numbers and updating status',async t=>{
  const {w}=await open(t);await w.rewardPage();t025OldCache(w);w.fetch=async()=>{throw Error('offline')};await w.rewardPage();
  assert.ok(text(w).includes('連不到雲端，現在不能申請'));assert.equal(w.document.querySelector('#reward-wallet').textContent,'');assert.equal(w.document.querySelector('#reward-updating'),null);assert.ok(w.document.querySelector('#reward-retry'));
});

test('T020 caches isolate player and family; corrupt JSON and storage failures are harmless',async t=>{
  const a=await open(t);await a.w.rewardPage();const raw=a.w.localStorage.getItem(a.w.rewardCacheKey());
  const {w}=await open(t,{storage:{player:'"p2"','p1:reward-cache:TEST-0000':raw}});w.localStorage.removeItem(w.rewardCacheKey());t020DelayFetch(w);const p=w.rewardPage();
  assert.equal(w.rewardCacheKey(),'p2:reward-cache:TEST-0000');assert.equal(w.document.querySelector('#reward-updating'),null);assert.equal(w.document.querySelectorAll('.reward-skeleton').length,3);await p;
  w.eval("FAMILY.code='OTHER-0000'");assert.equal(w.rewardCacheKey(),'p2:reward-cache:OTHER-0000');assert.equal(w.rewardCacheGet(),null);
  w.localStorage.setItem(w.rewardCacheKey(),'{bad');assert.equal(w.rewardCacheGet(),null);
  const proto=Object.getPrototypeOf(w.localStorage),get=proto.getItem,set=proto.setItem;
  try{proto.getItem=()=>{throw Error('blocked')};proto.setItem=()=>{throw Error('full')};assert.equal(w.rewardCacheGet(),null);assert.doesNotThrow(()=>w.rewardCacheSet({}));assert.doesNotThrow(()=>w.parentCacheSet({}))}finally{proto.getItem=get;proto.setItem=set}
});

test('T020 parent rewards: fetches start in parallel while cache controls stay disabled',async t=>{
  const {w,requests}=await parentUI(t);await w.parentMain('rewards');
  const raw=w.localStorage.getItem('parent-cache:TEST-0000');assert.ok(raw);assert.doesNotMatch(raw,/session|pin|requestId/i);
  const f=w.fetch;let release;const gate=new Promise(r=>release=r);w.fetch=async(u,o)=>{const response=f(u,o);await gate;return response};
  const start=requests.length,p=w.parentMain('rewards');await t020Wait();
  try{assert.deepEqual(requests.slice(start).map(r=>r.action).sort(),['redeemList','rewardList']);assert.equal(w.document.querySelector('#parent-updating').textContent,'更新中…');t020Disabled(w,'#parent-list button');assert.ok([...w.document.querySelectorAll('[data-parent-tab]')].every(b=>!b.disabled))}finally{release()}
  await p;assert.equal(w.document.querySelector('#parent-updating'),null);assert.equal(w.document.querySelector('#parent-add-reward').disabled,false);
});

test('T020 parent pending and players cache stays read-only and never changes player metadata',async t=>{
  const {w}=await parentUI(t);await w.api('redeemRequest',{rewardId:'mock-s',requestId:w.rewardRequestId()});await w.parentMain('pending');await w.parentMain('players');
  const cache=JSON.parse(w.localStorage.getItem(w.parentCacheKey()));assert.ok(cache.pending.redeems.length);assert.ok(cache.players.length);
  cache.players[0].name='cached nickname';w.localStorage.setItem(w.parentCacheKey(),JSON.stringify(cache));const metadata=w.localStorage.getItem('players-cache'),players=w.eval('JSON.stringify(PLAYERS)');
  const f=w.fetch;let release;const gate=new Promise(r=>release=r);w.fetch=async(u,o)=>{await gate;return f(u,o)};
  let p=w.parentMain('pending');assert.ok(w.document.querySelector('#parent-count').textContent.includes('1'));t020Disabled(w,'#parent-list button,#parent-list input');release();await p;
  let releasePlayers;const playersGate=new Promise(r=>releasePlayers=r);w.fetch=async(u,o)=>{await playersGate;return f(u,o)};p=w.parentMain('players');
  try{assert.ok(ptext(w).includes('cached nickname'));assert.equal(w.localStorage.getItem('players-cache'),metadata);assert.equal(w.eval('JSON.stringify(PLAYERS)'),players);t020Disabled(w,'#parent-list button')}finally{releasePlayers()}
  await p;assert.ok(!ptext(w).includes('cached nickname'));
  w.fetch=async()=>{throw Error('offline')};await w.parentMain('players');assert.equal(w.document.querySelector('#parent-updating'),null);assert.ok(ptext(w).includes('連不到雲端，請稍後再試'));
});

test('T020 malformed child cache falls back to skeleton',async t=>{
  for(const raw of ['{"x":1}','5','[]','{"balance":{"silver":{"available":1,"held":0,"total":1}}}']){
    await t.test(raw,async t=>{
      const {w}=await open(t,{storage:{'p1:reward-cache:TEST-0000':raw}});
      await w.rewardPage();
      assert.equal(w.document.querySelector('[data-apply="mock-s"]').disabled,false);
      assert.equal(w.document.querySelector('#reward-updating'),null);
      assert.ok(JSON.parse(w.localStorage.getItem(w.rewardCacheKey())).balance.gold);
    });
  }
  await t.test('slow refresh keeps skeleton',async t=>{
    const {w}=await open(t,{storage:{'p1:reward-cache:TEST-0000':'{"x":1}'}});
    w.localStorage.setItem(w.rewardCacheKey(),'{"x":1}');
    t020DelayFetch(w);const p=w.rewardPage();
    // Attach rejection handling immediately so the pre-fix failure is reported as an assertion.
    const outcome=p.then(()=>null,e=>e);
    try{
      await t020Wait();
      assert.equal(w.document.querySelectorAll('.reward-skeleton').length,3);
      assert.equal(w.document.querySelector('#reward-updating'),null);
      assert.equal(w.localStorage.getItem(w.rewardCacheKey()),null);
    }finally{const error=await outcome;assert.equal(error,null)}
    assert.equal(w.document.querySelector('[data-apply="mock-s"]').disabled,false);
  });
});

test('T020 malformed parent cache falls back to skeleton',async t=>{
  const {w}=await parentUI(t);
  const fresh=await w.api('redeemRequest',{rewardId:'mock-s',requestId:w.rewardRequestId()});
  // Login populates the parent cache, so seed the malformed value after login.
  w.localStorage.setItem('parent-cache:TEST-0000','{"pending":{"redeems":[{"id":"x"}],"pendingCount":1}}');
  t020DelayFetch(w);const p=w.parentMain('pending');
  const outcome=p.then(()=>null,e=>e);
  try{
    await t020Wait();
    assert.equal(w.document.querySelector('#parent-list').innerHTML,'<div class="reward-skeleton"></div>讀取中……');
    assert.equal(w.document.querySelector('#parent-count').textContent,'');
    assert.equal(w.document.querySelector('#parent-updating'),null);
    assert.equal(w.localStorage.getItem(w.parentCacheKey()),null);
  }finally{const error=await outcome;assert.equal(error,null)}
  assert.ok(w.document.querySelector('[data-request="'+fresh.redeem.id+'"]'));
  assert.equal(w.document.querySelector('[data-approve]').disabled,false);
  assert.equal(w.document.querySelector('#parent-updating'),null);
  assert.ok(JSON.parse(w.localStorage.getItem(w.parentCacheKey())).pending.redeems[0].balance.gold);
});

test('T021 parent without family keeps the invitation message even with a reader code',async t=>{
  for(const reader of [{code:'',name:''},{code:'READ-1234',name:'x'}]){
    const {w}=await open(t,{storage:{family:{code:'',name:''},reader}});
    w.eval('FAMILY={code:"",name:""};READER='+JSON.stringify(reader));
    await parentRoute(w);
    assert.equal(w.document.querySelector('#parent-content').innerHTML,'<p>這台裝置還沒有輸入家庭邀請碼，請先到首頁輸入。</p>');
    assert.equal(w.document.querySelector('#parent-clear-reader'),null);
  }
});

test('T021 parent clears reader for p1 and enters PIN flow without navigation',async t=>{
  const seed=await open(t),reader=(await seed.w.api('readerCreate',{note:'T021'})).reader;
  const {w,navigation}=await open(t,{storage:{...seed.storage(),reader:{code:reader,name:'x'}}});
  await parentRoute(w);
  assert.equal(w.document.querySelector('#parent-content').innerHTML,'<p>這台裝置同時存了閱讀碼，家長頁要先清除閱讀碼。</p><button class="big" id="parent-clear-reader">清除閱讀碼</button>');
  const button=w.document.querySelector('#parent-clear-reader');
  const clearing=button.onclick();assert.equal(button.disabled,true);await clearing;
  assert.deepEqual(JSON.parse(w.localStorage.getItem('reader')),{code:'',name:''});
  assert.match(w.document.querySelector('#parent-content').textContent,/輸入家長 PIN|第一次設定家長 PIN/);
  assert.equal(navigation.length,0);
});

test('T021 parent clears reader for saved p2 and reloads on the parent route',async t=>{
  const seed=await open(t),reader=(await seed.w.api('readerCreate',{note:'T021'})).reader;
  const {w,navigation}=await open(t,{storage:{...seed.storage(),reader:{code:reader,name:'x'},player:'"p2"'}});
  await parentRoute(w);
  const button=w.document.querySelector('#parent-clear-reader');assert.ok(button);
  const clearing=button.onclick();assert.equal(button.disabled,true);await clearing;
  assert.deepEqual(JSON.parse(w.localStorage.getItem('reader')),{code:'',name:''});
  assert.ok(navigation.length>0);
  assert.equal(w.location.hash,'#parent');
  assert.equal(JSON.parse(w.localStorage.getItem('player')),'p2');
});

test('T022 built HTML includes the exact reward and parent spacing rules',()=>{
  for(const rule of [
    '.reward-page,.parent-page{padding-bottom:calc(118px + env(safe-area-inset-bottom,0px))}',
    '#reward-notice:empty{display:none}',
    '#reward-notice,#reward-updating{margin:0}'
  ])assert.ok(html.includes(rule),rule);
});

test('T022 reward notice is hidden only when empty',async t=>{
  const {w}=await open(t);
  await w.rewardPage();
  assert.equal(w.getComputedStyle(w.document.getElementById('reward-notice')).display,'none');
  await w.rewardPage('rewards','已送出，等家長核准');
  assert.notEqual(w.getComputedStyle(w.document.getElementById('reward-notice')).display,'none');
});

test('T025 R4: two-second backend prefetch renders usable rewards within 300ms',async t=>{
  const {w}=await open(t,{fetchDelay:2000});
  // Boot calls libHome; wait for its prefetch without starting another homepage load.
  const deadline=Date.now()+15000;
  while(!w.eval('rewardPrefetching')){
    assert.ok(Date.now()<deadline,'homepage starts prefetch');
    await new Promise(r=>setTimeout(r,20));
  }
  await w.eval('rewardPrefetching');
  const cache=w.rewardCacheGet();assert.ok(cache.at);assert.ok(cache.balance.silver.available>0);
  const start=Date.now(),page=w.rewardPage();
  assert.equal(Number(w.document.querySelector('.reward-silver strong').textContent),cache.balance.silver.available);
  assert.equal(w.document.querySelector('[data-apply="mock-s"]').disabled,false);
  assert.equal(w.document.getElementById('reward-updating'),null);
  assert.ok(Date.now()-start<300,'cached wallet and enabled buttons render within 300ms');
  await t020Wait();assert.equal(w.document.querySelector('[data-apply="mock-s"]').disabled,false);
  await page;
});

test('T025 prefetch: guards, shared promise and thirty-second throttle',async t=>{
  const {w,requests}=await open(t);const fetch=w.fetch;let release;
  w.localStorage.removeItem(w.rewardCacheKey());
  const gate=new Promise(r=>release=r);
  w.fetch=async(u,o)=>{if(JSON.parse(o.body).action==='rewardList')await gate;return fetch(u,o)};
  const start=requests.length,prefetch=w.rewardPrefetch();
  assert.equal(w.rewardPrefetch(),prefetch);
  const page=w.rewardPage();await settle();release();await Promise.all([prefetch,page]);
  assert.equal(requests.slice(start).filter(r=>r.action==='rewardList').length,1);
  assert.equal(w.rewardPrefetch(),undefined);assert.ok(w.rewardCacheGet().at);
  const cache=w.rewardCacheGet();w.rewardCacheSet({...cache,at:Date.now()-31000});
  await w.rewardPrefetch();assert.equal(requests.slice(start).filter(r=>r.action==='rewardList').length,2);
  w.localStorage.removeItem(w.rewardCacheKey());const count=requests.length;
  for(const setup of ["READER.code='reader'","READER.code='';FAMILY.code=''","FAMILY.code='TEST-0000';CONFIG.API_URL=''","CONFIG.API_URL='mock://gas';history.replaceState(null,'','#parent')"]){
    w.eval(setup);assert.equal(w.rewardPrefetch(),undefined);
  }
  assert.equal(requests.length,count);
});

test('T025 prefetch failure stays silent and never falls back a disabled player',async t=>{
  for(const code of ['offline','player_disabled','bad_player']){
    const {w,navigation}=await open(t,{storage:{player:'"p2"'}});
    w.localStorage.removeItem(w.rewardCacheKey());w.localStorage.removeItem('p2:badges-dirty');
    const before=w.document.getElementById('app').textContent,players=w.eval('JSON.stringify(PLAYERS)'),family=w.eval('JSON.stringify(FAMILY)');
    w.fetch=async()=>{if(code==='offline')throw Error(code);return {json:async()=>({ok:false,code})}};
    await w.libHome();await w.eval('rewardPrefetching');
    assert.equal(w.document.getElementById('app').textContent,before);
    assert.equal(w.rewardCacheGet(),null);assert.equal(w.localStorage.getItem('p2:badges-dirty'),null);
    assert.equal(w.eval('JSON.stringify(PLAYERS)'),players);assert.equal(w.eval('JSON.stringify(FAMILY)'),family);
    assert.equal(w.localStorage.getItem('player'),'"p2"');assert.equal(w.localStorage.getItem('player-notice'),null);assert.equal(navigation.length,0);
  }
});

test('T025 dirty flags: missing, clean, local saves, failed sync and changes during sync',async t=>{
  const {w,requests}=await open(t);const key='p1:badges-dirty';
  w.localStorage.removeItem(key);assert.equal(w.badgesDirty(),true);
  let start=requests.length;await w.rewardPage();
  assert.deepEqual(requests.slice(start).map(r=>r.action),['badges','rewardList']);assert.equal(w.localStorage.getItem(key),'0');
  start=requests.length;await w.rewardPage();assert.deepEqual(requests.slice(start).map(r=>r.action),['rewardList']);
  w.eval("badgeStore({key:'__plant'},PLANT_BADGE).save(false);clearTimeout(badgeSyncTimer)");
  assert.equal(w.badgesDirty(),true);assert.ok(Number(w.localStorage.getItem(key))>0);
  start=requests.length;await w.rewardPage();assert.deepEqual(requests.slice(start).map(r=>r.action),['badges','rewardList']);
  w.testOwn=bank();w.eval("BADGES[testOwn.id]={earned:[]};badgeStore({bank:testOwn},{}).save(false);clearTimeout(recTimers[testOwn.id]);delete recTimers[testOwn.id]");
  assert.equal(w.badgesDirty(),true);assert.equal(w.eval('BADGES[testOwn.id]'),undefined);
  const fetch=w.fetch;let release;const gate=new Promise(r=>release=r);
  w.fetch=async(u,o)=>{if(JSON.parse(o.body).action==='badges')await gate;return fetch(u,o)};
  const syncing=w.badgeSync(),newer=String(w.Date.now()+1000);w.localStorage.setItem(key,newer);
  release();assert.equal(await syncing,true);assert.equal(w.localStorage.getItem(key),newer);assert.equal(w.badgesDirty(),true);
  w.fetch=async()=>{throw Error('offline')};assert.equal(await w.badgeSync(),false);assert.equal(w.localStorage.getItem(key),newer);
});

test('T025 reader sync and saves never access the family dirty flag',async t=>{
  const {w}=await open(t);w.eval("READER={code:'reader'}");
  const proto=w.Storage.prototype,get=proto.getItem,set=proto.setItem;
  proto.getItem=function(k){assert.ok(!k.endsWith(':badges-dirty'));return get.call(this,k)};
  proto.setItem=function(k,v){assert.ok(!k.endsWith(':badges-dirty'));return set.call(this,k,v)};
  try{
    assert.equal(w.badgesDirty(),false);
    w.eval("badgeStore({key:'__plant'},PLANT_BADGE).save(false);clearTimeout(badgeSyncTimer)");
    w.fetch=async()=>({json:async()=>({ok:true,badges:{}})});assert.equal(await w.badgeSync(),true);
  }finally{proto.getItem=get;proto.setItem=set}
});

test('T025 prefetch race: applying prevents a delayed old response from restoring cache',async t=>{
  const {w,requests}=await open(t);await w.rewardPage();
  w.rewardCacheSet({...w.rewardCacheGet(),at:Date.now()-31000});
  const fetch=w.fetch;let releaseOld,releaseFresh,count=0;
  const oldGate=new Promise(r=>releaseOld=r),freshGate=new Promise(r=>releaseFresh=r);
  w.fetch=async(u,o)=>{
    if(JSON.parse(o.body).action!=='rewardList')return fetch(u,o);
    if(++count===1){const result=await fetch(u,o);await oldGate;return result}
    await freshGate;return fetch(u,o);
  };
  const prefetch=w.rewardPrefetch();await settle();const gen=w.eval('rewardWriteGen');
  clickApply(w,'mock-s');const sending=sendSheet(w);await settle();
  assert.ok(requests.some(r=>r.action==='redeemRequest'));assert.equal(w.eval('rewardWriteGen'),gen+1);
  assert.equal(w.rewardCacheGet().at,undefined);assert.equal(w.rewardCacheGet().balance.silver.held,2);
  releaseOld();assert.equal(await prefetch,null);await settle();assert.equal(w.rewardCacheGet().at,undefined);assert.equal(w.rewardCacheGet().balance.silver.held,2);
  releaseFresh();await sending;assert.ok(w.rewardCacheGet().balance.silver.held>0);
  w.fetch=fetch;await w.rewardPage('mine');w.document.querySelector('[data-cancel]').click();await sendSheet(w);
  assert.equal(w.eval('rewardWriteGen'),gen+2);assert.equal(w.rewardCacheGet().balance.silver.held,0);
});

test('T025 cache freshness: expired cache stays disabled; fresh offline wallet stays usable',async t=>{
  const {w}=await open(t);await w.rewardPage();const cache=w.rewardCacheGet(),fetch=w.fetch;
  w.rewardCacheSet({...cache,at:Date.now()-61000});let release;const gate=new Promise(r=>release=r);
  w.fetch=async(u,o)=>{await gate;return fetch(u,o)};
  const page=w.rewardPage();assert.equal(w.document.getElementById('reward-updating').textContent,'更新中…');t020Disabled(w,'[data-apply]');
  release();await page;const wallet=w.document.getElementById('reward-wallet').textContent;
  w.fetch=async()=>{throw Error('offline')};await w.rewardPage();
  assert.equal(w.document.getElementById('reward-wallet').textContent,wallet);
  assert.equal(w.document.getElementById('reward-notice').textContent,'連不到雲端，數字可能不是最新的');
  assert.equal(w.document.querySelector('[data-apply="mock-s"]').disabled,false);assert.equal(w.document.getElementById('reward-updating'),null);
  w.rewardCacheSet({...cache,session:'secret',pin:'1234',requestId:'secret',at:123});
  assert.deepEqual(Object.keys(w.rewardCacheGet()).sort(),['at','balance','redeems','rewards']);
  assert.doesNotMatch(w.localStorage.getItem(w.rewardCacheKey()),/session|pin|requestId|secret/);
});

test('T025 parentLock removes the parent cache',async t=>{
  const {w}=await parentUI(t);await w.parentMain('rewards');
  const key=w.parentCacheKey();assert.ok(w.localStorage.getItem(key));w.parentLock();
  assert.equal(w.localStorage.getItem(key),null);await settle();assert.equal(w.localStorage.getItem(key),null);
});

function t026Slow(w,override){
  const fetch=w.fetch,seen=[];
  w.fetch=async(u,o)=>{const r=JSON.parse(o.body);seen.push(r);await new Promise(resolve=>w.setTimeout(resolve,2000));return override?.(r,u,o)??fetch(u,o)};
  return seen;
}
const t026Wait=ms=>new Promise(r=>setTimeout(r,ms));
const t026Wallet=w=>[...w.document.querySelectorAll('.reward-pot')].map(c=>c.textContent);

test('T026 R3 child: every fetch delayed two seconds, immediate apply/cancel, background stays rendered',async t=>{
  const {w}=await open(t);await w.rewardPage();const seen=t026Slow(w);
  clickApply(w,'mock-sg');const send=w.document.getElementById('reward-send'),sending=send.onclick();
  await t026Wait(100);
  assert.deepEqual(t026Wallet(w),['銀色可用2保留 3','金色可用1保留 1']);
  assert.equal(w.document.querySelector('[data-apply="mock-sg"]').textContent,'送出中…');
  assert.ok(w.document.querySelector('p.reward-status.reward-wait'));
  assert.ok([...w.document.querySelectorAll('[data-apply]')].every(b=>b.disabled));
  await send.onclick();clickApply(w,'mock-s');assert.equal(w.document.querySelector('.reward-dialog'),null);
  assert.equal(seen.filter(r=>r.action==='redeemRequest').length,1);
  await sending;
  assert.equal(w.document.querySelector('p.reward-status.reward-wait'),null);
  assert.equal(w.rewardCacheGet().at,undefined);
  assert.equal(w.document.querySelector('[data-apply="mock-s"]').disabled,false);
  assert.equal(seen.filter(r=>r.action==='rewardList').length,1);
  assert.equal(seen.at(-1).withRedeems,true);
  assert.equal(w.document.querySelector('.reward-skeleton,#reward-updating'),null);
  await t026Wait(2100);assert.ok(w.rewardCacheGet().at);
  await w.rewardPage('mine');const count=seen.length;
  w.document.querySelector('[data-cancel]').click();const cancel=sendSheet(w);
  await t026Wait(100);assert.deepEqual(t026Wallet(w),['銀色可用5保留 0','金色可用2保留 0']);
  assert.equal(w.document.querySelector('[data-cancel]').textContent,'送出中…');
  assert.equal(w.document.querySelector('[data-cancel]').disabled,true);
  await cancel;assert.ok(text(w).includes('已取消申請'));assert.equal(w.document.querySelector('p.reward-status.reward-wait'),null);
  assert.equal(w.document.querySelector('.reward-skeleton,#reward-updating'),null);
  assert.equal(seen.slice(count).filter(r=>r.action==='rewardList').length,1);
  await t026Wait(2100);assert.equal(w.rewardCacheGet().balance.silver.available,5);
});

test('T026 R3 child failure: rollback and exact backend reason before silent alignment',async t=>{
  const {w}=await open(t);await w.rewardPage();const before=t026Wallet(w);
  const seen=t026Slow(w,r=>r.action==='redeemRequest'?{json:async()=>({ok:false,code:'insufficient',reason:'還差銀 9'})}:undefined);
  clickApply(w,'mock-s');const sending=sendSheet(w);await t026Wait(100);
  assert.notDeepEqual(t026Wallet(w),before);await sending;
  assert.deepEqual(t026Wallet(w),before);assert.equal(w.document.querySelector('#reward-notice').textContent,'還差銀 9');
  assert.equal(w.document.querySelector('p.reward-status.reward-wait'),null);
  assert.equal(seen.filter(r=>r.action==='rewardList').length,1);
  assert.equal(w.document.querySelector('.reward-skeleton,#reward-updating'),null);
  await t026Wait(2100);assert.equal(w.document.querySelector('#reward-notice').textContent,'還差銀 9');
});

test('T026 retry IDs: network retry survives reopening page, success and definite refusal clear ID',async t=>{
  const {w}=await open(t);await w.rewardPage();const fetch=w.fetch,ids=[];let mode='network';
  w.fetch=async(u,o)=>{const r=JSON.parse(o.body);if(r.action==='redeemRequest'){ids.push(r.requestId);if(mode==='network')throw Error('offline');if(mode==='quota')return {json:async()=>({ok:false,code:'quota',reason:'額度用完'})}}return fetch(u,o)};
  clickApply(w,'mock-s');await sendSheet(w);await w.rewardPage();mode='ok';clickApply(w,'mock-s');await sendSheet(w);
  assert.equal(ids[0],ids[1]);await w.rewardPage();mode='quota';clickApply(w,'mock-s');await sendSheet(w);
  assert.notEqual(ids[1],ids[2]);await w.rewardPage();mode='ok';clickApply(w,'mock-s');await sendSheet(w);assert.notEqual(ids[2],ids[3]);
  assert.ok(!JSON.stringify(Object.fromEntries(Object.entries(w.localStorage).filter(([k])=>k!=='mock-gas-state'))).includes(ids[0]));
});

async function t026Parent(t){
  const ctx=await parentUI(t),{w}=ctx,session=w.eval('PARENT_SESSION');
  for(let i=0;i<2;i++)await w.api('redeemRequest',{rewardId:'mock-s',requestId:w.rewardRequestId()});
  await w.parentMain();return ctx;
}
for(const decision of ['approve','reject'])test('T026 R3 parent '+decision+': two-second requests, count, wallet, one send and silent alignment',async t=>{
  const {w}=await t026Parent(t);const cards=[...w.document.querySelectorAll('[data-request]')],card=cards[0],id=card.dataset.request;
  const seen=t026Slow(w);if(decision==='reject')card.querySelector('[data-reject]').click();
  const button=card.querySelector(decision==='approve'?'[data-approve]':'[data-confirm-reject]');const sending=button.onclick();await t026Wait(100);
  assert.equal(w.document.querySelector('#parent-count').textContent,'1');assert.ok(card.querySelector('p.reward-status.reward-wait'));
  assert.ok([...w.document.querySelectorAll('[data-request] button')].every(b=>b.disabled));
  for(const c of cards)assert.equal(c.children[4].textContent,decision==='reject'?'他目前可用 銀 3・金 2':'他目前可用 銀 1・金 2');
  await button.onclick();assert.equal(seen.filter(r=>r.action==='redeemDecide').length,1);await sending;
  assert.equal(w.document.querySelector('[data-request="'+id+'"]'),null);
  assert.equal(w.document.querySelector('#parent-notice').textContent,decision==='approve'?'已核准':'已拒絕');
  assert.equal(w.document.querySelector('[data-approve]').disabled,false);
  assert.equal(seen.filter(r=>r.action==='redeemList').length,1);
  assert.equal(w.document.querySelector('.reward-skeleton,#parent-updating'),null);
  await t026Wait(2100);assert.equal(w.parentCacheGet().pending.pendingCount,1);
});

test('T026 R3 parent network failure restores count and same-player balances',async t=>{
  const {w}=await t026Parent(t);const card=w.document.querySelector('[data-request]');
  t026Slow(w,r=>{if(r.action==='redeemDecide')throw Error('offline')});
  card.querySelector('[data-reject]').click();const sending=card.querySelector('[data-confirm-reject]').onclick();
  await t026Wait(100);assert.equal(w.document.querySelector('#parent-count').textContent,'1');
  assert.ok([...w.document.querySelectorAll('[data-request]')].every(c=>c.children[4].textContent==='他目前可用 銀 3・金 2'));
  await sending;assert.equal(w.document.querySelector('#parent-count').textContent,'2');
  assert.ok(ptext(w).includes('連不到雲端，請稍後再試'));
  assert.ok([...w.document.querySelectorAll('button')].some(b=>b.textContent==='再試一次'));
  assert.equal(w.document.querySelector('p.reward-status.reward-wait'),null);
  assert.equal(w.document.querySelectorAll('[data-request]').length,2);
  assert.equal(w.document.querySelectorAll('[data-request]')[1].children[4].textContent,'他目前可用 銀 1・金 2');
  assert.equal(w.document.querySelector('[data-approve]').disabled,false);
});

test('T026 child background race: old list cannot undo a later write or navigation; errors stay silent',async t=>{
  const {w}=await open(t);await w.rewardPage();const fetch=w.fetch;let release,count=0;
  const gate=new Promise(r=>release=r);
  w.fetch=async(u,o)=>{const response=await fetch(u,o);if(JSON.parse(o.body).action==='rewardList'&&++count===1)await gate;return response};
  clickApply(w,'mock-s');await sendSheet(w);await settle();
  clickApply(w,'mock-g');await sendSheet(w);await settle();release();await settle();
  assert.equal(w.rewardCacheGet().balance.gold.held,1);assert.equal(w.document.querySelector('.reward-gold strong').textContent,'1');
  assert.ok(text(w).includes('已送出，等家長核准'));
  w.fetch=async(u,o)=>{if(JSON.parse(o.body).action==='rewardList')throw Error('offline');return fetch(u,o)};
  clickApply(w,'mock-s');await sendSheet(w);await settle();
  assert.ok(text(w).includes('已送出，等家長核准'));assert.equal(w.document.querySelector('.reward-skeleton,#reward-updating'),null);
  assert.equal(w.rewardCacheGet().at,undefined);
  let finish;const late=new Promise(r=>finish=r);w.fetch=async(u,o)=>{const response=await fetch(u,o);if(JSON.parse(o.body).action==='rewardList')await late;return response};
  clickApply(w,'mock-g');await sendSheet(w);await settle();await w.libHome();finish();await settle();
  assert.equal(w.document.querySelector('#reward-page'),null);assert.ok(w.document.querySelector('#rewards-home'));
});

test('T026 parent background race: old list cannot restore decided cards or another tab',async t=>{
  const {w}=await t026Parent(t);const fetch=w.fetch;let release,count=0;const gate=new Promise(r=>release=r);
  w.fetch=async(u,o)=>{const response=await fetch(u,o);if(JSON.parse(o.body).action==='redeemList'&&++count===1)await gate;return response};
  await w.document.querySelector('[data-approve]').onclick();await settle();
  await w.document.querySelector('[data-approve]').onclick();await settle();release();await settle();
  assert.equal(w.parentCacheGet().pending.pendingCount,0);assert.equal(w.document.querySelector('[data-request]'),null);
  assert.ok(ptext(w).includes('現在沒有待核准的申請'));
  await w.api('redeemRequest',{rewardId:'mock-g',requestId:w.rewardRequestId()});await w.parentMain();
  let finish;const late=new Promise(r=>finish=r);w.fetch=async(u,o)=>{const response=await fetch(u,o);if(JSON.parse(o.body).action==='redeemList')await late;return response};
  await w.document.querySelector('[data-approve]').onclick();await settle();
  const other=w.parentMain('log');finish();await other;await settle();
  assert.equal(w.document.querySelector('[aria-current="page"]').dataset.parentTab,'log');
  assert.equal(w.document.querySelector('[data-request]'),null);assert.ok(ptext(w).includes('核准'));
});

const t027Notes=[
  '往返：手機從按下到收到回覆的秒數。',
  '後端總計：Google 那邊真正花的毫秒數。',
  '往返很大、後端總計很小：時間花在網路或 Google 喚醒程式（冷啟動）。',
  '第一次很慢、後面變快：多半是冷啟動。',
  '開表、讀表很大：試算表本身慢，請把這張表截圖回報。',
  '快取「是」：這次沒有打開試算表。'
];
function t027Fetch(w,override){
  const seen=[];let active=0,maxActive=0;
  w.fetch=async(u,o)=>{
    const r=JSON.parse(o.body);seen.push(r);active++;maxActive=Math.max(maxActive,active);
    try{
      await tick();
      return {json:async()=>override?.(r,seen.length)??{ok:true,timing:{total:12.7,open:3.2,lock:1.8,read:4.4,reads:2,cache:seen.length===5?1:0}}};
    }finally{active--}
  };
  return {seen,maxActive:()=>maxActive};
}

test('T027 R5: parent diagnostics run nine sequential requests without credentials and render exact table and notes',async t=>{
  const {w}=await parentUI(t),{seen,maxActive}=t027Fetch(w);
  const button=w.document.querySelector('#parent-diag');
  assert.equal(button.previousElementSibling.tagName,'NAV');
  assert.equal(button.nextElementSibling.id,'parent-notice');
  const running=button.onclick();
  assert.equal(button.disabled,true);assert.equal(button.textContent,'診斷中…');
  assert.equal(w.document.querySelector('#parent-diag-table tbody').children.length,0);
  await button.onclick(); // Even direct duplicate handler calls cannot start a second run.
  await tick();await tick();
  assert.ok(w.document.querySelector('#parent-diag-table tbody').children.length>0);
  await running;
  const rows=[...w.document.querySelectorAll('#parent-diag-table tbody tr')];
  assert.equal(rows.length,9);assert.equal(maxActive(),1);
  assert.deepEqual([...w.document.querySelectorAll('#parent-diag-table th')].map(x=>x.textContent),['次','動作','往返(秒)','後端總計','開表','等鎖','讀表','讀表次數','快取']);
  assert.deepEqual(rows.map(r=>r.children[0].textContent),Array.from({length:9},(_,i)=>String(i+1)));
  assert.deepEqual(rows.map(r=>r.children[1].textContent),['ping','ping','ping','獎勵清單','獎勵清單','獎勵清單','我的申請','我的申請','我的申請']);
  for(const row of rows){
    assert.match(row.children[2].textContent,/^\d+\.\d{2}$/);
    assert.deepEqual([...row.children].slice(3,8).map(c=>c.textContent),['13','3','2','4','2']);
  }
  assert.deepEqual(rows.map(r=>r.children[8].textContent),['否','否','否','否','是','否','否','否','否']);
  assert.deepEqual(seen.map(r=>r.action),['pingLite','pingLite','pingLite','rewardList','rewardList','rewardList','myRedeems','myRedeems','myRedeems']);
  for(const r of seen){
    assert.equal(Object.hasOwn(r,'session'),false);assert.equal(Object.hasOwn(r,'pin'),false);
    assert.deepEqual(Object.keys(r).sort(),(r.action==='pingLite'?['action','code']:r.action==='rewardList'?['action','code','playerId','withRedeems']:['action','code','playerId']).sort());
    if(r.action!=='pingLite')assert.equal(r.playerId,w.eval('ACTIVE_PLAYER'));
    if(r.action==='rewardList')assert.equal(r.withRedeems,true);
  }
  assert.deepEqual([...w.document.querySelectorAll('#parent-diag-panel > p')].map(p=>p.textContent),t027Notes);
  assert.equal(button.disabled,false);assert.equal(button.textContent,'連線診斷');
  await button.onclick();assert.equal(seen.length,18);assert.equal(w.document.querySelectorAll('#parent-diag-table tbody tr').length,9);
});

test('T027 diagnostics continue after server errors and escape error codes',async t=>{
  for(const code of ['server_error','<img src=x onerror=alert(1)>']){
    const {w}=await parentUI(t),{seen}=t027Fetch(w,(r,n)=>n===2?{ok:false,code}:undefined);
    await w.document.querySelector('#parent-diag').onclick();
    const rows=w.document.querySelectorAll('#parent-diag-table tbody tr');
    assert.equal(rows.length,9);assert.equal(seen.length,9);
    assert.match(rows[1].children[2].textContent,/^\d+\.\d{2}$/);
    assert.equal(rows[1].children[3].colSpan,6);assert.equal(rows[1].children[3].textContent,'失敗：'+code);
    assert.equal(rows[1].querySelector('img'),null);
    assert.equal(w.document.querySelectorAll('#parent-diag-panel > p').length,6);
    assert.equal(w.document.querySelector('#parent-diag').disabled,false);
  }
});

test('T027 diagnostics show dashes for legacy responses without timing',async t=>{
  const {w}=await parentUI(t);t027Fetch(w,r=>r.action==='rewardList'?{ok:true}:undefined);
  await w.document.querySelector('#parent-diag').onclick();
  const rows=[...w.document.querySelectorAll('#parent-diag-table tbody tr')];
  assert.equal(rows.length,9);
  for(const row of rows.slice(3,6))assert.deepEqual([...row.children].slice(3).map(c=>c.textContent),Array(6).fill('—'));
});

test('T027 diagnostics stop on parentLock or tab navigation without writing detached rows',async t=>{
  for(const leave of ['lock','tab']){
    const {w}=await parentUI(t),fetch=w.fetch,seen=[];let release;
    const gate=new Promise(r=>release=r);
    w.fetch=async(u,o)=>{
      const r=JSON.parse(o.body);
      if(r.action==='pingLite'){seen.push(r);await gate;return {json:async()=>({ok:true})}}
      return fetch(u,o);
    };
    const running=w.document.querySelector('#parent-diag').onclick(),body=w.document.querySelector('#parent-diag-table tbody');
    if(leave==='lock'){w.parentLock();await settle()}else await w.parentMain('players');
    release();await running;await settle();
    assert.equal(seen.length,1);assert.equal(body.children.length,0);
    assert.equal(w.document.querySelector('#parent-diag-panel'),null);
  }
});

test('T027 diagnostics survive an older parent list response or error',async t=>{
  for(const fail of [false,true]){
    const {w}=await parentUI(t),fetch=w.fetch;let release;
    const gate=new Promise(r=>release=r);
    w.fetch=async(u,o)=>{
      if(JSON.parse(o.body).action==='redeemList'){await gate;if(fail)throw Error('offline')}
      return fetch(u,o);
    };
    const loading=w.parentMain();
    t027Fetch(w);
    await w.document.querySelector('#parent-diag').onclick();
    release();await loading;
    assert.equal(w.document.querySelectorAll('#parent-diag-table tbody tr').length,9);
    assert.deepEqual([...w.document.querySelectorAll('#parent-diag-panel > p')].map(p=>p.textContent),t027Notes);
    assert.equal(w.document.querySelector('#parent-updating'),null);
  }
});
