'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const {build}=require('../tools/build'),{createGasEnv}=require('./fake-gas');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fq-report-'));build({outDir:dir});
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))};
async function open(t){
  const env=createGasEnv();env.run('setup');env.doPost({code:'TEST-0000',action:'playerList'});
  const issued=env.run('adminParent',{action:'adminIssueSetupCode',family:'TEST-0000'});
  const session=env.doPost({code:'TEST-0000',action:'parentSetPin',setupCode:issued.setupCode,pin:'1234'}).session;
  env.props.setProperty('DIAG_SHEET_ID','fake-sheet');env.run('setupDiag');
  const post=(action,data={})=>env.doPost({code:'TEST-0000',session,playerId:'p1',action,...data});post('diag_consent',{agree:true});
  const fk='TEST-0000:p1',items=[],answers={};
  for(const subject of ['math','zh']){
    const weak=[{key:'code:N-1-1',label:'加法',examQs:['1','2'],scf:1},{key:'code:N-1-2',label:'減法',examQs:['3','4'],scf:0}];
    env.run('diagPut','exams',{examId:subject,fk,subject,grade:1,term:1,examDate:'2026-11-01',createdAt:Date.parse('2026-11-02T00:00:00Z'),status:'saved'});
    env.run('diagPut','profiles',{fk,subject,json:JSON.stringify({weak}),updatedAt:Date.now()});
    for(let n=1;n<=4;n++)env.run('diagPut','examItems',{examId:subject,qNo:String(n),code:n<=2?'N-1-1':'N-1-2',verdict:'ng',cause:'read'});
    env.run('diagPut','events',{eid:'seed-'+subject,fk,subject});
  }
  for(let w=0;w<2;w++)for(const [i,variant] of ['A','B','A','B','R'].entries()){
    const id=w+'-'+i;items.push({id,weakKey:'code:N-1-'+(w+1),pairId:w+'-'+Math.floor(i/2),variant,q:'虛構題目',o:['甲','乙'],a:'甲'});
    answers[id]=w===0?variant!=='A':[false,true,true,true,false][i];
  }
  const results={};for(const key of ['code:N-1-1','code:N-1-2'])results[key]=env.run('judgeWeak',items.filter(x=>x.weakKey===key),answers);
  env.run('diagPut','checks',{checkId:'math-check',examId:'math',fk,subject:'math',items:JSON.stringify(items),doneAt:Date.parse('2026-11-07T00:00:00Z'),createdAt:Date.parse('2026-11-03'),resultJSON:JSON.stringify(results)});
  const errors=[],warnings=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e)});vc.on('warn',x=>warnings.push(x));
  const dom=new JSDOM(html,{url:'https://quiz.invalid/#parent',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.speechSynthesis={cancel(){},getVoices(){return []},speak(){},addEventListener(){}};w.confirm=()=>{throw Error('confirm forbidden')}}});
  const w=dom.window;t.after(()=>{w.close();assert.deepEqual(errors,[])});await settle();
  w.fetch=async(url,options)=>{assert.equal(String(url),'mock://gas');return {json:async()=>post(JSON.parse(options.body).action,JSON.parse(options.body))}};
  w.parentSession=session;w.eval('PARENT_SESSION=parentSession');w.document.querySelectorAll('script').forEach(s=>s.remove());await w.parentMain('exam');
  return {env,w,post,results,warnings,q:s=>w.document.querySelector(s),all:s=>[...w.document.querySelectorAll(s)]};
}
test('T038 I: pair conclusions, hand-counted scores, dates and correction notice',async t=>{
  const a=await open(t);assert.equal(a.q('#ex-history').textContent,'孩子紀錄');await a.w.viewCompare('math-check');
  assert.deepEqual(a.all('.cmp tbody .pill').map(x=>x.textContent),['還不穩','還看不出來']);
  const rows=a.all('.cmp tbody tr').map(r=>[...r.querySelectorAll('td')].map(x=>x.textContent));
  assert.deepEqual(rows[0].slice(0,4),['2 題','0/2','2/2','1/1']);assert.deepEqual(rows[1].slice(0,4),['2 題','1/2','2/2','0/1']);
  assert.equal(rows[0].at(-1),'建議開讀題小幫手，練習把題目看完整。');assert.equal(rows[1].at(-1),'題目還太少或結果不一致，下次段考再看看。');
  assert.match(a.q('.ex-review').textContent,/考卷是 2026-11-01 考的，挑戰是 2026-11-07 做的，隔了 6 天。/);
  assert.match(a.q('.ex-review').textContent,/不知道這份考卷有沒有訂正過；如果訂正過，「已經會了」可能是訂正後學會的。/);assert.match(a.q('.ex-review').textContent,/AI 判讀，請家長確認/);assert.deepEqual(a.warnings,[]);
  a.results['code:N-1-1'].status='ok';const c=a.env.run('diagObjects','checks')[0];c.resultJSON=JSON.stringify(a.results);a.env.run('diagPut','checks',c,c._row);
  await a.w.viewCompare('math-check');assert.equal(a.q('.cmp .pill').textContent,'已經會了');assert.equal(a.warnings.length,1);
});
test('T038 J/L: subject tabs, retention, inline deletion and isolated backend/local cleanup',async t=>{
  const a=await open(t);await a.q('#ex-history').onclick();
  assert.equal(a.all('[role=tab]').length,5);assert.match(a.q('#ex-subject-body').textContent,/考卷 1 份，最近一份 2026-11-01/);
  a.q('[data-subject=math]').click();assert.match(a.q('#ex-subject-body').textContent,/會在 2027-11-02 自動刪除。/);assert.match(a.q('#ex-subject-body').textContent,/讀題小幫手：開著/);assert.match(a.q('#ex-subject-body').textContent,/讀題小幫手：沒有開/);
  assert.equal(a.all('[data-compare]').length,1);await a.q('[data-compare]').onclick();assert.ok(a.q('.cmp'));await a.q('#ex-profile-back').onclick();
  const name=a.post('playerList').players.find(x=>x.id==='p1').name;
  a.w.eval("evQueue=[{playerId:'p1',subject:'math'},{playerId:'p1',subject:'zh'},{playerId:'p2',subject:'math'}];diagWrite('diag-evq',evQueue)");
  a.w.localStorage.setItem('diag-check:p1:math-check','{}');a.w.localStorage.setItem('diag-check:p2:other','{}');
  a.q('#ex-delete').click();assert.equal(a.q('#ex-delete-confirm').hidden,false);const input=a.q('#ex-delete-name');input.value='錯的暱稱';input.dispatchEvent(new a.w.Event('input'));assert.equal(a.q('#ex-delete-go').disabled,true);
  input.value=name;input.dispatchEvent(new a.w.Event('input'));assert.equal(a.q('#ex-delete-go').disabled,false);await a.q('#ex-delete-go').onclick();
  assert.match(a.q('#ex-subject-body').textContent,/已刪除。/);assert.match(a.q('#ex-subject-body').textContent,/這一科還沒有考卷分析。可以從「上傳考卷」開始。/);
  for(const table of ['exams','checks','profiles','events'])assert.equal(a.env.run('diagObjects',table).filter(x=>x.fk==='TEST-0000:p1'&&x.subject==='math').length,0);
  assert.equal(a.env.run('diagObjects','examItems').filter(x=>x.examId==='math').length,0);assert.equal(a.env.run('diagObjects','examItems').filter(x=>x.examId==='zh').length,4);
  assert.deepEqual(JSON.parse(a.w.localStorage.getItem('diag-evq')),[{playerId:'p1',subject:'zh'},{playerId:'p2',subject:'math'}]);assert.equal(a.w.localStorage.getItem('diag-check:p1:math-check'),null);assert.equal(a.w.localStorage.getItem('diag-check:p2:other'),'{}');
  a.q('[data-subject=zh]').click();assert.match(a.q('#ex-subject-body').textContent,/考卷 1 份/);a.q('[data-subject=sci]').click();assert.match(a.q('#ex-subject-body').textContent,/這一科還沒有考卷分析。/);
  assert.match(a.q('.ex-review').textContent,/出處：十二年國民基本教育課程綱要（國家教育研究院），本站為個人非營利使用，不代表該院立場。/);
});
test('T038 documentation, curriculum build copies and unchanged shared functions',()=>{
  const readme=fs.readFileSync(path.join(__dirname,'../README.md'),'utf8');for(const x of ['DIAG_SHEET_ID','setupDiag','diag_retentionDaily','不代表該院立場'])assert.ok(readme.includes(x));assert.doesNotMatch(readme,/[A-Za-z0-9_-]{40,}/);
  for(const name of ['math.json','en.json'])assert.deepEqual(fs.readFileSync(path.join(dir,'data/curriculum',name)),fs.readFileSync(path.join(__dirname,'../data/curriculum',name)));
  const shared=s=>s.split('// ==DIAG-SHARED-BEGIN==')[1].split('// ==DIAG-SHARED-END==')[0].replace(/\r\n/g,'\n');assert.equal(shared(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8')),shared(fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8')));
});
