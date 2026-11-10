'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom'),{build}=require('../tools/build');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'diag-ui-'));build({outDir:dir});const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const tick=()=>new Promise(r=>setImmediate(r));async function settle(){for(let i=0;i<8;i++)await tick()}
async function open(t){
  const errors=[],requests=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e)});
  const dom=new JSDOM(html,{url:'https://quiz.invalid/',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){}});w.speechSynthesis={cancel(){},getVoices(){return []},addEventListener(){}};}});
  const w=dom.window;await settle();const fetch=w.fetch;w.fetch=async(u,o)=>{requests.push(JSON.parse(o.body));return fetch(u,o)};
  t.after(()=>{w.close();assert.deepEqual(errors,[])});return {w,requests};
}
function rows(w,name){return JSON.parse(w.localStorage.getItem('mock-gas-state')).books.find(b=>b.id==='mock-diag').sheets.find(s=>s.name===name).data}
async function parent(w){
  await w.api('parentSetPin',{setupCode:'MOCK2345',pin:'246810'});
  w.location.hash='parent';await settle();for(const key of '246810')w.document.querySelector('[data-pin-key="'+key+'"]').click();await settle();
  w.document.querySelector('[data-parent-tab="learn"]').click();await settle();
}
async function agree(w){await parent(w);const b=w.document.getElementById('diag-consent');assert.equal(b.disabled,true);w.document.getElementById('diag-agree').click();assert.equal(b.disabled,false);b.click();await settle();w.location.hash='';await settle()}
function key(w,k){w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}))}
async function complete(w){await w.viewDiag();for(let i=0;i<20;i++){assert.match(w.document.getElementById('diag-number').textContent,new RegExp('第 '+(i+1)+' / 20 題'));assert.match(w.document.querySelector('#diag-view .tags').textContent,/內建題|AI 出題/);assert.doesNotMatch(w.document.getElementById('app').textContent,/答對|答錯|弱點|粗心|不會/);key(w,'1');key(w,'Enter')}await settle();await w.flushEvents();await settle()}
test('T030 consent gate, parent checkbox, per-player consent version and withdrawal',async t=>{
  const {w}=await open(t);assert.match(w.document.getElementById('diag-card').textContent,/學習檢定要先請家長在家長頁同意/);assert.equal(w.document.getElementById('diag-start'),null);
  await agree(w);assert.equal(JSON.parse(rows(w,'profiles')[1][3]).consent.ver,'diag-consent-v1');assert.ok(w.document.getElementById('diag-start'));
  w.location.hash='parent';await settle();for(const k of '246810')w.document.querySelector('[data-pin-key="'+k+'"]').click();await settle();w.document.querySelector('[data-parent-tab="learn"]').click();await settle();w.document.getElementById('diag-revoke').click();await settle();assert.ok(w.document.getElementById('diag-consent'));assert.equal(JSON.parse(rows(w,'profiles')[1][3]).consent,null);
});
test('T030 keyboard completes 20 hidden-result questions and two reports compare seven tags',async t=>{
  const {w,requests}=await open(t);await agree(w);await complete(w);
  const events=rows(w,'events');assert.equal(events.length,21);const header=events[0];for(const row of events.slice(1)){assert.equal(row[header.indexOf('mode')],'diag');for(const k of ['ok','sec','chg'])assert.notEqual(row[header.indexOf(k)],undefined)}
  assert.ok(requests.filter(r=>r.action==='diag_postEvents').every(r=>r.events.length<=50&&r.events.every(e=>!('playerId' in e))));
  assert.match(w.document.getElementById('diag-done').textContent,/做完了！謝謝你/);assert.doesNotMatch(w.document.getElementById('diag-done').textContent,/\d+ 題對|否定題|答對|答錯/);
  async function report(){w.location.hash='parent';await settle();for(const k of '246810')w.document.querySelector('[data-pin-key="'+k+'"]').click();await settle();w.document.querySelector('[data-parent-tab="learn"]').click();await settle();const body=w.document.getElementById('diag-parent-body');assert.match(body.textContent,/學習檢定：20 題對/);assert.equal(body.querySelectorAll('.trow').length,7);for(const row of body.querySelectorAll('.trow'))assert.match(row.textContent,/\d+\/\d+/);assert.doesNotMatch(w.document.getElementById('app').textContent,/粗心|不會|笨|懶|比較差/);return body}
  assert.equal((await report()).querySelectorAll('s').length,0);w.location.hash='';await settle();await complete(w);assert.equal((await report()).querySelectorAll('s').length,7);
});
test('T030 changing a correct choice to wrong records RW, pauses and resumes without losing selection',async t=>{
  const {w}=await open(t);await agree(w);await w.viewDiag();const index=w.eval('diagOptions(diagRun.items[0].q).findIndex((_,i)=>diagCorrect(diagRun.items[0].q,i))');w.diagSelect(index);w.diagSelect(index===0?1:0);w.document.getElementById('diag-pause').click();await settle();assert.equal(JSON.parse(w.localStorage.getItem('diag-run:p1')).index,0);await w.viewDiag();w.document.getElementById('diag-resume').click();w.document.getElementById('diag-next').click();await w.flushEvents();const e=rows(w,'events');assert.equal(e[1][e[0].indexOf('chg')],'RW');
});
test('T030 no consent discards queued events and pending records',async t=>{
  const {w}=await open(t);w.evPush({playerId:'p1',eid:'testevent0000001'});await w.flushEvents();assert.equal(rows(w,'events').length,1);assert.deepEqual(JSON.parse(w.localStorage.getItem('diag-evq')),[]);
});
test('T030 offline completion keeps 20 events and automatically retries saved report',async t=>{
  const {w}=await open(t);await agree(w);const fetch=w.fetch;w.fetch=async()=>{throw Error('offline')};await complete(w);assert.match(w.document.getElementById('diag-done').textContent,/網路斷了，剛才 20 題/);assert.equal(JSON.parse(w.localStorage.getItem('diag-evq')).length,20);assert.equal(JSON.parse(w.localStorage.getItem('diag-pending-save')).length,1);
  w.fetch=fetch;[...w.document.querySelectorAll('button')].find(b=>b.textContent==='現在重送').click();await settle();await w.flushEvents();assert.equal(rows(w,'events').length,21);assert.equal(rows(w,'diags').length,2);assert.deepEqual(JSON.parse(w.localStorage.getItem('diag-evq')),[]);
});
test('T030 next question changes synchronously while a two-second event request is in flight',async t=>{
  const {w}=await open(t);await agree(w);await w.viewDiag();const fetch=w.fetch;let delayed=false;w.fetch=async(u,o)=>{if(JSON.parse(o.body).action==='diag_postEvents'){delayed=true;await new Promise(r=>w.setTimeout(r,2000))}return fetch(u,o)};
  for(let i=0;i<10;i++){key(w,'1');key(w,'Enter');assert.match(w.document.getElementById('diag-number').textContent,new RegExp('第 '+(i+2)+' / 20 題'))}assert.ok(delayed);await w.flushEvents();
});

