'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom'),{build}=require('../tools/build'),{createGasEnv}=require('./fake-gas');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'diag-parent-'));build({outDir:dir});const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const plain=x=>JSON.parse(JSON.stringify(x));
async function settle(){for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r))}
async function open(t){
  const errors=[],requests=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e)});
  const dom=new JSDOM(html,{url:'https://quiz.invalid/',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){}});w.speechSynthesis={cancel(){},getVoices(){return []},addEventListener(){}};w.confirm=()=>{throw Error('confirm forbidden')};}});
  const w=dom.window;await settle();const fetch=w.fetch;w.fetch=async(u,o)=>{requests.push(JSON.parse(o.body));return fetch(u,o)};
  t.after(()=>{w.close();assert.deepEqual(errors,[])});return {w,requests};
}
const $=(w,id)=>w.document.getElementById(id);
function rows(w,name){return JSON.parse(w.localStorage.getItem('mock-gas-state')).books.find(b=>b.id==='mock-diag').sheets.find(s=>s.name===name).data}
async function parent(w){
  await w.api('parentSetPin',{setupCode:'MOCK2345',pin:'246810'});w.location.hash='parent';await settle();for(const k of '246810')w.document.querySelector('[data-pin-key="'+k+'"]').click();await settle();w.document.querySelector('[data-parent-tab="learn"]').click();await settle();
}
async function learn(w,agree=true){await parent(w);if(agree){$(w,'diag-agree').click();$(w,'diag-consent').click();await settle()}}
function bank(w,n=30){
  w.eval(`BANKS=[fixBank({id:'test-bank',title:'虛構題庫',grade:'三年級',subject:'自然',concepts:[{id:'c1',text:'虛構觀念'}],questions:Array.from({length:${n}},(_,i)=>({id:'q'+i,c:'c1',t:'mc',q:'虛構題目 '+i,o:['甲','乙'],a:'甲',src:'AI'}))})];localPut(BANKS[0])`);
}
const change=(w,el,value)=>{el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}))};
test('T032 exam saves three numbers and tags in seven columns, reloads report and stores Taipei midnight',async t=>{
  const {w,requests}=await open(t);await learn(w);$(w,'diag-exam-open').click();
  assert.equal(w.document.querySelectorAll('[data-qno]').length,40);assert.equal($(w,'exam-save').disabled,true);
  assert.equal($(w,'exam-date').value,w.eval('diagDate(Date.now())'));
  for(const n of [3,5,9])w.document.querySelector('[data-qno="'+n+'"]').click();
  for(const n of [3,5])w.document.querySelector('[data-exam-no="'+n+'"][data-exam-tag="neg"]').click();
  $(w,'exam-date').value='2026-11-01';$(w,'exam-save').click();await settle();
  const exams=rows(w,'exams');assert.equal(exams.length,2);assert.equal(exams[1].length,7);assert.equal(exams[1][5],'3,5,9');assert.equal(exams[1][6],'neg,neg,unk');
  assert.match($(w,'diag-parent-body').textContent,/已存下 3 題。/);assert.match($(w,'diag-parent-body').textContent,/否定題.*段考補登：錯 2 題。/s);
  const p=JSON.parse(rows(w,'profiles')[1][3]);assert.equal(p.lastExam.at,Date.parse('2026-11-01T00:00:00+08:00'));
  $(w,'diag-exam-open').click();assert.deepEqual([...$(w,'diag-exam').querySelectorAll('input')].map(x=>x.type),['date']);assert.equal($(w,'diag-exam').querySelectorAll('textarea,input[type="file"],input[type="number"]').length,0);
  assert.match($(w,'diag-exam').textContent,/只存題號、科目、標籤和日期。不用拍考卷，也不打題目內容、分數或學校。/);
  assert.ok(requests.some(r=>r.action==='diag_report'));
});
test('T032 tags use twenty minimal items without player data, preserve parent edits during AI response and persist with bsSave',async t=>{
  const {w,requests}=await open(t);bank(w);await learn(w,false);$(w,'diag-tags-open').click();assert.match($(w,'tag-body').textContent,/已標 0 \/ 30 題/);
  const fetch=w.fetch;let release,stale=false;
  w.fetch=async(u,o)=>{const r=JSON.parse(o.body);if(r.action!=='diag_tagBatch')return fetch(u,o);requests.push(r);if(stale)await new Promise(resolve=>release=resolve);return {json:async()=>({ok:true,tags:r.items.map(q=>({id:q.id,sk:['neg'],skc:.9}))})}};
  $(w,'tag-batch').click();await settle();assert.match($(w,'tag-body').textContent,/已標 20 \/ 30 題/);
  const request=requests.find(r=>r.action==='diag_tagBatch');assert.equal(request.items.length,20);for(const item of request.items)assert.deepEqual(Object.keys(item).sort(),['id','o','q']);assert.equal(request.grade,'三年級');assert.equal(request.subject,'自然');assert.doesNotMatch(JSON.stringify(request),/小葉子|小石頭|playerId/);
  let row=w.document.querySelector('[data-tag-row="0"]');change(w,row.querySelector('[aria-label="標籤"]'),'prf');await settle();assert.equal(w.eval('BANKS[0].questions[0].sksrc'),'parent');
  stale=true;$(w,'tag-batch').click();await settle();assert.equal(requests.filter(r=>r.action==='diag_tagBatch')[1].items.length,10);
  // Change a pending candidate while the AI response is in flight.
  row=w.document.querySelector('[data-tag-row="20"]');change(w,row.querySelector('[aria-label="標籤"]'),'prf');await settle();release();await settle();
  for(const i of [0,20])assert.deepEqual(plain(w.eval('BANKS[0].questions['+i+'].sk')),['prf']);
  assert.equal(w.eval('BANKS[0].questions[20].sksrc'),'parent');assert.equal(JSON.parse(w.localStorage.getItem('custom-banks'))['test-bank'].questions[20].sk[0],'prf');assert.ok(requests.some(r=>r.action==='saveBank'));
  row=w.document.querySelector('[data-tag-row="0"]');change(w,row.querySelector('[aria-label="第二標籤"]'),'neg');await settle();assert.deepEqual(plain(w.eval('BANKS[0].questions[0].sk')),['prf','neg']);assert.equal(w.eval('BANKS[0].questions[0].skc'),1);
});
test('T032 tags paginate fifty at a time, escape stems, and show backend failure message',async t=>{
  const {w}=await open(t);bank(w,101);w.eval("BANKS[0].questions[0].q='<img src=x onerror=bad()> ';BANKS[0].questions[1].sk=['neg'];BANKS[0].questions[1].sksrc='rule'");await learn(w,false);$(w,'diag-tags-open').click();assert.equal(w.document.querySelectorAll('.qli').length,50);assert.equal($(w,'tag-body').querySelector('img'),null);assert.match(w.document.querySelector('[data-tag-row="1"]').textContent,/規則標/);
  $(w,'tag-more').click();assert.equal(w.document.querySelectorAll('.qli').length,100);$(w,'tag-more').click();assert.equal(w.document.querySelectorAll('.qli').length,101);assert.equal($(w,'tag-more'),null);
  const fetch=w.fetch;w.fetch=async(u,o)=>JSON.parse(o.body).action==='diag_tagBatch'?{json:async()=>({ok:false,code:'quota',message:'虛構配額已用完'})}:fetch(u,o);$(w,'tag-batch').click();await settle();assert.equal($(w,'tag-status').textContent,'虛構配額已用完');
});
test('T032 AI prompt and merge retain legal tags, confidence and reading evidence fallback',async t=>{
  const {w}=await open(t);bank(w);assert.match(w.eval('genPrompt(BANKS[0],2,5)'),/sk 標出讀題能力標籤/);assert.match(w.eval('genPrompt(BANKS[0],2,5)'),/"sk":\["neg"\]/);
  w.eval(`mergeResult(BANKS[0],[{c:'c1',t:'tf',q:'新的虛構題',a:'O',sk:['neg']}],'AI')`);assert.deepEqual(plain(w.eval('BANKS[0].questions.at(-1).sk')),['neg']);assert.equal(w.eval('BANKS[0].questions.at(-1).sksrc'),'ai');assert.equal(w.eval('BANKS[0].questions.at(-1).skc'),.8);
  w.eval(`mergeResult(BANKS[0],[{c:'c1',t:'tf',q:'另一虛構題',a:'O',sk:['invalid']}],'AI')`);assert.equal(w.eval('BANKS[0].questions.at(-1).sk'),undefined);
  const reading=w.eval(`(()=>{const text='小樹在公園看見一朵花。'+ '他停下來仔細觀察花朵的顏色和葉子。'.repeat(30);return addReading(BANKS[0],{title:'虛構文章',text,questions:[{rl:1,t:'mc',q:'小樹看見什麼？',o:['花朵','石頭','蝴蝶','青蛙'],a:'花朵',ev:'小樹在公園看見一朵花。'}]},'story')})()`);assert.equal(reading.added,1);assert.deepEqual(plain(w.eval('BANKS[0].questions.at(-1).sk')),['evi']);assert.equal(w.eval('BANKS[0].questions.at(-1).sksrc'),'rule');assert.equal(w.eval('BANKS[0].questions.at(-1).skc'),1);
  assert.doesNotMatch(w.eval('genPrompt(BANKS[0],2,5)+readPrompt(BANKS[0],"story","虛構",3)'),/小葉子|小石頭|TEST-0000|playerId/);
});
test('T032 privacy details shares verbatim consent text',async t=>{
  const {w}=await open(t);const privacy=$(w,'diag-privacy').querySelector('p').textContent;assert.equal($(w,'diag-privacy').querySelector('summary').textContent,'隱私說明');await learn(w,false);assert.equal(w.document.querySelector('.consent').textContent,privacy);
});
test('T032 inline nickname deletion clears only selected player in all four tables and local caches',async t=>{
  const {w}=await open(t);await learn(w);const {session}=await w.api('parentLogin',{pin:'246810'});
  for(const playerId of ['p1','p2']){
    await w.api('diag_consent',{session,playerId,agree:true});await w.api('diag_saveExam',{session,playerId,subject:'自然',examDate:'2026-11-01',qnos:[1],tags:['neg']});await w.api('diag_saveDiag',{playerId,sid:'s-'+playerId,form:'v1',n:1,ok:0,perTag:{neg:{n:1,ok:0}}});
    await w.api('diag_postEvents',{playerId,events:[{ts:Date.now(),eid:'event-'+playerId,qid:'q1',bank:'',tags:'neg',ok:0,sec:1,len:20,chg:'0',scf:0,scok:'',mode:'prac',sid:'s1',retry:0,intr:0}]});
    for(const key of ['profile','run','ratio'])w.localStorage.setItem('diag-'+key+':'+playerId,'{}');
  }
  w.eval("evQueue=[{playerId:'p1',eid:'queued1'},{playerId:'p2',eid:'queued2'}];diagWrite('diag-evq',evQueue)");
  $(w,'diag-data-open').click();await settle();assert.match($(w,'diag-data').textContent,/會在.*自動刪除/);assert.match($(w,'diag-data').textContent,/老朋友複習：1 題排隊中/);
  $(w,'diag-delete-open').click();const input=$(w,'diag-delete-name'),go=$(w,'diag-delete-go');input.value='錯名';input.dispatchEvent(new w.Event('input'));assert.equal(go.disabled,true);
  $(w,'diag-delete-cancel').click();assert.equal($(w,'diag-delete-form').hidden,true);$(w,'diag-delete-open').click();input.value='小葉子';input.dispatchEvent(new w.Event('input'));assert.equal(go.disabled,false);
  const fk=rows(w,'profiles').slice(1).map(r=>r[0]);go.click();await settle();assert.match($(w,'diag-parent-body').textContent,/已刪除。/);
  for(const name of ['events','profiles','exams','diags']){const data=rows(w,name),col=name==='profiles'?0:2;assert.ok(data.slice(1).every(r=>r[col]!==fk.find(x=>x.endsWith(':p1'))));assert.ok(data.slice(1).some(r=>r[col]===fk.find(x=>x.endsWith(':p2'))))}
  for(const key of ['profile','run','ratio']){assert.equal(w.localStorage.getItem('diag-'+key+':p1'),null);assert.notEqual(w.localStorage.getItem('diag-'+key+':p2'),null)}assert.deepEqual(JSON.parse(w.localStorage.getItem('diag-evq')),[{playerId:'p2',eid:'queued2'}]);
});
test('T032 createGasEnv firstTs includes events older than report window and exam date uses Taipei midnight',()=>{
  const e=createGasEnv();e.run('setup');e.run('playerSave','TEST-0000',{playerId:'p1',name:'虛構樹',icon:'🌱'});e.props.setProperty('DIAG_SHEET_ID','parent-test');e.run('setupDiag');
  const setup=e.run('adminParent',{action:'adminIssueSetupCode',family:'TEST-0000'}),session=e.doPost({action:'parentSetPin',code:'TEST-0000',setupCode:setup.setupCode,pin:'907314'}).session;
  const post=(action,extra={})=>e.doPost({action,code:'TEST-0000',session,playerId:'p1',...extra});assert.equal(post('diag_report').firstTs,null);post('diag_consent',{agree:true});
  const ts=e.clock.now()-40*86400000;e.books.get('parent-test').book.getSheetByName('events').appendRow([ts,'old-event',e.run('diagFk',{code:'TEST-0000'},'p1'),'','q1','neg',0,1,'0',0,'prac','s1',0,0,20,'']);
  assert.equal(post('diag_report').firstTs,ts);assert.equal(post('diag_report').total.n,0);assert.equal(post('diag_saveExam',{subject:'數學',examDate:'2026-11-01',qnos:[3,5,9],tags:['neg','neg','unk']}).ok,true);assert.equal(post('diag_getProfile').profile.lastExam.at,Date.parse('2026-11-01T00:00:00+08:00'));
});
test('T032 player details render helper level, earliest retention date and remain available after consent withdrawal',async t=>{
  const {w}=await open(t);await learn(w);const fetch=w.fetch,at=Date.parse('2026-10-01T00:00:00+08:00');
  w.fetch=async(u,o)=>JSON.parse(o.body).action==='diag_getProfile'?{json:async()=>({ok:true,profile:{consent:{at},tags:{neg:{w:1,scf:2}},review:[]}})}:fetch(u,o);
  $(w,'diag-data-open').click();await settle();assert.match($(w,'diag-data').textContent,/讀題小幫手開著的題型：否定題（第 2 階）/);assert.match($(w,'diag-data').textContent,/老朋友複習：目前沒有。/);assert.match($(w,'diag-data').textContent,/資料最早一筆 2026-10-01，會在 2027-10-01 自動刪除。/);
  w.fetch=fetch;$(w,'diag-revoke').click();await settle();assert.equal($(w,'diag-exam-open'),null);assert.ok($(w,'diag-data-open'));$(w,'diag-data-open').click();await settle();assert.match($(w,'diag-data').textContent,/目前沒有開著的讀題小幫手。/);$(w,'diag-delete-open').click();const input=$(w,'diag-delete-name');input.value='小葉子';input.dispatchEvent(new w.Event('input'));$(w,'diag-delete-go').click();await settle();assert.match($(w,'diag-parent-body').textContent,/已刪除。/);
});
