'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom'),{build}=require('../tools/build');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'diag-practice-'));build({outDir:dir});
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const tick=()=>new Promise(r=>setImmediate(r));async function settle(){for(let i=0;i<8;i++)await tick()}
async function open(t){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e)});
  const dom=new JSDOM(html,{url:'https://quiz.invalid/',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){}});w.speechSynthesis={cancel(){},getVoices(){return []},addEventListener(){}};}});
  const w=dom.window;await settle();t.after(()=>{w.close();assert.deepEqual(errors,[])});
  await w.api('parentSetPin',{setupCode:'MOCK2345',pin:'246810'});
  const {session}=await w.api('parentLogin',{pin:'246810'});await w.api('diag_consent',{session,playerId:'p1',agree:true});
  return w;
}
function rows(w,name){return JSON.parse(w.localStorage.getItem('mock-gas-state')).books.find(b=>b.id==='mock-diag').sheets.find(s=>s.name===name).data}
function events(w){const [keys,...data]=rows(w,'events');return data.map(row=>Object.fromEntries(keys.map((k,i)=>[k,row[i]])))}
async function profile(w){return (await w.api('diag_getProfile',{playerId:'p1'})).profile}
async function seed(w,tags=['neg','cnt']){
  const events=tags.flatMap(tag=>Array.from({length:6},(_,i)=>({ts:w.Date.now(),eid:w.diagId(),qid:'seed-'+tag+'-'+i,bank:'',tags:tag,ok:i<3?0:1,sec:2,len:20,chg:'0',scf:0,scok:'',mode:'diag',sid:'seed',retry:0,intr:0})));
  return (await w.api('diag_postEvents',{playerId:'p1',events})).profile;
}
const run=w=>w.eval('diagRun');
function press(w,el,key='Enter'){el.focus();el.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}))}
function choose(w,correct=true,keyboard=false){const r=run(w),q=r.items[r.index].q,i=w.diagOptions(q).findIndex((_,i)=>w.diagCorrect(q,i)===correct),b=w.document.querySelector('[data-diag-opt="'+i+'"]');if(keyboard)press(w,b,' ');else b.click()}
function next(w,keyboard=false){const b=w.document.getElementById('diag-next');if(keyboard)press(w,b);else b.click()}
function unlock(w,keyboard=false){
  const s=run(w).scaffold,q=run(w).items[run(w).index].q;
  if(s.level===2&&s.kind==='neg'){const b=w.document.getElementById('diag-word-alt');if(keyboard)press(w,b);else b.click()}
  if(s.level&&s.kind==='count')q.items.forEach((x,i)=>{const b=w.document.querySelector('[data-tick="'+i+'"][data-yes="'+x.yes+'"]');if(keyboard)press(w,b,' ');else b.click()});
}
function evidence(w,keyboard=false){const s=run(w).scaffold;if(s.ask&&!s.done){const b=w.document.querySelector('[data-sentence="'+s.evidence+'"]');if(keyboard)press(w,b);else b.click()}}
function answer(w,correct=true,keyboard=false){unlock(w,keyboard);choose(w,correct,keyboard);next(w,keyboard);evidence(w,keyboard);next(w,keyboard)}
// Focused component tests replace only the exposed runner's items/profile; round composition
// and backend scheduling tests below use real composition and diag_postEvents profiles.
async function fixture(w,tag,level=2,n=1,extra={}){
  await w.viewDiag(true,'prac');
  w.__fixture={tag,level,n,extra};
  w.eval(`{const {tag,level,n,extra}=window.__fixture;diagRun.profile.tags[tag]={w:1,scf:level};diagRun.items=Array.from({length:n},(_,i)=>({q:{...DIAG_BANK.find(q=>primaryTag(q)===tag),id:'fixture-'+tag+'-'+i,...extra},kind:'weak',retry:0}));diagRun.index=0;diagRun.scaffold=null;diagQuestion()}`);
}
test('T031 weighted twelve-question round uses backend weights, spaced helpers and parent-only ratio',async t=>{
  const w=await open(t);const p=await seed(w);assert.equal(p.tags.neg.w,1);assert.equal(p.tags.cnt.w,1);
  await w.diagHomeCard();assert.ok(w.document.getElementById('diag-practice'));assert.equal(w.document.getElementById('diag-ratio'),null);
  w.document.getElementById('diag-practice').click();await settle();
  const items=run(w).items;assert.equal(items.length,12);const weak=items.filter(x=>x.kind!=='normal');assert.ok(weak.length>=5&&weak.length<=6);
  assert.equal(items[0].kind,'normal');assert.equal(items[11].kind,'normal');let consecutive=0;for(const x of items){consecutive=x.kind==='normal'?0:consecutive+1;assert.ok(consecutive<=2)}
  w.eval('diagRun=null');w.location.hash='parent';await settle();for(const k of '246810')w.document.querySelector('[data-pin-key="'+k+'"]').click();await settle();w.document.querySelector('[data-parent-tab="learn"]').click();await settle();
  const slider=w.document.getElementById('diag-ratio');assert.equal(slider.min,'20');assert.equal(slider.max,'50');assert.equal(slider.step,'5');assert.equal(slider.value,'50');slider.value='20';slider.dispatchEvent(new w.Event('input'));assert.equal(w.localStorage.getItem('diag-ratio:p1'),'20');
  const limited=w.eval('diagPracticeItems('+JSON.stringify(p)+',"p1")');assert.ok(limited.filter(x=>x.kind!=='normal').length<=2);
});
test('T031 neg L2 locks choices, wrong tap hints, keyboard alternative records scf 2 scok 0; L1 marks word',async t=>{
  const w=await open(t);await fixture(w,'neg');assert.ok([...w.document.querySelectorAll('[data-diag-opt]')].every(b=>b.disabled));
  w.diagSelect(0);assert.equal(run(w).last,null);w.document.querySelector('.w').click();assert.match(w.document.getElementById('diag-hint').textContent,/再找找看/);
  press(w,w.document.getElementById('diag-word-alt'));assert.ok([...w.document.querySelectorAll('[data-diag-opt]')].every(b=>!b.disabled));choose(w);next(w);next(w);await w.flushEvents();
  const e=events(w).at(-1);assert.equal(e.scf,2);assert.equal(e.scok,0);
  await fixture(w,'neg',1);assert.ok(w.document.querySelector('.mark-neg'));assert.equal(w.document.querySelector('.w'),null);assert.ok([...w.document.querySelectorAll('[data-diag-opt]')].every(b=>!b.disabled));answer(w);await w.flushEvents();assert.equal(events(w).at(-1).scok,'');
});
test('T031 count requires every judgement, unlocks and sends only aggregate scok',async t=>{
  const w=await open(t);await fixture(w,'cnt');const q=run(w).items[0].q;
  q.items.forEach((x,i)=>{assert.ok(w.document.querySelector('[data-diag-opt]').disabled);w.document.querySelector('[data-tick="'+i+'"][data-yes="'+x.yes+'"]').click()});
  assert.match(w.document.getElementById('diag-count-left').textContent,/還有 0 個沒打勾/);assert.equal(w.document.querySelector('[data-diag-opt]').disabled,false);choose(w);next(w);next(w);await w.flushEvents();assert.equal(events(w).at(-1).scok,1);assert.equal(events(w).at(-1).scf,2);
  assert.equal('picks' in events(w).at(-1),false);
});
test('T031 evidence waits for sentence, hints near N, flashes on second miss and L1 asks every second item',async t=>{
  const w=await open(t);await fixture(w,'evi');choose(w);next(w);assert.equal(w.document.getElementById('diag-next').disabled,true);
  const wrong=w.document.querySelector('[data-sentence="1"]');wrong.click();assert.match(w.document.getElementById('diag-evidence-hint').textContent,/答案在第 1 句附近/);w.diagNext();assert.ok(w.document.getElementById('diag-view'));
  wrong.click();assert.ok(w.document.querySelector('.sent.flash'));assert.equal(w.document.getElementById('diag-next').disabled,false);next(w);await w.flushEvents();assert.equal(events(w).at(-1).scok,0);
  await fixture(w,'evi',1,2);assert.equal(w.document.querySelector('.sent'),null);answer(w);assert.ok(w.document.querySelector('.sent'));answer(w);await w.flushEvents();assert.deepEqual(events(w).slice(-2).map(e=>e.scok),['',1]);
});
test('T031 five correct neg practices with correct scaffold fade backend level 2 to 1',async t=>{
  const w=await open(t);await seed(w,['neg']);assert.equal((await profile(w)).tags.neg.scf,2);await fixture(w,'neg',2,5);for(let i=0;i<5;i++)answer(w);await settle();await w.flushEvents();assert.equal((await profile(w)).tags.neg.scf,1);assert.match(w.document.getElementById('diag-done').textContent,/練習完成！.*本回合答對 5 題/s);assert.doesNotMatch(w.document.getElementById('diag-done').textContent,/neg|否定|弱點|粗心|不會/);
});
test('T031 nonweak or unsupported questions and diagnostic mode never apply scaffolds',async t=>{
  const w=await open(t);for(const tag of ['neg','cnt','evi']){await fixture(w,tag);w.eval('diagRun.profile.tags={};diagRun.scaffold=null;diagQuestion()');assert.equal(w.document.querySelector('.w,.tick,.sent'),null);assert.doesNotMatch(w.document.querySelector('.tags').textContent,/讀題小幫手/)}
  for(const [tag,extra] of [['neg',{q:'請選一種動物。'}],['cnt',{items:null}],['evi',{ptext:''}]]){await fixture(w,tag,2,1,extra);assert.equal(run(w).scaffold.level,0);assert.equal(w.document.querySelector('.w,.tick,.sent'),null)}
  await seed(w,['neg','cnt','evi']);await w.viewDiag(true);assert.equal(w.document.querySelector('.w,.tick,.sent'),null);
});
test('T031 first wrong answer conceals solution, retries after 3–5 questions with reordered mc and retry event',async t=>{
  const w=await open(t);await fixture(w,'neg',0,8);const q=run(w).items[0].q,order=[...q.o];choose(w,false);next(w);
  assert.equal(w.document.getElementById('diag-feedback').textContent,'等一下再看一次');assert.equal(w.document.querySelector('.ok'),null);assert.ok(!w.document.getElementById('app').textContent.includes(q.why));
  const retryIndex=run(w).items.findIndex(x=>x.retry===1);assert.ok(retryIndex>=4&&retryIndex<=6);next(w);
  for(let i=1;i<retryIndex;i++)answer(w);assert.equal(run(w).items[run(w).index].q.id,q.id);assert.match(w.document.querySelector('.tag.retry').textContent,/再看一次/);assert.notDeepEqual([...run(w).items[run(w).index].q.o],order);
  choose(w,false);next(w);assert.match(w.document.getElementById('diag-feedback').textContent,/正確答案/);assert.ok(w.document.querySelector('.ok'));next(w);await w.flushEvents();const e=events(w).find(e=>e.qid===q.id&&e.retry===1);assert.ok(e);assert.equal(e.mode,'prac');
});
test('T031 final-item retry stays at end, tf order is stable, pause resumes feedback without duplicate retry',async t=>{
  const w=await open(t);await fixture(w,'neg',0,1,{t:'tf',a:'O'});choose(w,false);next(w);assert.equal(run(w).items.length,2);w.document.getElementById('diag-pause').click();await settle();await w.viewDiag();w.document.getElementById('diag-resume').click();assert.equal(run(w).items.length,2);assert.equal(w.document.getElementById('diag-feedback').textContent,'等一下再看一次');next(w);assert.deepEqual([...w.diagOptions(run(w).items[1].q)],['對','錯']);answer(w);await w.flushEvents();assert.equal(events(w).at(-1).retry,1);assert.equal(events(w).at(-2).intr,1);
});
test('T031 wrong answer schedules tomorrow, clock reveals old friend with unseen same-tag question and rev mode',async t=>{
  const w=await open(t),now=w.Date.now();w.Date.now=()=>now;await fixture(w,'neg',0);const qid=run(w).items[0].q.id;choose(w,false);next(w);next(w);answer(w);await settle();await w.flushEvents();
  const p=await profile(w);assert.equal(p.review[0].dueAt,now+86400000);await w.libHome();await settle();assert.equal(w.document.querySelector('.friends'),null);
  w.Date.now=()=>now+86400000;await w.diagHomeCard();assert.match(w.document.querySelector('.friends').textContent,/今天有 1 題老朋友要複習/);await w.viewDiag(true,'prac');const old=run(w).items.find(x=>x.kind==='old');assert.ok(old);assert.equal(old.tag,'neg');assert.notEqual(old.q.id,qid);assert.ok(run(w).items.filter(x=>x.kind==='old').length<=3);
  while(run(w)&&run(w).items[run(w).index].kind!=='old')answer(w);assert.match(w.document.querySelector('.tags').textContent,/老朋友/);const oldid=run(w).items[run(w).index].q.id;answer(w);await w.flushEvents();assert.equal(events(w).find(e=>e.qid===oldid).mode,'rev');
});
test('T031 review selection prefers family unseen ids, skips exhausted tags and caps old friends at three',async t=>{
  const w=await open(t);await seed(w,['neg','cnt','evi','qnt']);
  w.eval(`{const p=diagRead('diag-profile:p1',null);window.reviewProfile=emptyProfile();reviewProfile.tags={neg:{w:1},cnt:{w:1},evi:{w:1},qnt:{w:1}};reviewProfile.review=['neg','cnt','evi','qnt'].map(tag=>({tag,qidSeen:[],dueAt:Date.now(),step:0}));store.set(LS_BANKS,{family:{id:'family',questions:[{...DIAG_BANK[0],id:'family-new',sk:['neg']}]}})}`);
  const items=w.eval('diagPracticeItems(reviewProfile,"p1")'),old=items.filter(x=>x.kind==='old');assert.equal(old.length,3);assert.ok(old.some(x=>x.q.id==='family-new'&&x.bankId==='family'));
  w.eval(`reviewProfile.review=[{tag:'neg',qidSeen:['family-new',...DIAG_BANK.filter(q=>primaryTag(q)==='neg').map(q=>q.id)],dueAt:Date.now(),step:0}]`);assert.equal(w.eval('diagPracticeItems(reviewProfile,"p1").filter(x=>x.kind==="old").length'),0);
});
test('T031 retest card respects 31 versus 10 days and exam window plus minimum fourteen-day gap',async t=>{
  const w=await open(t),now=w.Date.now();w.Date.now=()=>now;
  async function draw(days,exam){const p=await profile(w);p.lastDiag={at:now-days*86400000};if(exam!==undefined)p.lastExam={at:now-exam*86400000};const fetch=w.fetch;w.fetch=async()=>{throw Error('offline')};w.localStorage.setItem('diag-profile:p1',JSON.stringify(p));await w.libHome();await w.diagHomeCard();w.fetch=fetch;return w.document.getElementById('diag-card').textContent}
  assert.match(await draw(31),/距離上次檢定 31 天/);assert.doesNotMatch(await draw(10),/距離上次檢定/);assert.match(await draw(14,3),/段考後做一次學習檢定/);assert.doesNotMatch(await draw(13,4),/段考後/);assert.doesNotMatch(await draw(20,8),/段考後/);
});
test('T031 AI and builtin source tags appear in diag, practice, plant and family renderers',async t=>{
  const w=await open(t);await w.viewDiag(true);assert.match(w.document.querySelector('.tags').textContent,/內建題/);w.eval("diagRun.items[0].q={...diagRun.items[0].q,src:'AI'};diagQuestion()");assert.equal(w.document.querySelector('.tag.ai').textContent,'AI 出題');
  await fixture(w,'neg',0,1,{src:'改寫'});assert.equal(w.document.querySelector('.tag.ai').textContent,'AI 出題');
  w.eval(`diagRun=null;CTX=PLANT_CTX;start([{id:'source-plant',u:'root',t:'mc',q:'植物測試題',o:['甲','乙'],a:'甲',why:'說明',src:'AI'}])`);assert.equal(w.document.querySelector('.tag.ai').textContent,'AI 出題');
  w.eval(`CTX=bankCtx({id:'source-family',title:'測試題庫',questions:[],rec:{}});start([{id:'source-family-q',t:'mc',q:'家庭測試題',o:['甲','乙'],a:'甲',why:'說明',src:'AI'}])`);assert.equal(w.document.querySelector('.tag.ai').textContent,'AI 出題');assert.equal(w.diagSource({src:'原題'}),'');
});
test('T031 keyboard keydown Enter and Space alone completes neg L2, count and evidence',async t=>{
  const w=await open(t);for(const tag of ['neg','cnt','evi']){await fixture(w,tag);answer(w,true,true);assert.ok(w.document.getElementById('diag-done'))}await w.flushEvents();const e=events(w);assert.equal(e.length,3);assert.ok(e.every(x=>x.ok===1&&x.scf===2&&x.scok===1));
});
test('T031 qnt uses literal offsets after emoji, neg repeated wrong taps flash and pause letters for two seconds',async t=>{
  const w=await open(t);await fixture(w,'qnt',2,1,{q:'🌱所有植物都靠種子繁殖嗎？'});
  const s=run(w).scaffold;assert.equal(s.hit.word,'所有');w.document.querySelector('[data-word="'+s.hit.at+'"]').click();assert.equal(w.document.querySelector('[data-diag-opt]').disabled,false);
  await fixture(w,'neg');const timeout=w.setTimeout;let resume;w.setTimeout=(fn,ms,...args)=>ms===2000?(resume=fn,1):timeout(fn,ms,...args);
  w.document.querySelector('.w').click();w.document.querySelector('.w').click();assert.ok(w.document.querySelector('.w.flash'));assert.ok([...w.document.querySelectorAll('.w')].every(b=>b.disabled));assert.ok(resume);resume();assert.ok([...w.document.querySelectorAll('.w')].every(b=>!b.disabled));w.setTimeout=timeout;
});
test('T031 family passage uses passageOf, count without helper lists text, legacy question remains normal',async t=>{
  const w=await open(t);await fixture(w,'evi',2,1,{p:'family-p',ptext:'',ev:'小熊帶了雨傘。'});
  w.eval(`store.set(LS_BANKS,{reading:{id:'reading',questions:[{id:'legacy-q',t:'mc',q:'舊題',o:['甲','乙'],a:'甲'}],passages:[{id:'family-p',title:'家庭文章',text:'小熊帶了雨傘。天空烏雲密布！'}]}});diagRun.items[0].bankId='reading';diagRun.scaffold=null;diagQuestion()`);
  assert.equal(w.document.querySelectorAll('.sent').length,2);answer(w);await w.flushEvents();assert.equal(events(w).at(-1).scok,1);
  await fixture(w,'cnt',0);assert.ok(w.document.querySelector('li'));assert.equal(w.document.querySelector('.tick'),null);
  assert.ok(w.eval('diagPracticeItems(emptyProfile(),"p1").some(x=>x.q.id==="legacy-q"&&x.kind==="normal")'));
});
