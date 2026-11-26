'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const {createGasEnv}=require('./fake-gas');
const fixture=require('./fixtures/diag-page.json');
const html=fs.readFileSync('index.html','utf8').replace(/^const CONFIG=\{API_URL:'[^']*'\};\r?$/m,"const CONFIG={API_URL:'mock://gas'};");
const input={subject:'math',grade:1,term:1,examDate:'2026-11-01',codes:['N-1-1'],pages:[{n:1,b64:'QQ=='},{n:2,b64:'Qg=='}]};
function setup(failSecond=false){
  const env=createGasEnv({ai(request){
    const prompt=JSON.parse(request.payload).messages[0].content.filter(x=>x.type==='text').map(x=>x.text).join('');
    const n=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1)).page;
    if(failSecond&&n===2)return {code:500,body:{}};
    const page=JSON.parse(JSON.stringify(fixture));page.items=page.items.slice(0,n+1);
    page.items.forEach((x,i)=>x.q_no=String(n*10+i));
    return {code:200,body:{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(page)}]}};
  }});
  env.run('setup');env.doPost({code:'TEST-0000',action:'playerList'});
  const issued=env.run('adminParent',{action:'adminIssueSetupCode',family:'TEST-0000'});
  const session=env.doPost({code:'TEST-0000',action:'parentSetPin',setupCode:issued.setupCode,pin:'1234'}).session;
  assert.ok(session);env.props.setProperty('DIAG_SHEET_ID','fake-sheet');env.run('setupDiag');
  const post=(action,data={})=>env.doPost({code:'TEST-0000',session,playerId:'p1',action,...data});
  post('diag_consent',{agree:true});return {env,post,session};
}
async function open(t,s){
  const errors=[],requests=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(html,{url:'https://quiz.invalid/#parent',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    w.localStorage.setItem('family',JSON.stringify({code:'TEST-0000',name:'測試家庭'}));
    w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
    w.speechSynthesis={cancel(){},getVoices(){return []},speak(){},addEventListener(){}};
  }});
  const w=dom.window;t.after(()=>{w.close();assert.deepEqual(errors,[])});
  for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
  w.fetch=async(url,options)=>{assert.equal(String(url),'mock://gas');const req=JSON.parse(options.body);requests.push(req);return {json:async()=>s.env.doPost(req)}};
  w.testSession=s.session;w.eval('PARENT_SESSION=testSession');
  await w.parentMain('exam');requests.length=0;
  return {w,requests};
}
test('T039 analyze returns each successful page count, summing to merged items',()=>{
  const s=setup(),r=s.post('diag_analyzeExam',input);
  assert.equal(r.ok,true);assert.deepEqual(r.pages,[{page:1,count:2},{page:2,count:3}]);
  assert.equal(r.pages.reduce((n,p)=>n+p.count,0),r.items.length);
  assert.deepEqual(r.failed,[]);assert.equal(r.charged,2);
});
test('T039 pages excludes failed pages and preserves original page numbers',()=>{
  const s=setup(true),r=s.post('diag_analyzeExam',{...input,pages:[input.pages[1],input.pages[0]]});
  assert.deepEqual(r.pages,[{page:1,count:2}]);assert.deepEqual(r.failed,[{page:2,code:'ai_error'}]);
  assert.equal(r.items.length,2);assert.equal(r.charged,1);
});
test('T039 getProfile exposes the stored createdAt on each exam',()=>{
  const s=setup();s.post('diag_analyzeExam',input);s.post('diag_analyzeExam',{...input,subject:'zh'});
  const r=s.post('diag_getProfile');assert.equal(r.ok,true);assert.equal(r.exams.length,2);
  for(const e of r.exams){const stored=s.env.run('diagObjects','exams').find(x=>x.examId===e.examId);assert.equal(e.createdAt,stored.createdAt);assert.ok(e.createdAt>0)}
});
test('T039 D displays the returned count for both successful pages',async t=>{
  const s=setup(),{w}=await open(t,s);
  const root=w.document.getElementById('parent-list');root.innerHTML='<div id="ex-progress"></div>';
  w.testJob={meta:{playerId:'p1',...input},pages:input.pages.map(p=>({...p,state:'busy'})),examId:null,busy:true,left:null,total:0};
  w.eval('exJob=testJob;exRefresh=null');
  await w.exAnalyze(w.testJob,w.testJob.pages,root,()=>true,[]);
  const text=root.querySelector('#ex-progress').textContent;
  assert.match(text,/第 1 頁：完成，讀到 2 題/);assert.match(text,/第 2 頁：完成，讀到 3 題/);assert.match(text,/共讀到 5 題/);
});
test('T039 J uses profile createdAt for subject retention without examItems requests',async t=>{
  const s=setup();
  for(const [examId,subject,createdAt] of [['later','math','2026-11-04'],['earliest','math','2026-11-02'],['other','zh','2026-10-01']]){
    s.env.run('diagPut','exams',{examId,fk:'TEST-0000:p1',subject,grade:1,term:1,examDate:'2026-11-01',status:'saved',createdAt:Date.parse(createdAt+'T00:00:00Z')});
  }
  const {w,requests}=await open(t,s);await w.viewSubjectProfile('p1','math');
  assert.match(w.document.querySelector('#ex-subject-body').textContent,/會在 2027-11-02 自動刪除。/);
  w.document.querySelector('[data-subject=zh]').click();
  assert.match(w.document.querySelector('#ex-subject-body').textContent,/會在 2027-10-01 自動刪除。/);
  assert.deepEqual(requests.map(r=>r.action),['playerList','diag_getProfile']);
});
