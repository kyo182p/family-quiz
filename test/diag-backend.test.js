'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createGasEnv}=require('./fake-gas');
const page=require('./fixtures/diag-page.json');
const check=require('./fixtures/diag-check.json');
const code='TEST-0000',clone=x=>JSON.parse(JSON.stringify(x));
const response=x=>({code:200,body:{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(x)}]}});
function fixtureAI(request){
  const payload=JSON.parse(request.payload),prompt=payload.messages[0].content.filter(x=>x.type==='text').map(x=>x.text).join('');
  if(prompt.startsWith('DIAG_PAGE'))return response(clone(page));
  if(prompt.startsWith('DIAG_VERIFY')){const input=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));return response(input.map(x=>({i:x.i,answer:'5',code:'N-1-1'})));}
  return response(clone(check));
}
function setup(ai=fixtureAI){
  const env=createGasEnv({ai});env.run('setup');env.doPost({code,action:'playerList'});
  const issued=env.run('adminParent',{action:'adminIssueSetupCode',family:code});
  const session=env.doPost({code,action:'parentSetPin',setupCode:issued.setupCode,pin:'1234'}).session;assert.ok(session);
  env.props.setProperty('DIAG_SHEET_ID','fake-sheet');assert.equal(env.run('setupDiag').ok,true);
  const post=(action,extra={})=>env.doPost({code,session,action,playerId:'p1',...extra});
  return {env,post,session};
}
const input={subject:'math',grade:1,term:1,examDate:'2026-11-01',codes:['N-1-1','N-1-2'],pages:[{n:1,b64:'ZmFrZQ=='}]};
function analyzed(s,subject='math'){s.post('diag_consent',{agree:true});const r=s.post('diag_analyzeExam',{...clone(input),subject});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.charged,1);return r;}
function confirmed(s,subject='math'){const r=analyzed(s,subject);assert.equal(s.post('diag_confirmExam',{examId:r.examId,items:[]}).ok,true);return r;}
function made(s){const r=confirmed(s);const c=s.post('diag_makeCheck',{examId:r.examId,whitelist:[{code:'N-1-1',grade:1},{code:'N-1-2',grade:1}],words:[]});assert.equal(c.ok,true,JSON.stringify(c));return {...c,examId:r.examId};}
function objects(env,name){return clone(env.run('diagObjects',name));}
function event(env,q,c,i,changes={}){return {ts:env.clock.now(),eid:'event_'+i,qid:q.id,bank:'',tags:'neg',ok:q.variant==='A'?0:1,sec:10,len:20,chg:'0',scf:0,scok:'',mode:'check',sid:'round',retry:0,intr:0,subject:'math',checkId:c.checkId,...changes};}

