'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom'),{build}=require('../tools/build');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fq-childkey-'));build({outDir:dir});
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const plain=x=>JSON.parse(JSON.stringify(x));
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r))};
const bank=()=>({id:'bk',subject:'數學',questions:Array.from({length:30},(_,i)=>({id:'b'+i,q:'選哪個不是水果？',o:['甲','乙'],a:'甲',sk:[i<15?'neg':'ctx']}))});
const state=()=>({ok:true,consent:true,subjects:{math:{weak:[{key:'wabc',tag:'neg',w:1}],review:[]}},checks:[{checkId:'check1',subject:'math',items:Array.from({length:10},(_,i)=>({id:'q'+i,q:'p1專屬題目 '+i,o:['甲','乙']}))}]});
async function open(t,pid='p1'){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e)});
  const dom=new JSDOM(html,{url:'https://quiz.invalid',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){w.localStorage.setItem('player',JSON.stringify(pid));w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.speechSynthesis={cancel(){},getVoices(){return []},speak(){},addEventListener(){}}}});
  const w=dom.window;t.after(()=>{w.close();assert.deepEqual(errors,[])});await settle();w.document.querySelectorAll('script').forEach(x=>x.remove());
  return w;
}
function stub(w){const requests=[],s=state();let reject=false;
  w.localStorage.setItem('diag-ckey:p1','FAKE-KEY-P1');
  w.fetch=async(url,opts)=>{const r=JSON.parse(opts.body);requests.push(r);let j;
    if(r.action==='diag_childState')j=r.playerId==='p1'&&!reject?s:{ok:false,code:'need_child_key'};
    else if(r.action==='diag_postEvents')j={ok:false,code:'need_child_key'};
    else throw Error('Unexpected '+r.action);
    return {json:async()=>j};};
  return {requests,s,reject:()=>{reject=true}};
}
function queue(w,pid='p1'){w.ev={playerId:pid,eid:'event-'+pid,qid:'q0',subject:'math',mode:'check',pick:0,first:0,moved:0};w.eval('evPush(ev)')}
function safeDOM(w){assert.doesNotMatch(w.document.getElementById('app').textContent,/弱點|粗心|檢定|[A-Z]-\d-\d/)}
test('T041 sibling isolation: childState and postEvents use each player key; missing key hides private cards',async t=>{
 const w=await open(t),{requests}=stub(w);w.location.hash='';await settle();await w.libHome();await settle();assert.match(w.document.getElementById('app').textContent,/數學挑戰/);queue(w);await w.flushEvents();
 const p2=await open(t,'p2'),b=stub(p2);await p2.libHome();await settle();queue(p2,'p2');await p2.flushEvents();requests.push(...b.requests);
 assert.equal(p2.document.querySelectorAll('#diag-need-key').length,1);assert.equal(p2.document.querySelectorAll('#diag-home article').length,1);assert.equal(p2.document.querySelector('#diag-need-key').outerHTML,'<article class="card" id="diag-need-key"><h2>挑戰</h2><p>請家長在這台裝置開啟練習</p></article>');assert.doesNotMatch(p2.document.getElementById('app').textContent,/p1專屬/);
 // Reloading with a different player mirrors switchPlayer (ACTIVE_PLAYER is fixed per page).

 for(const pid of ['p1','p2'])for(const action of ['diag_childState','diag_postEvents']){const rs=requests.filter(r=>r.action===action&&r.playerId===pid);assert.ok(rs.length);for(const r of rs)assert.equal(r.childKey,pid==='p1'?'FAKE-KEY-P1':'')}
 assert.doesNotMatch(w.localStorage.getItem('diag-evq'),/FAKE-KEY/);safeDOM(w);
});
test('T041 R2 keyless sibling queued first does not block the other player',async t=>{
 const w=await open(t),requests=[];
 w.localStorage.setItem('diag-ckey:p1','FAKE-KEY-P1');
 w.fetch=async(url,opts)=>{const r=JSON.parse(opts.body);requests.push(r);assert.equal(r.action,'diag_postEvents');return {json:async()=>r.playerId==='p2'?{ok:false,code:'need_child_key'}:{ok:true,accepted:r.events.map(e=>e.eid)}}};
 queue(w,'p2');queue(w,'p1');await w.flushEvents();
 assert.deepEqual(requests.map(r=>r.playerId),['p2','p1']);
 assert.deepEqual(requests.map(r=>r.childKey),['','FAKE-KEY-P1']);
 assert.deepEqual(plain(w.eval('evQueue')).map(e=>e.playerId),['p2']);
 assert.deepEqual(JSON.parse(w.localStorage.getItem('diag-evq')).map(e=>e.playerId),['p2']);
});
test('T041 rejected keys preserve queue and practice works without cached weights; no consent still forgets',async t=>{
 const w=await open(t),a=stub(w);await w.libHome();await settle();queue(w);a.reject();await w.flushEvents();assert.equal(w.eval('evQueue.length'),1);
 w.b=bank();await w.diagPractice(w.b);assert.ok(w.document.querySelector('#diag-view'));assert.equal(w.eval('diagRun.items.length'),12);assert.equal(w.eval('diagRun.items.every(x=>x.kind==="normal")'),true);assert.equal(w.eval('evQueue.length'),1);
 w.fetch=async()=>({json:async()=>({ok:false,code:'no_consent'})});await w.flushEvents();assert.equal(w.eval('evQueue.length'),0);safeDOM(w);
});
test('T041 check choices and amendments never call diagCorrect or persist grading fields',async t=>{
 const w=await open(t),{s}=stub(w);await w.libHome();await settle();w.eval('diagCorrect=()=>{throw Error("check tried grading")}');w.viewCheck(s.checks[0]);w.document.querySelector('[data-diag-opt="0"]').click();w.document.querySelector('#diag-prev').click();w.document.querySelector('[data-diag-opt="1"]').click();
 const [e]=plain(w.eval('evQueue'));assert.equal(e.pick,1);assert.equal(e.first,0);assert.equal(e.moved,1);assert.equal('ok' in e,false);assert.equal('chg' in e,false);assert.equal(w.eval('evQueue.length'),1);assert.doesNotMatch(w.document.getElementById('app').innerHTML,/答對|答錯|正確答案|class="right|class="wrong/);assert.doesNotMatch(w.localStorage.getItem('diag-evq'),/p1專屬|FAKE-KEY/);safeDOM(w);
});
async function login(w){w.location.hash='#parent';await settle();const auth=await w.api('parentSetPin',{setupCode:'MOCK2345',pin:'246810'});w.auth=auth;w.eval('PARENT_SESSION=auth.session');await w.parentPage();return (action,data={})=>w.api(action,{session:auth.session,playerId:'p1',...data})}
test('T041 parent devices: visible before consent, issue/revoke exact text and 44px controls',async t=>{
 const w=await open(t),parent=await login(w);await parent('playerDisable',{playerId:'p2'});await w.parentMain('exam');
 assert.ok(w.document.querySelector('#ex-consent'));assert.ok(w.document.querySelector('#ex-devices'));assert.equal(w.document.querySelector('[data-ex-key="p2"]'),null);
 await w.document.querySelector('[data-ex-key="p1"]').onclick();assert.ok(w.localStorage.getItem('diag-ckey:p1'));assert.match(w.document.querySelector('#ex-devices').textContent,/小葉子（這台裝置）/);assert.equal(w.document.querySelector('#ex-message').textContent,'這台裝置已開啟 小葉子 的練習。');assert.ok(!w.document.querySelector('#ex-panel').textContent.includes(w.localStorage.getItem('diag-ckey:p1')));
 queue(w);await w.document.querySelector('[data-ex-revoke="p1"]').onclick();assert.equal(w.localStorage.getItem('diag-ckey:p1'),null);assert.equal(w.eval('evQueue.length'),1);assert.equal(w.document.querySelector('#ex-message').textContent,'已停用 小葉子 的裝置，要再按「讓這台裝置給 小葉子 用」才能恢復。');assert.match(html,/\.parent-page button\{[^}]*min-width:44px;min-height:44px/);
});
test('T041 real built mock: parent issues key, child answers ten, backend completes and writes judgeWeak',async t=>{
 const w=await open(t),parent=await login(w);await parent('diag_consent',{agree:true});
 const exam=await parent('diag_analyzeExam',{subject:'math',grade:1,term:1,examDate:'2026-11-01',codes:['N-1-1','N-1-2'],pages:[{n:1,b64:'ZmFrZQ=='}]});await parent('diag_confirmExam',{examId:exam.examId,items:[]});
 const made=await parent('diag_makeCheck',{examId:exam.examId,whitelist:[{code:'N-1-1',grade:1},{code:'N-1-2',grade:1}],words:[]});
 await w.parentMain('exam');await w.document.querySelector('[data-ex-key="p1"]').onclick();w.location.hash='';await settle();await w.libHome();await settle();assert.match(w.document.getElementById('app').textContent,/數學挑戰/);
 const s=await w.diagChildState('p1'),check=s.checks[0];assert.equal(check.items.length,10);for(const q of check.items)assert.deepEqual(Object.keys(q).sort(),['id','o','q']);
 // Answers are visible as options, but no answer field or grading result reaches child code.
 w.viewCheck(check);for(let i=0;i<10;i++){safeDOM(w);assert.doesNotMatch(w.document.getElementById('app').innerHTML,/correctAnswer|"a":|正確答案/);w.document.querySelector('[data-diag-opt="1"]').click()}
 await w.flushEvents();assert.equal(w.eval('evQueue.length'),0);const auth=await w.api('parentLogin',{pin:'246810'});const done=(await w.api('diag_check',{session:auth.session,checkId:check.checkId})).check;assert.ok(done.doneAt);const results=(typeof done.resultJSON==='string'?JSON.parse(done.resultJSON):done.resultJSON);assert.equal(Object.keys(results).length,2);for(const r of Object.values(results))assert.ok(r.status);assert.equal((await w.diagChildState('p1')).checks.length,0);assert.equal(w.localStorage.getItem('diag-check:p1:'+check.checkId),null);
});
test('T041 opaque weak keys: neg weighting and local review preserve opaque IDs and 1/3/7 ladder',async t=>{
 const w=await open(t),{s}=stub(w);w.b=bank();w.s=s;for(let i=0;i<20;i++){const round=plain(w.eval('diagPracticeItems(b,s)'));const n=round.filter(x=>x.q.sk.includes('neg')).length;assert.ok(n>=5&&n<=6)}
 await w.libHome();await settle();w.s.subjects.math.review=[{key:'opaque-review',tag:'neg',qidSeen:[],step:0,dueAt:0}];w.eval('diagStates.set("p1",s)');await w.diagPractice(w.b);w.document.querySelector('[data-diag-opt="1"]').click();w.document.querySelector('#diag-next').click();w.document.querySelector('#diag-next').click();
 const review=plain(w.eval('diagStates.get("p1").subjects.math.review'));assert.ok(review.some(r=>r.key==='opaque-review'));assert.ok(review.every(r=>r.key==='opaque-review'||r.key==='local:'+r.tag));
});
test('T041 real childState strips a hidden answer sentinel from DOM and local storage',async t=>{
 const {createGasEnv}=require('./fake-gas'),env=createGasEnv(),code='TEST-0000';env.run('setup');env.doPost({code,action:'playerList'});
 const setup=env.run('adminParent',{action:'adminIssueSetupCode',family:code}),session=env.doPost({code,action:'parentSetPin',setupCode:setup.setupCode,pin:'1234'}).session;
 const post=(action,data={})=>env.doPost({code,session,playerId:'p1',action,...data});env.props.setProperty('DIAG_SHEET_ID','fake-sheet');env.run('setupDiag');post('diag_consent',{agree:true});
 const secret='HIDDEN_ANSWER_T041',childKey=post('diag_issueChildKey').childKey;
 env.run('diagPut','checks',{checkId:'secret-check',examId:'secret-exam',fk:code+':p1',subject:'math',grade:1,items:JSON.stringify([{id:'secretq',q:'選一個水果',o:['甲','乙'],a:secret,weakKey:'tag:neg'}]),createdAt:env.clock.now(),doneAt:'',resultJSON:''});
 const w=await open(t);w.localStorage.setItem('diag-ckey:p1',childKey);w.fetch=async(url,opts)=>({json:async()=>post(JSON.parse(opts.body).action,JSON.parse(opts.body))});
 const s=await w.diagChildState('p1');assert.doesNotMatch(JSON.stringify(s),new RegExp(secret));assert.deepEqual(Object.keys(s.checks[0].items[0]).sort(),['id','o','q']);w.viewCheck(s.checks[0]);w.document.querySelector('#diag-pause').click();await settle();w.viewCheck(s.checks[0]);assert.doesNotMatch(w.document.body.innerHTML,new RegExp(secret));for(const k of Object.keys(w.localStorage))assert.ok(!w.localStorage.getItem(k).includes(secret));
});
