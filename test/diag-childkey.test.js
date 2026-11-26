'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createGasEnv}=require('./fake-gas');
const code='TEST-0000',plain=x=>JSON.parse(JSON.stringify(x));
function setup(){
  const env=createGasEnv();env.run('setup');env.doPost({code,action:'playerList'});
  const issued=env.run('adminParent',{action:'adminIssueSetupCode',family:code});
  const session=env.doPost({code,action:'parentSetPin',setupCode:issued.setupCode,pin:'1234'}).session;
  const post=(action,data={})=>{const r=env.doPost({code,session,playerId:'p1',action,...data});if(r.code!=='need_child_key')delete r.timing;return r;};
  const p2=post('playerSave',{playerId:undefined,name:'虛構小狐',icon:'🦊'}).player.id;
  return {env,post,p2};
}
function seed(s){
  const {env,post,p2}=s;env.props.setProperty('DIAG_SHEET_ID','fake-sheet');env.run('setupDiag');post('diag_consent',{agree:true});
  for(const pid of ['p1',p2]){
    const fk=code+':'+pid;
    const items=['A','B','A','B','R'].map((variant,i)=>({id:'q'+i,q:'2 + 3 = ?',o:['4','5','6'],a:'5',weakKey:'code:N-1-1',pairId:'pair'+Math.floor(i/2),variant,targetCode:'N-1-1',verified:true}));
    env.run('diagPut','checks',{checkId:'check-'+pid,examId:'exam-'+pid,fk,subject:'math',grade:1,items:JSON.stringify(items),createdAt:env.clock.now(),doneAt:'',resultJSON:''});
    const profile={ver:2,weak:['code:N-1-1','type:add','tag:neg','tag:invalid'].map(key=>({key,w:1,streak:0})),review:[{key:'code:N-1-1',qidSeen:['old'],step:0,dueAt:1},{tag:'neg',qidSeen:['old'],step:1,dueAt:2},{key:'tag:invalid',tag:'invalid',qidSeen:['old'],step:0,dueAt:3}]};
    env.run('diagStoreProfile',fk,'math',{profile,row:env.run('diagRows','profiles').length+1},env.clock.now());
  }
}
function event(env,i,extra={}){
  return {ts:env.clock.now(),eid:'event_'+i,qid:'q'+i,bank:'',tags:'neg',sec:10,len:20,scf:0,scok:'',mode:'check',sid:'round',retry:0,intr:0,subject:'math',checkId:'check-p1',pick:1,first:1,moved:0,...extra};
}
function denied(s,key,pid='p1'){
  const before=JSON.stringify(s.env.snapshot().sheets);
  for(const action of ['diag_childState','diag_postEvents'])assert.deepEqual(s.post(action,{session:undefined,playerId:pid,childKey:key,events:[event(s.env,0)]}),{ok:false,code:'need_child_key'});
  assert.equal(JSON.stringify(s.env.snapshot().sheets),before,'no event or profile writes');
}

test('T040 key routes require PIN, validate player and work without DIAG_SHEET_ID',()=>{
  const s=setup();
  for(const action of ['diag_issueChildKey','diag_revokeChildKey']){
    assert.equal(s.post(action,{session:undefined}).code,'no_session');
    assert.equal(s.post(action,{playerId:'p9'}).code,'bad_player');
  }
  const key=s.post('diag_issueChildKey').childKey;assert.match(key,/^[A-Za-z0-9-]{20,64}$/);
  assert.equal(s.env.props.getProperty('diagckey:'+code+':p1'),s.env.run('parentHash',key));
  assert.match(s.env.props.getProperty('diagckey:'+code+':p1'),/^[a-f0-9]{64}$/);
  assert.deepEqual(s.post('diag_revokeChildKey'),{ok:true});assert.equal(s.env.props.getProperty('diagckey:'+code+':p1'),null);
});

test('T040 child state hides answers and raw weak keys; sibling key is rejected',()=>{
  const s=setup();seed(s);const childKey=s.post('diag_issueChildKey').childKey;
  const r=s.post('diag_childState',{session:undefined,childKey});assert.equal(r.ok,true);assert.equal(r.checks.length,1);assert.equal(r.checks[0].checkId,'check-p1');
  for(const q of r.checks[0].items)assert.deepEqual(Object.keys(q).sort(),['id','o','q']);
  assert.doesNotMatch(JSON.stringify(r),/"a"|code:|type:|tag:|N-1-1/);
  assert.deepEqual(r.subjects.math.weak.map(x=>x.tag),['','','neg','']);assert.deepEqual(r.subjects.math.review.map(x=>x.tag),['','neg','']);
  for(const w of [...r.subjects.math.weak,...r.subjects.math.review])assert.match(w.key,/^w[a-f0-9]{10}$/);
  denied(s,childKey,s.p2);
  assert.equal(s.post('diag_childState',{childKey,subject:'zh'}).checks.length,0);
});

