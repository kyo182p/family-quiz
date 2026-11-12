'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const {createGasEnv}=require('./fake-gas');
const {build}=require('../tools/build');
const page=require('./fixtures/diag-page.json');
const code='TEST-0000';
const operator='本功能由家庭題庫站長（網站維護者）經營';
const transfer='照片會送到美國的 Anthropic 處理';
const input={subject:'math',grade:1,term:1,examDate:'2026-11-01',codes:['N-1-1','N-1-2'],pages:[{n:1,b64:'ZmFrZQ=='}]};
function setup(){
  const env=createGasEnv({ai:()=>({code:200,body:{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(page)}]}})});
  env.run('setup');env.doPost({code,action:'playerList'});
  const issued=env.run('adminParent',{action:'adminIssueSetupCode',family:code});
  const session=env.doPost({code,action:'parentSetPin',setupCode:issued.setupCode,pin:'1234'}).session;
  assert.ok(session);env.props.setProperty('DIAG_SHEET_ID','fake-sheet');env.run('setupDiag');
  env.run('diagStoreProfile',code+':*','all',{profile:{consent:{ver:2,at:env.clock.now()}}},env.clock.now());
  return {env,session,post:(action,data={})=>env.doPost({code,session,playerId:'p1',action,...data})};
}

test('T042 backend rejects stored v2 consent and persists renewed v3 consent',()=>{
  const {env,post}=setup();
  assert.equal(env.run('diagProfile',code+':*','all').profile.consent.ver,2);
  assert.equal(post('diag_getProfile').consent,null);
  assert.equal(post('diag_analyzeExam',input).code,'no_consent');
  assert.equal(post('diag_childState',{session:undefined}).consent,false);
  assert.equal(env.stats.fetches,undefined);
  assert.equal(post('diag_consent',{agree:true}).consent.ver,3);
  assert.equal(env.run('diagProfile',code+':*','all').profile.consent.ver,3);
  assert.equal(post('diag_getProfile').consent.ver,3);
  const result=post('diag_analyzeExam',input);
  assert.notEqual(result.code,'no_consent');assert.equal(result.ok,true);assert.equal(result.charged,1);
});

test('T042 parent with stored v2 consent sees the updated consent notice',async t=>{
  const {env,session,post}=setup();
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fq-consent-v3-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  build({outDir:dir});
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e)});
  const dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8'),{
    url:'https://quiz.invalid/#parent',runScripts:'dangerously',virtualConsole:vc,
    beforeParse(w){w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.speechSynthesis={cancel(){},getVoices(){return []},speak(){},addEventListener(){}}}
  });
  const w=dom.window;t.after(()=>{w.close();assert.deepEqual(errors,[])});
  for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
  const requests=[];
  w.fetch=async(url,options)=>{assert.equal(String(url),'mock://gas');const req=JSON.parse(options.body);requests.push(req);return {json:async()=>env.doPost(req)}};
  w.parentSession=session;w.eval('PARENT_SESSION=parentSession');
  w.document.querySelectorAll('script').forEach(s=>s.remove());
  await w.parentMain('exam');
  assert.ok(requests.some(r=>r.action==='diag_getProfile'));
  assert.equal(env.run('diagProfile',code+':*','all').profile.consent.ver,2);
  const q=sel=>w.document.querySelector(sel);
  assert.ok(q('#ex-consent'));assert.equal(q('#ex-consent').disabled,true);assert.equal(q('#ex-upload').disabled,true);
  assert.ok(q('#ex-notice').textContent.includes(operator));
  assert.ok(q('#ex-notice').textContent.includes(transfer));
  assert.equal(q('#ex-notice').textContent,w.eval('DIAG_NOTICE'));
  q('#ex-agree').checked=true;q('#ex-agree').dispatchEvent(new w.Event('change'));
  await q('#ex-consent').onclick();
  assert.equal(post('diag_getProfile').consent.ver,3);assert.equal(q('#ex-upload').disabled,false);
});

test('T042 source notices disclose operator and overseas processing; README explains device setup',()=>{
  for(const file of ['index.html','README.md']){
    const text=fs.readFileSync(file,'utf8');
    assert.ok(text.includes(operator),file+' operator');assert.ok(text.includes(transfer),file+' transfer');
  }
  assert.ok(fs.readFileSync('README.md','utf8').includes('讓這台裝置給'));
});
