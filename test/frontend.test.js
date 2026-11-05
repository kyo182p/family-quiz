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
async function open(t,{storage={},query=''}={}){
  const errors=[],navigation=[],requests=[];
  const vc=new VirtualConsole();
  vc.on('jsdomError',e=>{if(e.message.includes('navigation'))navigation.push(e);else errors.push(e)});
  const dom=new JSDOM(html,{url:'https://quiz.invalid/'+query,runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
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
