'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const {build}=require('../tools/build');
const {createGasEnv}=require('./fake-gas');
const checkFixture=require('./fixtures/diag-check.json');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fq-review-'));
build({outDir:dir});
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const plain=x=>JSON.parse(JSON.stringify(x));
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))};
const response=x=>({code:200,body:{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(x)}]}});
async function open(t,{left=10,subject='math',noWeak=false,secondChild=false}={}){
  const env=createGasEnv({ai(request){
    const prompt=JSON.parse(request.payload).messages[0].content.filter(x=>x.type==='text').map(x=>x.text).join('');
    if(prompt.startsWith('DIAG_VERIFY'))return response(JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1)).map(x=>({i:x.i,answer:'5',code:'N-1-1'})));
    return response(plain(checkFixture));
  }});
  env.run('setup');env.doPost({code:'TEST-0000',action:'playerList'});
  const issued=env.run('adminParent',{action:'adminIssueSetupCode',family:'TEST-0000'});
  const session=env.doPost({code:'TEST-0000',action:'parentSetPin',setupCode:issued.setupCode,pin:'1234'}).session;
  env.props.setProperty('DIAG_SHEET_ID','fake-sheet');env.run('setupDiag');
  let pid='p1';
  const post=(action,data={})=>env.doPost({code:'TEST-0000',session,playerId:pid,action,...data});
  if(secondChild)pid=post('playerSave',{playerId:undefined,name:'測試弟弟',icon:'🦊'}).player.id;
  post('diag_consent',{agree:true});
  env.props.setProperty(env.run('countKey',env.run('findFamily','TEST-0000')),String(10-left));
  env.run('diagPut','exams',{examId:'exam-review',fk:'TEST-0000:'+pid,subject,grade:1,term:1,examDate:'2026-11-01',pages:1,aiCalls:1,status:'review',createdAt:env.clock.now()});
  for(let n=1;n<=6;n++)env.run('diagPut','examItems',{
    examId:'exam-review',qNo:String(n),type:n<=2?'addition':n<=4?'subtraction':'other'+n,
    text:n===1?'<img src=x onerror="bad()"> 2 + 3 = ?':'虛構題目 '+n,
    studentAnswer:n===2?null:'4',teacherMark:n===1?'ng':'none',correctAnswer:'5',
    verdict:noWeak?'ok':n===1||n>=5?'ok':'ng',verdictSource:'ai',cause:'concept',
    code:n<=2?'N-1-1':n<=4?'N-1-2':'',confidence:n===2?'lo':'hi',needsReview:n===3,parentEdited:false
  });
  let rejectSave=false,pending=false,holdMake=null,failCurriculum=false;
  const requests=[],errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e)});
  const dom=new JSDOM(html,{url:'https://quiz.invalid/#parent',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
    w.speechSynthesis={cancel(){},getVoices(){return []},speak(){},addEventListener(){}};
  }});
  const w=dom.window;t.after(()=>{w.close();assert.deepEqual(errors,[])});await settle();
  w.fetch=async(url,options={})=>{
    if(String(url).startsWith('data/curriculum/')){
      if(failCurriculum)throw Error('課綱讀取失敗');
      const data=JSON.parse(fs.readFileSync(path.join(__dirname,'..',String(url)),'utf8'));return {json:async()=>data};
    }
    assert.equal(String(url),'mock://gas');const req=JSON.parse(options.body);requests.push(req);
    if(req.action==='diag_confirmExam'&&rejectSave)return {json:async()=>({ok:false,message:'測試：暫時不能儲存'})};
    if(req.action==='diag_makeCheck'&&holdMake)await holdMake;
    const result=post(req.action,req);
    if(req.action==='diag_makeCheck'&&pending&&result.ok)result.pending=[{item:{id:'pending-one',q:'虛構未通過題',o:['甲','乙'],a:'甲',variant:'A',weakKey:'code:N-1-1',targetCode:'N-2-1'},reason:'驗算未通過'}];
    return {json:async()=>result};
  };
  w.parentSession=session;w.eval('PARENT_SESSION=parentSession');w.document.querySelectorAll('script').forEach(s=>s.remove());
  await w.parentMain('exam');await w.viewExamReview('exam-review');
  const q=sel=>w.document.querySelector(sel),all=sel=>[...w.document.querySelectorAll(sel)];
  const changeFirst=()=>{q('[data-q-no="1"] [data-verdict="ng"]').click();const select=q('[data-q-no="1"] select');select.value='read';select.dispatchEvent(new w.Event('change'))};
  const save=async()=>{await q('#ex-save').onclick();await settle()};
  return {w,env,post,pid,q,all,requests,changeFirst,save,reject:()=>rejectSave=true,pending:()=>pending=true,failCurriculum:()=>failCurriculum=true,hold:()=>{let release;holdMake=new Promise(r=>release=r);return release}};
}

