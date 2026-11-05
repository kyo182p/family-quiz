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
async function open(t,{storage={},query='',frame=false}={}){
  const errors=[],navigation=[],requests=[];
  const vc=new VirtualConsole();
  vc.on('jsdomError',e=>{if(e.message.includes('navigation'))navigation.push(e);else errors.push(e)});
  const dom=new JSDOM(html,{url:'https://quiz.invalid/'+query,runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    if(frame)Object.defineProperty(w,'self',{value:{}});
    w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
    w.speechSynthesis={cancel(){},getVoices(){return []},speak(){},addEventListener(){}};
    Object.defineProperty(w,'fetch',{configurable:true,set(fn){Object.defineProperty(w,'fetch',{configurable:true,writable:true,value:async(url,options)=>{if(String(url)==='mock://gas')requests.push(JSON.parse(options.body));return fn(url,options)}})}});
    for(const [k,v] of Object.entries(storage))w.localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));
  }});
  t.after(()=>{dom.window.close();assert.deepEqual(errors,[])});await settle();
  const w=dom.window;
  return {w,errors,navigation,requests,storage:()=>Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]))};
}
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
  const base={player:'"p2"','pdead:badges':'{}','pdead:lib-rec:x':'{}','p2:badges':'{}',badges:'{}','progress-demo':'{}'};
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

test('T005 disabled rows are last and inert; rejected/removed active players reload as p1 with notice',async t=>{
  const first=await open(t);const fetch=first.w.fetch;
  first.w.fetch=async(url,options)=>{
    const res=await fetch(url,options);if(JSON.parse(options.body).action!=='playerList')return res;
    const j=await res.json();j.players.find(p=>p.id==='p2').status='停用';return {json:async()=>j};
  };
  await first.w.playerSheet();const picks=first.w.document.querySelectorAll('[data-player]');assert.equal(picks[1].dataset.player,'p2');assert.equal(picks[1].disabled,true);assert.ok(picks[0].textContent.includes('使用中'));
  assert.equal(first.w.document.querySelector('[data-edit-player="p2"]'),null);
  for(const code of ['player_disabled','bad_player'])for(const action of ['saveBank','badges']){
    const a=await open(t,{storage:{player:'"p2"'}}),{w}=a;
    w.fetch=async()=>({json:async()=>({ok:false,code})});
    if(action==='badges')await w.badgeSync();else {w.testBank=bank();w.eval('applyView(testBank)');await w.eval('bsSave(testBank)')}
    assert.equal(JSON.parse(w.localStorage.getItem('player')),'p1');assert.equal(JSON.parse(w.localStorage.getItem('player-notice')),'這位玩家已被停用，先切回 小葉子');assert.ok(a.navigation.length>=1);
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
  clickApply(w,'mock-s');const first=w.document.getElementById('reward-send').onclick();const second=w.document.getElementById('reward-send').onclick();assert.equal(sent.length,1);assert.equal(w.document.getElementById('reward-send').disabled,true);release();await Promise.all([first,second]);
  assert.equal(w.document.getElementById('reward-send').textContent,'再試一次');await sendSheet(w);assert.equal(sent.length,2);assert.equal(sent[0].requestId,sent[1].requestId);assert.match(sent[0].requestId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
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
  let releaseMine;const gateMine=new Promise(r=>releaseMine=r);w.fetch=async(u,o)=>{if(JSON.parse(o.body).action==='myRedeems')await gateMine;return fetch(u,o)};
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
async function setupParentUI(w,pin='246810',code='MOCK2345',repeat=pin){
  w.document.getElementById('parent-code').value=code;
  w.document.getElementById('parent-new-pin').value=pin;
  w.document.getElementById('parent-repeat-pin').value=repeat;
  await w.document.querySelector('#parent-setup').onsubmit({preventDefault(){}});await settle();
}
async function parentUI(t,options){const a=await open(t,options);await parentRoute(a.w);await setupParentUI(a.w);return a}
async function typePin(w,pin,confirm=false){for(const n of pin)w.document.querySelector(`[data-pin-key="${n}"]`).click();if(confirm)w.document.querySelector('[data-pin-key="確定"]').click();await settle()}
const ptext=w=>w.document.getElementById('parent-page')?.textContent||'';
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
  await w.playerSheet();const pick=w.document.querySelector('[data-player="p2"]');assert.equal(pick.disabled,true);assert.ok(pick.closest('.player-off'));w.document.getElementById('player-close').click();
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
  const reader=await parentUI(t);reader.w.eval("READER={code:'READER'}");reader.w.parentLock();await settle();assert.ok(ptext(reader.w).includes('這台裝置還沒有輸入家庭邀請碼'));
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