test('T034 parent session required for every parent route; family consent v2 and player/subject validation',()=>{
  const s=setup();for(const action of ['diag_analyzeExam','diag_confirmExam','diag_deleteSubject','diag_makeCheck','diag_quota','diag_getProfile','diag_consent','diag_examItems','diag_check'])assert.equal(s.post(action,{session:undefined}).code,'no_session');
  assert.equal(s.post('diag_analyzeExam',input).code,'no_consent');
  s.post('diag_consent',{agree:true});const stored=objects(s.env,'profiles')[0];assert.equal(stored.fk,code+':*');assert.equal(stored.subject,'all');const c=JSON.parse(stored.json).consent;assert.equal(c.ver,2);assert.equal(typeof c.at,'number');
  assert.equal(s.post('diag_analyzeExam',{...input,playerId:'p9'}).code,'bad_player');assert.equal(s.post('diag_analyzeExam',{...input,subject:'other'}).code,'bad_request');
  for(const fields of [{codes:['bad']},{pages:[]},{examDate:'2026-02-30'},{grade:7},{pages:[{n:5,b64:'QQ=='}]}])assert.equal(s.post('diag_analyzeExam',{...input,...fields}).code,'bad_request');
  s.post('diag_consent',{agree:false});assert.equal(s.post('diag_analyzeExam',input).code,'no_consent');
});
test('T034 fetchAll once for two pages, partial refund, retry accumulates same exam and exact quota',()=>{
  let fail=true,requests=[];const s=setup(r=>{requests.push(r);if(fail&&requests.length===2)return {code:500,body:{}};const p=clone(page);p.items.forEach(x=>x.q_no=String(Number(x.q_no)+(requests.length-1)*4));return response(p);});
  s.post('diag_consent',{agree:true});const before=s.post('diag_quota').left;
  const r=s.post('diag_analyzeExam',{...input,pages:[...input.pages,{n:2,b64:'cGFnZTI='}]});assert.equal(r.ok,true);assert.equal(requests.length,2);assert.equal(s.env.stats.fetchAll,1);assert.equal(r.charged,1);assert.deepEqual(r.failed,[{page:2,code:'ai_error'}]);assert.equal(r.left,before-1);
  const payload=JSON.parse(requests[0].payload);assert.equal(payload.max_tokens,4000);assert.equal(payload.model,'claude-sonnet-5-5');assert.equal(requests[0].muteHttpExceptions,true);assert.equal(payload.output_config.format.schema.additionalProperties,false);
  fail=false;const retry=s.post('diag_analyzeExam',{...input,examId:r.examId,pages:[{n:2,b64:'cGFnZTI='}]});assert.equal(retry.examId,r.examId);assert.equal(retry.left,before-2);const exams=objects(s.env,'exams');assert.equal(exams.length,1);assert.equal(exams[0].pages,2);assert.equal(exams[0].aiCalls,2);
});
test('T034 zero, malformed, refused and timeout pages refund; insufficient quota never calls AI',()=>{
  for(const [ai,error] of [[()=>response({page_ok:true,items:[]}),'zero_items'],[()=>({code:200,body:'bad'}),'ai_error'],[()=>({code:200,body:{stop_reason:'refusal'}}),'refused'],[()=>{throw Error('timeout');},'timeout']]){
    const s=setup(ai);s.post('diag_consent',{agree:true});const before=s.post('diag_quota').left;const r=s.post('diag_analyzeExam',input);assert.equal(r.failed[0].code,error);assert.equal(r.charged,0);assert.equal(r.left,before);assert.equal(objects(s.env,'examItems').length,0);
  }
  const s=setup(()=>assert.fail('AI must not run'));s.post('diag_consent',{agree:true});s.env.props.setProperty(s.env.run('countKey',s.env.run('findFamily',code)),'10');assert.equal(s.post('diag_analyzeExam',input).code,'daily_limit');assert.equal(s.env.stats.fetches,undefined);
});
test('T034 daily and bonus reservations refund their original source, including a date rollover',()=>{
  let s; s=setup(()=>{s.env.clock.advance(86400000);return {code:500,body:{}};});s.post('diag_consent',{agree:true});const family=s.env.run('findFamily',code),key=s.env.run('countKey',family);s.env.props.setProperty(key,'10');s.env.run('setBonus',family,2);
  const r=s.post('diag_analyzeExam',input);assert.equal(r.charged,0);assert.equal(s.env.run('currentBonus',family),2);assert.equal(s.env.props.getProperty(key),'10');
  const t=setup(()=>{t.env.clock.advance(86400000);return {code:500,body:{}};});t.post('diag_consent',{agree:true});const k=t.env.run('countKey',t.env.run('findFamily',code));t.post('diag_analyzeExam',input);assert.equal(t.env.props.getProperty(k),'0');
});
test('T034 scrub all persisted strings, never log b64 or questions, teacher verdict wins',()=>{
  const fake=clone(page);fake.items[0].question_text+=' 姓名：虛構甲';fake.items[0].student_answer='名字：虛構乙';fake.items[0].teacher_mark='ok';
  const s=setup(()=>response(fake));const r=analyzed(s);const rows=objects(s.env,'examItems');assert.ok(!JSON.stringify(rows).includes('虛構甲'));assert.ok(!JSON.stringify(rows).includes('虛構乙'));assert.equal(rows[0].verdict,'ok');assert.equal(rows[0].verdictSource,'teacher');assert.equal(r.items[0].verdict,'ok');
  const logs=s.env.logs.join('\n');assert.ok(!logs.includes(input.pages[0].b64));assert.ok(!logs.includes(fake.items[0].question_text));
  assert.equal(s.env.run('diagScrub','姓名：虛構甲 班級:虛構班 座號 99 學校：虛構校 分數：99 得分 99 名字:虛構乙').includes('虛構'),false);assert.equal(s.env.run('diagScrub',null),null);
});
test('T034 confirm parent edits, cause counts, weak bounds and preserve existing progress',()=>{
  const s=setup(),r=analyzed(s);assert.equal(s.post('diag_examItems',{examId:r.examId}).exam.status,'review');
  const c=s.post('diag_confirmExam',{examId:r.examId,items:[{qNo:'1',verdict:'half',studentAnswer:'姓名：虛構甲'}]});assert.equal(c.ok,true);assert.equal(s.post('diag_examItems',{examId:r.examId}).exam.status,'saved');
  const rows=objects(s.env,'examItems');assert.equal(rows[0].verdictSource,'parent');assert.equal(rows[0].parentEdited,true);assert.ok(!rows[0].studentAnswer.includes('虛構甲'));assert.equal(Object.entries(c.counts).filter(([k])=>k!=='wrong').reduce((n,[,v])=>n+v,0),c.counts.wrong);assert.ok(c.weak.length<=3);assert.ok(c.weak.every(w=>w.n>=2));
  const entry=s.env.run('diagProfile',code+':p1','math');Object.assign(entry.profile.weak[0],{status:'ok',w:0.4,streak:7,scf:2});s.env.run('diagStoreProfile',code+':p1','math',entry,s.env.clock.now());const again=s.post('diag_confirmExam',{examId:r.examId,items:[]});assert.equal(again.weak[0].w,0.4);assert.equal(again.weak[0].status,'ok');assert.equal(again.weak[0].streak,7);
});
test('T034 check makes ten valid questions, separates pairs, mathEval answers, charges once',()=>{
  const s=setup(),c=made(s);assert.equal(c.items.length,10);assert.equal(c.pending.length,0);assert.equal(c.left,8);
  c.items.forEach((x,i)=>{assert.equal(x.a,s.env.run('mathEval',x.expr));if(i)assert.notEqual(x.pairId,c.items[i-1].pairId);});assert.equal(s.post('diag_check',{checkId:c.checkId}).check.items.length,10);
});
test('T034 high grade check stays pending after one replacement; both AI calls failing refunds',()=>{
  let calls=0;const s=setup(r=>{const p=JSON.parse(r.payload),prompt=p.messages[0].content.at(-1).text;if(prompt.startsWith('DIAG_CHECK')){calls++;const x=clone(check);x[0].targetCode='N-6-1';return response(x);}return fixtureAI(r);});
  const c=made(s);assert.ok(!c.items.some(x=>x.id===check[0].id));assert.ok(c.pending.length>=1);assert.equal(calls,2);assert.equal(c.left,8);
  let fail=false;const t=setup(r=>fail?{code:500,body:{}}:fixtureAI(r));const e=confirmed(t);fail=true;const before=t.post('diag_quota').left;const bad=t.post('diag_makeCheck',{examId:e.examId,whitelist:[{code:'N-1-1',grade:1}],words:[]});assert.equal(bad.code,'ai_error');assert.equal(t.post('diag_quota').left,before);
});
test('T034 child state only exposes child fields, postEvents deduplicates and judges first answers',()=>{
  const s=setup(),c=made(s),state=s.post('diag_childState',{session:undefined});const json=JSON.stringify(state);assert.ok(!/弱點|粗心|檢定|"label"|"cause"|"status"|"weakKey"|"variant"/.test(json));assert.equal(state.checks.length,1);assert.deepEqual(Object.keys(state.checks[0].items[0]).sort(),['a','id','o','q']);
  const events=c.items.map((q,i)=>event(s.env,q,c,i));const result=s.post('diag_postEvents',{session:undefined,events});assert.equal(result.accepted.length,10);assert.equal(result.rejected.length,0);
  s.post('diag_postEvents',{session:undefined,events});assert.equal(objects(s.env,'events').length,10);assert.ok(objects(s.env,'events').every(e=>e.subject==='math'&&e.checkId===c.checkId));
  const stored=s.post('diag_check',{checkId:c.checkId}).check;assert.ok(stored.doneAt);for(const key of new Set(c.items.map(x=>x.weakKey))){const answers=Object.fromEntries(events.map(e=>[e.qid,e.ok===1]));assert.deepEqual(stored.resultJSON[key],clone(s.env.run('judgeWeak',c.items.filter(x=>x.weakKey===key),answers)));assert.equal(stored.resultJSON[key].status,'unsteady');}
  assert.equal(s.post('diag_childState',{session:undefined}).checks.length,0);assert.ok(s.post('diag_getProfile').profiles.math.weak.every(x=>x.status==='unsteady'));
  assert.equal(s.post('diag_postEvents',{session:undefined,events:[event(s.env,c.items[0],c,99,{subject:'zh'})]}).rejected.length,1);
});
test('T034 subject deletion isolates subjects and families across five tables',()=>{
  const s=setup(),c=made(s);s.post('diag_postEvents',{events:c.items.map((q,i)=>event(s.env,q,c,i))});confirmed(s,'zh');
  assert.deepEqual(Object.keys(s.post('diag_getProfile').profiles).sort(),['math','zh']);
  s.env.sheets.get('家庭').appendRow(['OTHER-0000','虛構家庭',10,true,'',false,0]);s.env.doPost({code:'OTHER-0000',action:'playerList'});
  const issued=s.env.run('adminParent',{action:'adminIssueSetupCode',family:'OTHER-0000'});const sess=s.env.doPost({code:'OTHER-0000',action:'parentSetPin',setupCode:issued.setupCode,pin:'1234'}).session;
  for(const action of ['diag_examItems','diag_confirmExam','diag_makeCheck'])assert.equal(s.post(action,{code:'OTHER-0000',session:sess,examId:c.examId}).code,'not_found');assert.equal(s.post('diag_check',{code:'OTHER-0000',session:sess,checkId:c.checkId}).code,'not_found');
  const ids=objects(s.env,'exams').filter(x=>x.subject==='math').map(x=>x.examId);assert.equal(s.post('diag_deleteSubject',{subject:'math'}).ok,true);
  for(const name of ['exams','checks','profiles','events'])assert.ok(!objects(s.env,name).some(x=>x.fk===code+':p1'&&x.subject==='math'));assert.ok(!objects(s.env,'examItems').some(x=>ids.includes(x.examId)));assert.ok(s.post('diag_getProfile').profiles.zh);
});
test('T034 retention removes old unsorted rows and their items; setup trigger is idempotent',()=>{
  const s=setup(),now=s.env.clock.now();
  for(const [id,age] of [['new',1],['old',366]]){s.env.run('diagPut','exams',{examId:id,fk:code+':p1',subject:'math',createdAt:now-age*86400000});s.env.run('diagPut','examItems',{examId:id,qNo:'1'});s.env.run('diagPut','checks',{checkId:id,examId:id,fk:code+':p1',subject:'math',createdAt:now-age*86400000});s.env.run('diagPut','profiles',{fk:code+':'+id,subject:'math',updatedAt:now-age*86400000,ver:2,json:'{}'});s.env.run('diagPut','events',{eid:id,ts:now-age*86400000});}
  assert.equal(s.env.run('diag_retentionDaily').ok,true);for(const name of ['exams','examItems','checks','profiles','events'])assert.equal(objects(s.env,name).length,1,name);
  s.env.run('setupDiag');assert.equal(s.env.triggers.filter(t=>t.handler==='diag_retentionDaily').length,1);assert.equal(s.env.triggers.find(t=>t.handler==='diag_retentionDaily').days,1);
});
test('T034 shared blocks stay identical and backend remains standalone without imports',()=>{
  const source=fs.readFileSync('Code.gs','utf8'),html=fs.readFileSync('index.html','utf8'),block=x=>x.slice(x.indexOf('// ==DIAG-SHARED-BEGIN=='),x.indexOf('// ==DIAG-SHARED-END==')+'// ==DIAG-SHARED-END=='.length);
  assert.equal(block(source),block(html));assert.ok(!/^\s*(?:require\(|import\s)/m.test(source));
});

test('T034 network calls run outside lock and consent revocation discards in-flight results with refund',()=>{
  let s,networkAction;s=setup(()=>{networkAction=s.post('diag_consent',{agree:false});return response(clone(page));});s.post('diag_consent',{agree:true});const before=s.post('diag_quota').left;const r=s.post('diag_analyzeExam',input);assert.equal(networkAction.ok,true);assert.equal(networkAction.deferred,undefined);assert.equal(r.code,'no_consent');assert.equal(s.post('diag_quota').left,before);assert.equal(objects(s.env,'exams').length,0);
});
test('T034 incomplete check layout stays pending and a replacement requires independent verification',()=>{
  let checks=0,verifies=0;const s=setup(r=>{const p=JSON.parse(r.payload),prompt=p.messages[0].content.at(-1).text;if(prompt.startsWith('DIAG_CHECK')){checks++;return response(clone(check));}if(prompt.startsWith('DIAG_VERIFY')){verifies++;const input=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));return response(input.map(x=>({i:x.i,answer:verifies===1?'999':'5',code:'N-1-1'})));}return fixtureAI(r);});const c=made(s);assert.equal(c.items.length,10);assert.equal(c.pending.length,0);assert.equal(checks,2);assert.equal(verifies,2);assert.equal(c.left,8);
  const t=setup(r=>{const prompt=JSON.parse(r.payload).messages[0].content.at(-1).text;return prompt.startsWith('DIAG_CHECK')?response(clone(check).slice(0,2)):fixtureAI(r);});const d=made(t);assert.equal(d.items.length,0);assert.equal(d.pending.length,2);
});
test('T034 mock adapter supports diag-fail2, diag-zero, diag-name and built embedded fixtures',async()=>{
  const vm=require('node:vm'),{build}=require('../tools/build'),os=require('node:os'),path=require('node:path');
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'diag-build-'));
  try{build({outDir:out});assert.ok(fs.readFileSync(path.join(out,'index.html'),'utf8').includes('window.MOCK_DIAG_FIXTURES='));}finally{fs.rmSync(out,{recursive:true,force:true});}
  for(const mode of ['diag-fail2','diag-zero','diag-name']){
    const storage=new Map(),sandbox={createGasEnv,Date,URLSearchParams,location:{search:'?mock='+mode},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},btoa:s=>Buffer.from(s,'binary').toString('base64'),MOCK_GAS_SOURCE:fs.readFileSync('Code.gs','utf8'),MOCK_DIAG_FIXTURES:{page:clone(page),check:clone(check)}};sandbox.window=sandbox;
    vm.runInNewContext(fs.readFileSync('tools/mock-backend.js','utf8'),sandbox);
    const post=async(action,extra={})=>{const res=await sandbox.fetch('mock://gas',{body:JSON.stringify({code,action,playerId:'p1',...extra})});return clone(await res.json());};
    const login=await post('parentSetPin',{setupCode:'MOCK2345',pin:'1234'});assert.ok(login.session);const session=login.session;await post('diag_consent',{session,agree:true});
    const r=await post('diag_analyzeExam',{session,...input,pages:[...input.pages,{n:2,b64:'cGFnZTI='}]});assert.equal(r.ok,true);
    if(mode==='diag-fail2'){assert.equal(r.charged,1);assert.equal(r.failed[0].page,2);}if(mode==='diag-zero'){assert.equal(r.charged,0);assert.ok(r.failed.every(x=>x.code==='zero_items'));}if(mode==='diag-name'){assert.equal(r.charged,2);assert.ok(!JSON.stringify(r.items).includes('虛構甲'));}
  }
});