test('T037 E: priority order, collapsed other questions, escaped text, confidence and concept prompt',async t=>{
  const a=await open(t);
  assert.deepEqual(a.all('.qli.flag').map(x=>x.dataset.qNo),['3','2','1']);
  assert.equal(a.q('details').open,false);assert.equal(a.q('summary').textContent,'其他 3 題（看起來沒問題）');
  assert.equal(a.all('details .qli').length,3);assert.equal(a.q('.ex-review img'),null);
  assert.match(a.q('[data-q-no="1"] p').textContent,/<img/);
  assert.equal(a.q('[data-q-no="2"] input').value,'');assert.equal(a.q('[data-q-no="2"] input').placeholder,'看不清楚，請照考卷填');
  assert.equal(a.q('[data-q-no="2"] .conf').textContent,'看不清楚');
  assert.equal(a.q('[data-q-no="3"] [data-concept]').textContent,'把題目念給我聽，你是怎麼算的？');
  assert.equal(a.q('[data-q-no="3"] [data-concept]').hidden,false);
  assert.equal(a.q('[data-q-no="1"] [data-cause-label]').hidden,true);
  a.q('[data-q-no="3"] [data-verdict="ok"]').click();assert.equal(a.q('[data-q-no="3"] [data-concept]').hidden,true);
  assert.equal(a.requests.filter(r=>r.action==='diag_confirmExam').length,0);
});

test('T037 E/F: only explicit save writes parent verdict, all draft fields, profile and matching cause totals',async t=>{
  const a=await open(t);a.changeFirst();
  const input=a.q('[data-q-no="2"] input');input.value='5';input.dispatchEvent(new a.w.Event('input'));
  assert.equal(a.post('diag_examItems',{examId:'exam-review'}).exam.status,'review');
  assert.equal(a.post('diag_examItems',{examId:'exam-review'}).items[0].verdict,'ok');
  a.w.eval("exJob={examId:'exam-review',pages:[{b64:'private-photo'}]}");
  const job=a.w.eval('exJob');await a.save();
  const saved=a.post('diag_examItems',{examId:'exam-review'});
  assert.equal(saved.exam.status,'saved');assert.equal(saved.items[0].verdictSource,'parent');assert.equal(saved.items[0].cause,'read');assert.equal(saved.items[1].studentAnswer,'5');
  assert.equal(a.w.eval('exJob'),null);assert.equal(job.pages[0].b64,undefined);
  const sent=a.requests.find(r=>r.action==='diag_confirmExam');assert.equal(sent.items.length,6);
  assert.deepEqual(sent.items[0].editedFields,['verdict','cause']);assert.equal(sent.items[4].parentEdited,false);
  assert.equal(a.all('[data-count]').length,4);const total=a.all('[data-count]').reduce((n,x)=>n+Number(x.dataset.count),0);
  assert.equal(total,4);assert.match(a.q('.ex-review h3').textContent,new RegExp('共錯 '+total+' 題'));
  const weak=a.post('diag_getProfile').profiles.math.weak;assert.equal(weak.length,2);assert.ok(weak.length<=3&&weak.every(w=>w.examQs.length>=2));assert.equal(a.all('.weak').length,weak.length);
  a.q('#ex-later').click();assert.match(a.q('[data-ex-status]').textContent,/已存進.+的數學紀錄。/);assert.equal(a.post('diag_getProfile').profiles.math.weak.length,2);
  assert.ok(!Object.values(a.w.localStorage).some(v=>v.includes('虛構題目')||v.includes('private-photo')));
});

test('T037 E: failed confirmation displays backend message and preserves editable draft',async t=>{
  const a=await open(t);a.reject();a.changeFirst();await a.save();
  assert.equal(a.q('[data-ex-status]').textContent,'測試：暫時不能儲存');assert.equal(a.q('#ex-save').disabled,false);
  assert.equal(a.q('[data-q-no="1"] [data-verdict="ng"]').getAttribute('aria-pressed'),'true');assert.equal(a.q('[data-q-no="1"] select').value,'read');
  assert.equal(a.q('[data-q-no="1"] input').disabled,false);assert.equal(a.post('diag_examItems',{examId:'exam-review'}).exam.status,'review');
});

test('T037 F: no weak points and exhausted quota states',async t=>{
  const empty=await open(t,{noWeak:true});await empty.save();assert.match(empty.q('.ex-review').textContent,/這份考卷沒有同一類錯 2 題以上的地方，先不用做挑戰。/);assert.equal(empty.q('#ex-make'),null);
  const a=await open(t,{left:0});a.changeFirst();await a.save();assert.equal(a.q('#ex-make').disabled,true);assert.equal(a.q('[data-ex-status]').textContent,'今天的次數用完了，明天再出題。');
});

