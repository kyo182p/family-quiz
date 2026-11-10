'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createGasEnv} = require('./fake-gas');
const code = 'TEST-0000', nick = '虛構小樹';
const plain = x => JSON.parse(JSON.stringify(x));
function post(e, action, extra={}) { return e.doPost({code,action,playerId:'p1',...extra}); }
function setup(options={}) {
  const e = createGasEnv(options); e.run('setup');
  e.run('playerSave',code,{playerId:'p1',name:nick,icon:'🌱'});
  e.sheets.get('玩家').appendRow([code,'p2','虛構小石','🐢',1,'啟用',new Date(),new Date(),'']);
  e.props.setProperty('DIAG_SHEET_ID','test-diag'); e.run('setupDiag'); return e;
}
function session(e) {
  if (e.props.getProperty('pin:'+code)) return post(e,'parentLogin',{pin:'907314'}).session;
  const issued = e.run('adminParent',{action:'adminIssueSetupCode',family:code});
  const r = post(e,'parentSetPin',{setupCode:issued.setupCode,pin:'907314'});
  assert.equal(r.ok,true); return r.session;
}
function consent(e, pid='p1', credential=session(e)) {
  const r = post(e,'diag_consent',{session:credential,playerId:pid,agree:true}); assert.equal(r.ok,true); return credential;
}
function sheet(e,name) { return e.books.get('test-diag').book.getSheetByName(name); }
const rows = (e,name) => sheet(e,name).getDataRange().getValues();
function event(e,extra={}) {
  return {ts:e.clock.now(),eid:'event_001',bank:'bank1',qid:'q1',tags:'neg',ok:0,sec:1,len:20,chg:'0',scf:0,scok:'',mode:'prac',sid:'round1',retry:0,intr:0,...extra};
}
const exam = {subject:'數學',examDate:'2026-11-01',qnos:[1,3],tags:['neg','neg']};
const diag = {sid:'diag1',form:'A',n:20,ok:12,perTag:{neg:{n:3,ok:1}}};

