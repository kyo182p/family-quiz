'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const {build}=require('../tools/build');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fq-child-'));
build({outDir:dir});
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const plain=x=>JSON.parse(JSON.stringify(x));
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r))};
function state(){return {ok:true,consent:true,subjects:{math:{weak:[{key:'wabc',tag:'neg',w:1,streak:0}],review:[0,1].map(i=>({key:'wabc',tag:'neg',qidSeen:['seen'+i],step:0,dueAt:0}))},zh:{weak:[],review:[]}},checks:[{checkId:'check1',subject:'math',items:Array.from({length:5},(_,i)=>({id:'checkq'+i,q:'秘密題目 '+i+' 哪個不是水果？',o:['石頭','蘋果']}))}]}}
function bank(subject='數學'){return {id:'bank1',subject,questions:Array.from({length:30},(_,i)=>({id:'bankq'+i,t:'mc',q:'第 '+i+' 題不是哪一個？',o:['甲','乙'],a:'甲',sk:[i<15?'neg':'ctx']}))}}
async function open(t,s=state()){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e)});
  const dom=new JSDOM(html,{url:'https://quiz.invalid',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.speechSynthesis={cancel(){},getVoices(){return []},speak(){},addEventListener(){}}}});
  t.after(()=>{dom.window.close();assert.deepEqual(errors,[])});await settle();
  const w=dom.window,base=w.fetch,requests=[];let offline=true;
  w.fetch=async(url,opts)=>{const req=JSON.parse(opts.body);if(req.action==='diag_childState')return {json:async()=>s};if(req.action==='diag_postEvents'){requests.push(req);if(offline)throw Error('offline');return {json:async()=>({ok:true,accepted:req.events.map(e=>e.eid)})}}return base(url,opts)};
  // Scripts have executed; remove source nodes so body assertions inspect the rendered DOM.
  w.document.querySelectorAll('script').forEach(n=>n.remove());
  await w.libHome();await settle();
  return {w,s,requests,online:()=>{offline=false},offline:()=>{offline=true},real:()=>{w.fetch=base}};
}
function childDOM(w){const body=w.document.body;assert.doesNotMatch(body.textContent,/弱點|粗心|檢定/);for(const el of body.querySelectorAll('*'))for(const attr of el.attributes)assert.doesNotMatch(attr.value,/弱點|粗心|檢定/)}
test('T035 K: home shows subject challenge and two due friends; child DOM uses child wording',async t=>{const {w}=await open(t);assert.match(w.document.body.textContent,/數學挑戰/);assert.match(w.document.body.textContent,/老朋友來找你了：2 題/);childDOM(w)});
test('T035 K: failed or declined childState hides cards without blocking home',async t=>{const {w}=await open(t,{ok:true,consent:false});assert.ok(w.document.getElementById('app').textContent.includes('題庫書架'));assert.equal(w.document.querySelectorAll('#diag-home article').length,0);w.fetch=async()=>{throw Error('offline')};await w.libHome();await settle();assert.equal(w.document.querySelectorAll('#diag-home article').length,0)});
test('T035 H: five immediate answers enqueue five valid events without correctness; AI labels on every question',async t=>{
  const {w,s}=await open(t);w.viewCheck(s.checks[0]);
  for(let i=0;i<5;i++){assert.match(w.document.querySelector('#diag-view .tag.ai').textContent,/AI 出的題/);assert.doesNotMatch(w.document.getElementById('app').textContent,/答對|答錯|正確答案/);assert.equal(w.document.querySelectorAll('.right,.wrong').length,0);childDOM(w);w.document.querySelector('[data-diag-opt="0"]').click()}
  await settle();const events=plain(w.eval('evQueue'));assert.equal(events.length,5);
  for(const e of events){assert.equal(e.subject,'math');assert.equal(e.checkId,'check1');assert.equal(e.mode,'check');assert.equal(e.pick,0);assert.equal(e.first,0);assert.equal(e.moved,0);assert.equal('ok' in e,false);assert.equal(typeof e.sec,'number');assert.equal('chg' in e,false);assert.equal(e.retry,0)}
  assert.match(w.document.getElementById('app').textContent,/做完了！可以給爸媽看。/);assert.equal(w.localStorage.getItem('diag-check:p1:check1'),null);
  assert.doesNotMatch(w.localStorage.getItem('diag-evq'),/秘密題目|水果|蘋果/);childDOM(w);
});
test('T035 H: pause/resume stores only indices and seconds; previous answer changes do not duplicate events',async t=>{
  const {w,s}=await open(t);w.viewCheck(s.checks[0]);w.document.querySelector('[data-diag-opt="0"]').click();w.document.getElementById('diag-pause').click();await settle();
  const progress=JSON.parse(w.localStorage.getItem('diag-check:p1:check1'));assert.deepEqual(Object.keys(progress).sort(),['answers','seconds']);assert.deepEqual(progress.answers,[0]);assert.doesNotMatch(JSON.stringify(progress),/秘密題目|石頭/);
  w.viewCheck(s.checks[0]);assert.match(w.document.getElementById('app').textContent,/第 2 \/ 5 題/);w.document.getElementById('diag-prev').click();w.document.querySelector('[data-diag-opt="1"]').click();assert.equal(w.eval('evQueue.length'),1);assert.equal(JSON.parse(w.localStorage.getItem('diag-check:p1:check1')).answers[0],1);
  w.document.dispatchEvent(new w.Event('visibilitychange'));childDOM(w);
  assert.equal(w.eval('evQueue[0].pick'),1);assert.equal(w.eval('evQueue[0].first'),0);assert.equal(w.eval('evQueue[0].moved'),1);
});
test('T035 L: offline queue status is exact; online retry clears accepted IDs and never sends text',async t=>{
  const a=await open(t),{w,s}=a;w.viewCheck(s.checks[0]);w.document.querySelector('[data-diag-opt="0"]').click();w.document.getElementById('diag-pause').click();await settle();
  assert.equal(w.document.querySelector('[data-diag-status]').textContent,'有 1 題作答紀錄還沒送出，連上網路後會自動補送。');assert.equal(JSON.parse(w.localStorage.getItem('diag-evq')).length,1);
  a.online();w.dispatchEvent(new w.Event('online'));await settle();assert.equal(w.eval('evQueue.length'),0);assert.equal(w.document.querySelector('[data-diag-status]').textContent,'');assert.doesNotMatch(JSON.stringify(a.requests),/秘密題目|石頭|蘋果/);
});
test('T035 K: composeRound uses only current subject, half weighted, fades streaks and prioritizes due friends',async t=>{
  const {w,s}=await open(t);w.b=bank();w.s=s;const round=plain(w.eval('diagPracticeItems(b,s)'));assert.equal(round.length,12);assert.ok(round.filter(x=>x.kind!=='normal').length>=5);assert.ok(round.filter(x=>x.kind!=='normal').length<=6);assert.ok(round.some(x=>x.kind==='old'));
  w.b=bank('國語');assert.equal(w.eval('diagPracticeItems(b,s).filter(x=>x.kind!=="normal").length'),0);
  w.b=bank('音樂');assert.equal(w.eval('diagPracticeItems(b,s).filter(x=>x.kind!=="normal").length'),0);
  w.b=bank();w.s.subjects.math.weak[0].streak=10;w.s.subjects.math.review=[];assert.equal(w.eval('diagPracticeItems(b,s).filter(x=>x.kind!=="normal").length'),0);
});
test('T035 K/scf: practice UI uses helper and records wrong answers for 1, 3, 7 day reviews',async t=>{
  const {w}=await open(t);w.b=bank();await w.diagPractice(w.b);childDOM(w);assert.ok(w.document.getElementById('diag-view'));
  // Actual wrong-answer path schedules the first reminder; retry insertion stays in memory.
  w.document.querySelector('[data-diag-opt="1"]').click();w.document.getElementById('diag-next').click();w.document.getElementById('diag-next').click();await settle();
  const e=plain(w.eval('evQueue[0]'));assert.equal(e.ok,0);assert.equal(e.mode,'prac');
  const result=w.eval(`(()=>{const start=Date.now(),e={tags:'neg',qid:'first',mode:'prac',ok:0,retry:0};let r=scheduleReview([],e,DIAG_CFG,start);const days=[(r[0].dueAt-start)/86400000];for(let i=0;i<2;i++){const now=r[0].dueAt;r=scheduleReview(r,{...e,mode:'rev',ok:1,qid:'next'+i},DIAG_CFG,now);days.push((r[0].dueAt-now)/86400000)}return days})()`);assert.deepEqual(plain(result),[1,3,7]);childDOM(w);
});
test('T035 scf: neg/count/evidence helper interactions and check helper do not reveal answers',async t=>{
  const {w}=await open(t);for(const [tag,extra] of [['neg',{}],['cnt',{items:[{t:'甲',yes:true},{t:'乙',yes:false}]}],['evi',{ptext:'小明看見花。花是紅色。',ev:'花是紅色。'}]]){
    w.item={q:{id:'helperq',t:'mc',q:'哪個不是水果？',o:['甲','乙'],a:'甲',sk:[tag],...extra}};w.tag=tag;
    w.eval("diagStart({pid:ACTIVE_PLAYER,subject:'math',mode:'prac',profile:{tags:{[tag]:{w:1,scf:2}}},items:[item]})");childDOM(w);
    if(tag==='neg'){assert.equal(w.document.querySelector('[data-diag-opt]').disabled,true);w.document.getElementById('diag-word-alt').click();assert.equal(w.document.querySelector('[data-diag-opt]').disabled,false)}
    if(tag==='cnt'){w.document.querySelector('[data-tick="0"][data-yes="true"]').click();w.document.querySelector('[data-tick="1"][data-yes="false"]').click();assert.equal(w.document.querySelector('[data-diag-opt]').disabled,false)}
    if(tag==='evi'){w.document.querySelector('[data-diag-opt]').click();w.document.getElementById('diag-next').click();w.document.querySelector('[data-sentence="1"]').click();assert.equal(w.document.getElementById('diag-next').disabled,false)}
  }
});
test('T035 21fc6a6: helper buttons use theme card/ink/line and selected borders in dark and blackboard',()=>{for(const rule of [/\.w,\.tick button,\.sent\{[^}]*background:var\(--card\);color:var\(--ink\)/,/\.tick button\[aria-pressed="true"\]\{[^}]*border-color:var\(--leaf-strong\)/,/\.w:disabled,\.tick button:disabled,\.sent:disabled\{[^}]*color:var\(--ink\)/])assert.match(html,rule)});
test('T035 scope: shared blocks remain byte identical to backend and only authorized files change',()=>{const front=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),back=fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8');const block=s=>s.slice(s.indexOf('// ==DIAG-SHARED-BEGIN=='),s.indexOf('// ==DIAG-SHARED-END==')+'// ==DIAG-SHARED-END=='.length);assert.equal(block(front),block(back))});
test('T035 integration: backend accepts child events and completes the challenge without a parent session',async t=>{
  const a=await open(t),{w}=a;a.real();
  const auth=await w.api('parentSetPin',{setupCode:'MOCK2345',pin:'246810'}),parent=(action,data={})=>w.api(action,{playerId:'p1',session:auth.session,...data});
  w.localStorage.setItem('diag-ckey:p1',(await parent('diag_issueChildKey')).childKey);
  await parent('diag_consent',{agree:true});
  const exam=await parent('diag_analyzeExam',{subject:'math',grade:1,term:1,examDate:'2026-11-01',codes:['N-1-1'],pages:[{n:1,b64:'ZmFrZQ=='}]});
  await parent('diag_confirmExam',{examId:exam.examId,items:[]});
  await parent('diag_makeCheck',{examId:exam.examId,whitelist:[{code:'N-1-1',grade:1}],words:[]});
  const state=await w.diagChildState('p1');assert.ok(state.checks.length);const check=state.checks[0];w.viewCheck(check);
  for(let i=0;i<check.items.length;i++)w.document.querySelector('[data-diag-opt="1"]').click();
  await w.flushEvents();assert.equal(w.eval('evQueue.length'),0,JSON.stringify(plain(w.eval('evQueue'))));assert.equal((await w.api('diag_childState',{playerId:'p1',childKey:w.localStorage.getItem('diag-ckey:p1')})).checks.length,0);
});
test('T035 telemetry: answer changes use WR, hidden interruption is recorded, and text fields are discarded',async t=>{
  const {w}=await open(t);w.b=bank();await w.diagPractice(w.b);
  Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'hidden'});w.document.dispatchEvent(new w.Event('visibilitychange'));
  w.document.querySelector('[data-diag-opt="1"]').click();w.document.querySelector('[data-diag-opt="0"]').click();w.document.getElementById('diag-next').click();w.document.getElementById('diag-next').click();await settle();
  const e=plain(w.eval('evQueue[0]'));assert.equal(e.chg,'WR');assert.equal(e.intr,1);
  w.extra={...e,eid:'allowlist1',q:'秘密題目',name:'秘密暱稱',photo:'data:image/jpeg'};w.eval('evPush(extra)');assert.doesNotMatch(w.localStorage.getItem('diag-evq'),/秘密|data:image/);
});
test('T035 entry: selected bank and built-in bank expose the twelve-question practice button',async t=>{const {w}=await open(t);w.home();assert.equal(w.document.getElementById('diag-practice').textContent,'練習 12 題');childDOM(w)});