test('T037 G: two weak points produce ten labeled questions, curriculum scope, pending and actions',async t=>{
  const a=await open(t);a.changeFirst();await a.save();a.pending();
  const release=a.hold();const preview=a.q('#ex-make').onclick();await settle();assert.equal(a.q('[data-ex-status]').textContent,'正在出題…');release();await preview;
  assert.equal(a.all('[data-weak-group]').length,2);assert.equal(a.all('[data-weak-group] [data-check-item]').length,10);
  assert.ok(a.all('[data-check-item]').every(x=>x.textContent.includes('AI 出的題')));
  assert.match(a.q('[data-weak-group]').textContent,/N-1-1 一百以內的數/);assert.match(a.q('[data-weak-group]').textContent,/有陷阱/);assert.match(a.q('[data-weak-group]').textContent,/沒陷阱/);assert.match(a.q('[data-weak-group]').textContent,/換問法/);
  assert.match(a.q('[data-pending]').textContent,/待確認/);assert.match(a.q('[data-pending]').textContent,/這幾題沒通過驗算，不會出給孩子。/);assert.equal(a.all('[data-pending] [data-check-item]').length,1);
  assert.match(a.q('.ex-review').textContent,/出處：十二年國民基本教育課程綱要（國家教育研究院），本站為個人非營利使用，不代表該院立場。/);
  const req=a.requests.find(r=>r.action==='diag_makeCheck');assert.ok(req.whitelist.length>0&&req.whitelist.every(x=>x.grade<=1&&Object.keys(x).length===2));assert.deepEqual(req.words,[]);
  const viewCheck=a.w.viewCheck;a.w.viewCheck=undefined;await a.q('#ex-now').onclick();assert.equal(a.q('[data-ex-status]').textContent,'下一步畫面準備中');a.w.viewCheck=viewCheck;
  a.q('#ex-home').click();assert.match(a.q('[data-ex-status]').textContent,/已放到.+的首頁。/);
  const child=a.post('diag_childState');assert.equal(child.checks.length,1);assert.equal(child.checks[0].items.length,10);
  const id=child.checks[0].checkId;await a.w.viewCheckPreview(id);assert.equal(a.all('[data-weak-group]').length,2);assert.equal(a.all('[data-check-item]').length,10);
  await a.w.viewCheckPreview(a.post('diag_makeCheck',{examId:'exam-review',whitelist:req.whitelist,words:[]}));assert.equal(a.all('[data-check-item]').length,10);
  await a.q('#ex-now').onclick();assert.ok(a.q('#diag-view'));assert.match(a.q('#diag-view').textContent,/數學挑戰/);assert.equal(a.w.eval('diagRun.pid'),'p1');assert.equal(a.w.eval('PARENT_SESSION'),null);
});

test('T037 G: English word whitelist, other subjects empty lists and curriculum failure makes no request',async t=>{
  for(const subject of ['en','zh']){
    const a=await open(t,{subject});a.changeFirst();await a.save();await a.q('#ex-make').onclick();
    const req=a.requests.find(r=>r.action==='diag_makeCheck');assert.deepEqual(req.whitelist,[]);
    const en=require('../data/curriculum/en.json');assert.deepEqual(req.words,subject==='en'?[...en.words300,...en.words1200]:[]);
  }
  const a=await open(t);a.changeFirst();await a.save();a.failCurriculum();await a.q('#ex-make').onclick();assert.equal(a.requests.some(r=>r.action==='diag_makeCheck'),false);assert.equal(a.q('[data-ex-status]').textContent,'課綱讀取失敗');assert.ok(a.q('#ex-preview-retry'));
});

test('T037 keyboard: every review button/input/select/summary focuses and segments expose pressed state',async t=>{
  const a=await open(t);a.q('details').open=true;
  for(const el of a.all('.ex-review button,.ex-review input,.ex-review select,.ex-review summary')){
    if(el.closest('[hidden]'))continue;
    assert.ok(el.tabIndex>=0);el.focus();assert.equal(a.w.document.activeElement,el);
  }
  for(const seg of a.all('.seg')){assert.equal(seg.querySelectorAll('[aria-pressed]').length,3);assert.equal(seg.querySelectorAll('[aria-pressed="true"]').length,1)}
  a.q('[data-q-no="1"] [data-verdict="half"]').click();assert.equal(a.q('[data-q-no="1"] [data-verdict="half"]').getAttribute('aria-pressed'),'true');
  assert.equal(a.q('[data-q-no="1"] [data-cause-label]').hidden,false);
});

test('T037 G: start challenge for the exam child and record answers under that child',async t=>{
  const a=await open(t,{secondChild:true});assert.notEqual(a.pid,'p1');a.changeFirst();await a.save();
  assert.match(a.q('#ex-make').textContent,/測試弟弟/);await a.q('#ex-make').onclick();await a.q('#ex-now').onclick();
  assert.equal(a.w.eval('diagRun.pid'),a.pid);assert.equal(a.w.eval('PARENT_SESSION'),null);
  a.q('[data-diag-opt="0"]').click();assert.equal(a.w.eval('evQueue[0].playerId'),a.pid);
  assert.doesNotMatch(a.q('#diag-view').textContent,/弱點|粗心|檢定/);
});