test('T029 unset diagnostic book and invalid or foreign players fail closed', () => {
  const e = setup(); e.props.deleteProperty('DIAG_SHEET_ID');
  assert.equal(post(e,'diag_getProfile').code,'diag_off');
  e.props.setProperty('DIAG_SHEET_ID','test-diag');
  for (const playerId of ['p3','p!','',null]) assert.equal(post(e,'diag_getProfile',{playerId}).code,'bad_player');
  assert.equal(post(e,'diag_getProfile',{code:'INVALID'}).code,'bad_code');
});
test('T029 no consent writes no events or profiles; every parent route requires session', () => {
  const e = setup();
  for (const action of ['diag_consent','diag_report','diag_saveExam','diag_deletePlayer','diag_tagBatch'])
    assert.equal(post(e,action).code,'no_session');
  assert.equal(post(e,'diag_postEvents',{events:[event(e)]}).code,'no_consent');
  assert.equal(post(e,'diag_saveDiag',diag).code,'no_consent');
  assert.equal(rows(e,'events').length,1); assert.equal(rows(e,'profiles').length,1);
});
test('T029 consent persists version and timestamp and revocation blocks writes', () => {
  const e = setup(), s = consent(e), p = JSON.parse(rows(e,'profiles')[1][3]);
  assert.deepEqual(p.consent,{ver:'diag-consent-v1',at:e.clock.now()});
  assert.equal(post(e,'diag_consent',{session:s,agree:false}).profile.consent,null);
  assert.equal(post(e,'diag_postEvents',{events:[event(e)]}).code,'no_consent');
  assert.equal(post(e,'diag_consent',{session:s,agree:'true'}).code,'bad_request');
});
test('T029 event whitelist, retry idempotency and per-player profile isolation', () => {
  const e = setup(), s = consent(e); consent(e,'p2',s);
  const ev = event(e), bad = event(e,{eid:'bad_001',sec:3601});
  let r = post(e,'diag_postEvents',{events:[ev,ev,bad]});
  assert.equal(r.ok,true); assert.deepEqual(r.accepted,[ev.eid,ev.eid]); assert.deepEqual(r.rejected,['bad_001']);
  const before = rows(e,'events');
  r = post(e,'diag_postEvents',{events:[ev]});
  assert.deepEqual(r.accepted,[ev.eid]); assert.deepEqual(rows(e,'events'),before);
  assert.equal(r.profile.tags.neg.n,1);
  assert.deepEqual(post(e,'diag_getProfile',{playerId:'p2'}).profile.tags,{});
  assert.equal(rows(e,'profiles').length,3);
  assert.equal(post(e,'diag_postEvents',{events:Array(51).fill(ev)}).code,'bad_request');
  const invalid = [{tags:'bogus'},{ts:e.clock.now()-8*86400000},{ok:true},{qid:'x'.repeat(41)},{chg:'WRONG'},{scf:3},{scok:2},{mode:'bad'},{retry:2},{intr:2},{len:-1},{sec:NaN},{sid:4},{bank:4},{eid:'!'}];
  for (const change of invalid) assert.equal(post(e,'diag_postEvents',{events:[event(e,change)]}).rejected.length,1);
});
test('T029 snapshot restores independent books and profiles on another device', () => {
  const e = setup(); consent(e); post(e,'diag_postEvents',{events:[event(e)]});
  const other = createGasEnv(); other.restore(e.snapshot());
  assert.deepEqual(post(other,'diag_getProfile').profile,post(e,'diag_getProfile').profile);
  assert.notEqual(sheet(e,'events'),sheet(other,'events'));
  assert.notEqual(sheet(e,'events'),e.sheets.get('events'));
  other.run('diagBook').insertSheet('independent'); assert.equal(e.run('diagBook').getSheetByName('independent'),null);
});
test('T029 exam storage uses seven columns, discards private extras and aggregates tags', () => {
  const e = setup(), s = session(e);
  assert.equal(post(e,'diag_saveExam',{session:s,...exam,score:99,photo:'PRIVATE',school:'PRIVATE',q:'PRIVATE'}).ok,true);
  const row = rows(e,'exams')[1]; assert.equal(row.length,7);
  assert.equal(row[4],exam.examDate); assert.equal(row[5],'1,3'); assert.equal(row[6],'neg,neg');
  assert.equal(JSON.stringify(row).includes('PRIVATE'),false);
  assert.equal(post(e,'diag_report',{session:s}).exams.neg,2);
  for (const change of [{qnos:[1,1]},{tags:['neg']},{subject:'學校'},{examDate:'2026-02-30'},{qnos:[41,2]},{tags:['bad','neg']}])
    assert.equal(post(e,'diag_saveExam',{session:s,...exam,...change}).code,'bad_request');
});
test('T029 report matches shared classifier and returns two newest unique diagnostics', () => {
  const e = setup(), s = consent(e);
  const events = Array.from({length:6},(_,i) => event(e,{eid:'event_'+i,qid:'q'+i,ok:i%2,retry:i===5?1:0}));
  post(e,'diag_postEvents',{events});
  for (let i=0;i<3;i++) { e.clock.advance(1); assert.equal(post(e,'diag_saveDiag',{...diag,sid:'diag'+i}).ok,true); }
  const n = rows(e,'diags').length;
  post(e,'diag_saveDiag',{...diag,sid:'diag2'}); assert.equal(rows(e,'diags').length,n);
  const r = post(e,'diag_report',{session:s});
  const cfg = {windowDays:21,spcMinN:8,spcDefault:0.35,base:3,interrupt:1.8,fast:0.6,slow:1.5,minN:4,minWrong:2};
  assert.deepEqual(r.perTag,plain(e.run('classifyTag',events,cfg,e.clock.now())));
  assert.deepEqual(r.diags.map(x=>x.sid),['diag2','diag1']); assert.deepEqual(r.total,{n:5,ok:2});
  assert.equal(post(e,'diag_getProfile').profile.lastDiag.sid,'diag2');
  assert.equal(post(e,'diag_saveDiag',{...diag,perTag:{bad:{n:2,ok:1}}}).code,'bad_request');
});
test('T029 delete removes all four player datasets and preserves the other player', () => {
  const e = setup(), s = consent(e); consent(e,'p2',s);
  for (const playerId of ['p1','p2']) {
    post(e,'diag_postEvents',{playerId,events:[event(e,{eid:'event_'+playerId})]});
    post(e,'diag_saveExam',{playerId,session:s,...exam}); post(e,'diag_saveDiag',{playerId,...diag});
  }
  const fk = e.run('diagFk',{code},'p1'), p2 = e.run('diagFk',{code},'p2');
  // Deletion also works after the player was removed from the primary book.
  const players=e.sheets.get('玩家'), index=players.data.findIndex(r=>r[1]==='p1'); players.deleteRow(index+1);
  const r = post(e,'diag_deletePlayer',{session:s}); assert.equal(r.ok,true);
  for (const name of ['events','profiles','exams','diags']) {
    assert.equal(r.removed[name],1); assert.equal(rows(e,name).some(r=>r.includes(fk)),false);
    assert.equal(rows(e,name).some(r=>r.includes(p2)),true);
  }
});
test('T029 retention reads only timestamp columns and clears expired profiles; setup is idempotent', () => {
  const e = setup(); consent(e); post(e,'diag_postEvents',{events:[event(e)]});
  const s = session(e); post(e,'diag_saveExam',{session:s,...exam}); post(e,'diag_saveDiag',diag);
  e.clock.advance(366*86400000); consent(e,'p2');
  post(e,'diag_postEvents',{playerId:'p2',events:[event(e,{eid:'new_001'})]});
  let readColumns=[]; e.onSheetOp(x => { if (x.op==='read' && ['events','exams','diags'].includes(x.sheet)) readColumns.push(x.col); });
  assert.equal(e.run('diag_retentionDaily').ok,true); e.onSheetOp(null);
  assert.ok(readColumns.length); assert.ok(readColumns.every(c=>c===1));
  assert.equal(rows(e,'events').length,2); assert.equal(rows(e,'events')[1][1],'new_001');
  assert.equal(rows(e,'exams').length,1); assert.equal(rows(e,'diags').length,1); assert.equal(rows(e,'profiles').length,2);
  e.run('setupDiag'); const t=e.triggers.filter(t=>t.handler==='diag_retentionDaily'); assert.equal(t.length,1); assert.equal(t[0].days,1); assert.equal(t[0].hour,3);
});
test('T029 AI tagging isolates prompt, validates confidence and charges only successful site calls', () => {
  let status=200, captured, answer=[{id:'0',primary:'neg',secondary:'',conf:0.5},{id:'1',primary:'cnt',secondary:'qnt',conf:0.9}];
  const e = setup({fetch:(url,options)=>{
    assert.equal(url,'https://api.anthropic.com/v1/messages'); captured=options.payload;
    return {getResponseCode:()=>status,getContentText:()=>JSON.stringify({content:[{type:'text',text:JSON.stringify(answer)}]})};
  }}), s = session(e);
  e.props.setProperty('ANTHROPIC_API_KEY','fake-test-key');
  const req={session:s,grade:'二年級',subject:'數學',name:nick,fk:e.run('diagFk',{code},'p1'),items:[{id:'local1',q:'哪個不是圓形？',o:['圓形','方形']},{id:'local2',q:'共有幾個？',o:['一','二']}]};
  const quota='diagtag:2026-11-05', r=post(e,'diag_tagBatch',req); assert.equal(r.ok,true);
  assert.deepEqual(r.tags[0],{id:'local1',sk:['unk'],skc:0.5,sksrc:'ai'}); assert.deepEqual(r.tags[1].sk,['cnt','qnt']);
  assert.equal(e.props.getProperty(quota),'1'); assert.ok(captured.includes('"temperature":0'));
  for(const secret of [code,nick,req.fk,s,'local1']) assert.equal(captured.includes(secret),false);
  status=500; assert.equal(post(e,'diag_tagBatch',req).ok,false); assert.equal(e.props.getProperty(quota),'1');
  status=200; answer=[{id:'0',primary:'bad',secondary:'',conf:1},{id:'1',primary:'neg',secondary:'bad',conf:1}];
  assert.ok(post(e,'diag_tagBatch',req).tags.every(t=>t.sk[0]==='unk'));
  e.props.setProperty(quota,'40'); assert.equal(post(e,'diag_tagBatch',req).code,'quota');
  assert.equal(post(e,'diag_tagBatch',{...req,items:[]}).code,'bad_request');
});
test('T029 diagnostic cells contain neither nicknames nor invitation codes and text is formula-safe', () => {
  const e = setup(), s = consent(e);
  post(e,'diag_postEvents',{events:[event(e,{qid:'=1+1',bank:'@bank'})],name:nick});
  post(e,'diag_saveExam',{session:s,...exam,photo:nick,score:code}); post(e,'diag_saveDiag',diag);
  for(const name of ['events','profiles','exams','diags']) {
    const text=JSON.stringify(rows(e,name)); for(const secret of [code,nick,'虛構小石']) assert.equal(text.includes(secret),false);
  }
  assert.equal(e.formulaCells.filter(x=>['events','profiles','exams','diags'].includes(x.sheet)).length,0);
});

