'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const {build}=require('../tools/build'),{createGasEnv}=require('./fake-gas');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fq-ui-fix-'));build({outDir:dir});
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))};
async function open(t){
  const env=createGasEnv();env.run('setup');env.doPost({code:'TEST-0000',action:'playerList'});
  const issued=env.run('adminParent',{action:'adminIssueSetupCode',family:'TEST-0000'});
  const session=env.doPost({code:'TEST-0000',action:'parentSetPin',setupCode:issued.setupCode,pin:'1234'}).session;
  env.props.setProperty('DIAG_SHEET_ID','fake-sheet');env.run('setupDiag');
  const post=(action,data={})=>env.doPost({code:'TEST-0000',session,playerId:'p1',action,...data});post('diag_consent',{agree:true});
  const exam={examId:'ui-exam',fk:'TEST-0000:p1',subject:'math',grade:1,term:1,examDate:'2026-11-01',createdAt:Date.parse('2026-11-02'),status:'saved'};
  const weak=[{key:'code:N-1-1',code:'N-1-1',label:'N-1-1',examQs:['1','2'],cause:'read'}];
  env.run('diagPut','exams',exam);env.run('diagPut','profiles',{fk:exam.fk,subject:'math',json:JSON.stringify({weak}),updatedAt:Date.now()});
  for(let n=1;n<=2;n++)env.run('diagPut','examItems',{examId:exam.examId,qNo:String(n),code:'N-1-1',verdict:'ng',cause:'read'});
  const items=require('./fixtures/diag-check.json').filter(x=>x.weakKey==='code:N-1-1'),answers=Object.fromEntries(items.map(x=>[x.id,true]));
  const check={checkId:'ui-check',examId:exam.examId,fk:exam.fk,subject:'math',items:JSON.stringify(items),doneAt:Date.parse('2026-11-07'),createdAt:Date.parse('2026-11-03'),resultJSON:JSON.stringify({'code:N-1-1':env.run('judgeWeak',items,answers)})};
  env.run('diagPut','checks',check);
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e)});
  const dom=new JSDOM(html,{url:'https://quiz.invalid/#parent',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
    w.speechSynthesis={cancel(){},getVoices(){return []},speak(){},addEventListener(){}};
  }});
  const w=dom.window;t.after(()=>{w.close();assert.deepEqual(errors,[])});await settle();
  const reads=[];let fail=false;
  w.fetch=async(url,options={})=>{
    if(String(url).startsWith('data/curriculum/')){reads.push(String(url));if(fail)throw Error('課綱讀取失敗');return {json:async()=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',String(url)),'utf8'))}}
    assert.equal(String(url),'mock://gas');const req=JSON.parse(options.body);return {json:async()=>post(req.action,req)};
  };
  w.parentSession=session;w.eval('PARENT_SESSION=parentSession');w.document.querySelectorAll('script').forEach(s=>s.remove());await w.parentMain('exam');
  return {w,exam,weak,items,reads,fail:()=>fail=true,q:s=>w.document.querySelector(s)};
}

test('T043 CSS: sticky parent bars, hidden floating buttons, bottom clearance and child typography',()=>{
  const css=[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x=>x[1]).join('\n');
  const rule=selector=>{const found=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(x=>x[1].trim().split(',').includes(selector));assert.ok(found.length,selector);return found.map(x=>x[2]).join(';')};
  for(const text of ['position:sticky','top:64px','z-index:3','background:var(--parent)'])assert.ok(rule('.parent-tabs').includes(text));
  for(const text of ['height:64px','box-sizing:border-box','white-space:nowrap','margin-bottom:0'])assert.ok(rule('.parent-bar').includes(text));
  assert.match(rule('#parent-content'),/padding-top:0/);
  for(const selector of ['body:has(#parent-page) .style-btn','body:has(#parent-page) .tour-help'])assert.match(rule(selector),/display:none!important/);
  assert.match(rule('main#app'),/padding-bottom:calc\(118px \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(rule('.reward-page'),/padding-bottom:calc\(118px \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(rule('main#app:has(.reward-page)'),/padding-bottom:0/);
  assert.match(rule('.parent-page'),/padding-bottom:24px/);
  for(const selector of ['#diag-view .q','#diag-view .passage'])assert.match(rule(selector),/font-size:max\(22px,1.25em\)/);
  for(const text of ['display:flex','width:100%','box-sizing:border-box','min-height:56px','margin:8px 0','font-size:max(20px,1.15em)'])assert.ok(rule('#diag-view .opt').includes(text));
  assert.match(rule('#diag-view h1'),/font-size:clamp\(1.3rem,6vw,1.8rem\);white-space:nowrap/);
  assert.match(rule('#diag-view .toprow'),/flex-wrap:nowrap;gap:8px/);assert.match(rule('#diag-view .toprow button'),/flex:0 0 auto/);
});

test('T043 exWeakName: code, label code, unknown, tag, non-array and failed curriculum fallbacks',async t=>{
  const a=await open(t),rows=require('../data/curriculum/math.json');
  assert.equal(a.w.exWeakName({code:'N-1-1',label:'N-1-1'},rows),'一百以內的數（N-1-1）');
  assert.equal(a.w.exWeakName({label:'N-1-2'},rows),'加法和減法（N-1-2）');
  assert.equal(a.w.exWeakName({code:'unknown',label:'原標籤'},rows),'原標籤');
  assert.equal(a.w.exWeakName({code:'unknown',label:''},rows),'unknown');
  assert.equal(a.w.exWeakName({label:'讀題標籤'},rows),'讀題標籤');
  assert.equal(a.w.exWeakName({code:'N-1-1',label:'原標籤'},require('../data/curriculum/en.json')),'原標籤');
  a.fail();assert.equal(a.w.exWeakName({code:'N-1-1',label:'原標籤'},await a.w.exCurriculum('math')),'原標籤');
});

test('T043 F J I G: readable weak headings and one curriculum read per subject per screen',async t=>{
  const a=await open(t),ctx={exam:a.exam,pid:'p1',name:'小狐狸',weak:a.weak,counts:{read:2}};
  const check=async(render,selector)=>{a.reads.length=0;await render();assert.equal(a.q(selector)?.textContent,'一百以內的數（N-1-1）');assert.ok(![...a.w.document.querySelectorAll('h3')].some(x=>x.textContent==='N-1-1'));assert.deepEqual(a.reads,['data/curriculum/math.json'])};
  await check(()=>a.w.viewSubjectResult(ctx),'.weak h3');
  await check(()=>a.w.viewSubjectProfile('p1','math'),'#ex-subject-body article h3');
  a.q('[data-subject=zh]').click();a.q('[data-subject=math]').click();assert.equal(a.reads.length,1);
  await check(()=>a.w.viewCompare('ui-check'),'.cmp tbody th');
  await check(()=>a.w.viewCheckPreview('ui-check'),'[data-weak-group] h3');
});

test('T043 parent screens: failed curriculum keeps F J I G available with original labels',async t=>{
  const a=await open(t);a.fail();
  await a.w.viewSubjectResult({exam:a.exam,pid:'p1',name:'小狐狸',weak:a.weak,counts:{read:2}});assert.equal(a.q('.weak h3').textContent,'N-1-1');
  await a.w.viewSubjectProfile('p1','math');assert.equal(a.q('#ex-subject-body article h3').textContent,'N-1-1');
  await a.w.viewCompare('ui-check');assert.equal(a.q('.cmp tbody th').textContent,'N-1-1');
  await a.w.viewCheckPreview('ui-check');assert.equal(a.q('[data-weak-group] h3').textContent,'N-1-1');assert.ok(a.q('#ex-now'));
});

test('T043 child challenge: no curriculum code or parent diagnostic terms in DOM text',async t=>{
  const a=await open(t);a.w.viewCheck({checkId:'child-ui',subject:'math',items:a.items},'p1');
  assert.ok(a.q('#diag-view .q'));assert.ok(a.q('#diag-view .opt'));
  assert.doesNotMatch(a.q('#diag-view').textContent,/N-1-1|弱點|粗心|檢定/);
});