test('T040 missing, wrong, malformed, rotated and revoked keys cannot read or write',()=>{
  const s=setup();seed(s);const old=s.post('diag_issueChildKey').childKey;
  for(const key of [undefined,null,123,{},'short','!'.repeat(36),'A'.repeat(65),'FAKE-KEY-0000-0000-0000'])denied(s,key);
  const next=s.post('diag_issueChildKey').childKey;assert.notEqual(next,old);denied(s,old);
  assert.equal(s.post('diag_childState',{childKey:next}).ok,true);
  s.post('diag_revokeChildKey');denied(s,next);
});

test('T040 player validation and consent precede child key verification',()=>{
  const s=setup();seed(s);s.post('diag_consent',{agree:false});
  assert.deepEqual(s.post('diag_childState',{session:undefined}),{ok:true,consent:false,subjects:{},checks:[]});
  assert.deepEqual(s.post('diag_postEvents',{session:undefined,events:[]}),{ok:false,code:'no_consent'});
  for(const action of ['diag_childState','diag_postEvents'])assert.equal(s.post(action,{playerId:'p9',session:undefined}).code,'bad_player');
});

test('T040 backend grades check choices, ignores forged results and preserves judgeWeak',()=>{
  const s=setup();seed(s);const childKey=s.post('diag_issueChildKey').childKey;
  const choices=[[0,1,1,0,'RW'],[1,0,1,1,'WR'],[2,0,1,0,'WW'],[1,1,1,1,'0'],[1,0,0,1,'0']];
  const events=choices.map(([pick,first,moved,ok,chg],i)=>event(s.env,i,{pick,first,moved,ok:1-ok,chg:'forged'}));
  const r=s.post('diag_postEvents',{session:undefined,childKey,events});assert.deepEqual(r,{ok:true,accepted:events.map(e=>e.eid),rejected:[]});
  const rows=plain(s.env.run('diagObjects','events'));assert.deepEqual(rows.map(e=>[e.ok,String(e.chg)]),choices.map(x=>x.slice(3)));
  for(const row of rows)for(const k of ['pick','first','moved'])assert.equal(k in row,false);
  const check=s.post('diag_check',{checkId:'check-p1'}).check;assert.ok(check.doneAt);
  const answers=Object.fromEntries(rows.map(e=>[e.qid,e.ok===1]));
  assert.deepEqual(check.resultJSON['code:N-1-1'],plain(s.env.run('judgeWeak',check.items,answers)));
  const invalid=[{pick:3},{pick:-1},{pick:0.5},{pick:'1'},{first:3},{first:null},{moved:2},{moved:'1'},{qid:'missing'},{checkId:'check-'+s.p2}];
  const bad=invalid.map((x,i)=>event(s.env,0,{eid:'reject_'+i,...x}));
  assert.deepEqual(s.post('diag_postEvents',{childKey,events:bad}),{ok:true,accepted:[],rejected:bad.map(e=>e.eid)});
  assert.equal(s.env.run('diagObjects','events').length,5);
  for(const mode of ['prac','rev','diag']){
    const e=event(s.env,0,{eid:'normal_'+mode,mode,checkId:'',ok:0,chg:'WW'});
    assert.deepEqual(s.post('diag_postEvents',{childKey,events:[e]}).accepted,[e.eid]);
  }
});

test('T040 raw keys never enter sheets, properties, logs or other parent responses',()=>{
  const s=setup();seed(s);const keys=[s.post('diag_issueChildKey').childKey,s.post('diag_issueChildKey',{playerId:s.p2}).childKey];
  s.post('diag_childState',{childKey:keys[0]});s.post('diag_postEvents',{childKey:keys[0],events:[event(s.env,0)]});
  const replies=['diag_getProfile','diag_quota','diag_check'].map(action=>s.post(action,{checkId:'check-p1'}));
  replies.push(s.post('diag_revokeChildKey'));
  const exposed=JSON.stringify({sheets:s.env.snapshot().sheets,props:s.env.props.getProperties(),logs:s.env.logs,replies});
  for(const key of keys)assert.equal(exposed.includes(key),false);
});

test('T040 opaque weak IDs are stable and scoped to fk',()=>{
  const s=setup(),id=s.env.run('diagWeakId',code+':p1','code:N-1-1');
  assert.equal(id,s.env.run('diagWeakId',code+':p1','code:N-1-1'));
  assert.notEqual(id,s.env.run('diagWeakId',code+':'+s.p2,'code:N-1-1'));
  assert.notEqual(id,s.env.run('diagWeakId','OTHER-0000:p1','code:N-1-1'));
});