test('T029 first writes and subsequent event batches use one setValues per table per request', () => {
  const e = setup(); e.props.setProperty('DIAG_SHEET_ID','fresh-diag');
  const book=e.run('diagBook'), writes={};
  // Instrument ranges without changing fake-gas behavior or production request parameters.
  const insert=book.insertSheet;
  book.insertSheet=name=>{
    const sh=insert(name), get=sh.getRange.bind(sh);
    sh.getRange=(...args)=>{
      const range=get(...args), set=range.setValues;
      range.setValues=values=>{writes[name]=(writes[name]||0)+1; return set(values);}; return range;
    }; return sh;
  };
  function once(action,extra) {
    for (const name of Object.keys(writes)) delete writes[name];
    const r=post(e,action,extra); assert.equal(r.ok,true);
    assert.ok(Object.values(writes).every(n=>n<=1),JSON.stringify(writes)); return r;
  }
  const s=session(e);
  once('diag_consent',{session:s,agree:true});
  once('diag_postEvents',{events:[event(e),event(e,{eid:'event_002'})]});
  once('diag_postEvents',{events:[event(e),event(e,{eid:'event_003'})]});
  once('diag_saveDiag',diag); once('diag_saveExam',{session:s,...exam});
  once('diag_deletePlayer',{session:s});
});

test('T029 oversized profiles retain the earliest fifty review entries', () => {
  const e=setup(), s=consent(e), sh=sheet(e,'profiles'), row=rows(e,'profiles')[1];
  const p=JSON.parse(row[3]);
  p.review=Array.from({length:60},(_,i)=>({tag:'neg',dueAt:60-i,step:0,qidSeen:['x'.repeat(750)]}));
  row[3]=JSON.stringify(p); sh.getRange(2,1,1,4).setValues([row]);
  const r=post(e,'diag_consent',{session:s,agree:true}); assert.equal(r.ok,true);
  assert.equal(r.profile.review.length,50); assert.equal(r.profile.review[0].dueAt,1); assert.equal(r.profile.review[49].dueAt,50);
  assert.equal(JSON.parse(rows(e,'profiles')[1][3]).review.length,50);
});