test('T030 flush groups players in batches of fifty, shares one in-flight flush and updates caches',async t=>{
  const {w,requests}=await open(t);await agree(w);
  const {session}=await w.api('parentLogin',{pin:'246810'});
  await w.api('diag_consent',{session,playerId:'p2',agree:true});
  w.eval("evQueue=Array.from({length:57},(_,i)=>({playerId:i<55?'p1':'p2',ts:Date.now(),eid:diagId(),qid:'test'+i,bank:'',tags:'neg',ok:1,sec:2,len:10,chg:'0',scf:0,scok:'',mode:'diag',sid:'batch-test',retry:0,intr:0}));diagWrite('diag-evq',evQueue)");
  const fetch=w.fetch;let release;const gate=new Promise(r=>release=r);
  w.fetch=async(u,o)=>{if(JSON.parse(o.body).action==='diag_postEvents')await gate;return fetch(u,o)};
  const first=w.flushEvents();assert.equal(w.flushEvents(),first);release();await first;
  const batches=requests.filter(r=>r.action==='diag_postEvents');assert.deepEqual(batches.map(r=>[r.playerId,r.events.length]),[['p1',50],['p1',5],['p2',2]]);
  for(const r of batches)assert.ok(r.events.every(e=>!('playerId' in e)&&/^[a-z0-9]{16}$/.test(e.eid)));
  assert.equal(rows(w,'events').length,58);assert.deepEqual(JSON.parse(w.localStorage.getItem('diag-evq')),[]);
  for(const pid of ['p1','p2'])assert.equal(JSON.parse(w.localStorage.getItem('diag-profile:'+pid)).consent.ver,'diag-consent-v1');
});
