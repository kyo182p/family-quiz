'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'Code.gs'),'utf8');
const extract=s=>s.split('// ==DIAG-SHARED-BEGIN==')[1].split('// ==DIAG-SHARED-END==')[0];
const block=extract(source),sandbox=vm.createContext({});
vm.runInContext(block,sandbox);
const run=s=>JSON.parse(JSON.stringify(vm.runInContext(s,sandbox)));
const call=(name,...args)=>run(`${name}(...${JSON.stringify(args)})`);
test('T033 shared block is identical and contains no dynamic code execution',()=>{
  assert.equal(block,extract(fs.readFileSync(path.join(root,'index.html'),'utf8')));
  assert.doesNotMatch(block,/\beval\s*\(|\b(?:new\s+)?Function\s*\(/);
  assert.deepEqual(run('DIAG_SUBJECTS'),['zh','math','sci','soc','en']);
  assert.equal(run('DIAG_CONSENT_VER'),3);
  assert.equal(run('DIAG_TAGS.length'),7);
});
test('T033 diagCauseCounts counts only wrong and half answers, including unknown causes',()=>{
  const rows=['read','read','concept','slip','bogus'].map((cause,i)=>({cause,verdict:i?'ng':'half'}));
  rows.push(...Array.from({length:3},()=>({cause:'read',verdict:'ok'})));
  assert.deepEqual(call('diagCauseCounts',rows),{read:2,concept:1,slip:1,unknown:1,wrong:5});
  assert.equal(call('diagCauseCounts',[{verdict:'ng',cause:'constructor'}]).unknown,1);
});
test('T033 pickWeak greedily assigns each wrong question once, limits groups and guards concept',()=>{
  const rows=Array.from({length:10},(_,i)=>({qNo:i+1,verdict:'ng',cause:'concept',readTag:i<4?'neg':'',code:i>=4&&i<6?'N-3-9':'',type:i===6?'填充':i>6?'選擇':''}));
  const result=call('pickWeak',rows);
  assert.deepEqual(result.map(x=>[x.key,x.n]),[['tag:neg',4],['type:選擇',3],['code:N-3-9',2]]);
  assert.ok(result.every(x=>x.cause==='unknown'));
  assert.equal(new Set(result.flatMap(x=>x.examQs)).size,9);
  assert.equal(call('pickWeak',Array.from({length:12},(_,i)=>({qNo:i,verdict:'half',type:'type'+Math.floor(i/2)}))).length,3);
  assert.equal(call('pickWeak',rows.slice(0,4).map(x=>({...x,parentConfirmed:true})))[0].cause,'concept');
  assert.equal(call('pickWeak',rows.slice(0,4).map(x=>({...x,parentEdited:true})))[0].cause,'concept');
  const tied=[{qNo:1,verdict:'ng',readTag:'neg',code:'N-3-9',type:'x',cause:'read'},{qNo:2,verdict:'ng',readTag:'neg',code:'N-3-9',type:'x',cause:'concept',parentEdited:true}];
  assert.equal(call('pickWeak',tied)[0].key,'tag:neg');
  assert.equal(call('pickWeak',tied)[0].cause,'concept');
});
const pairs=[{id:'a1',pairId:'p1',variant:'A'},{id:'b1',pairId:'p1',variant:'B'},{id:'a2',pairId:'p2',variant:'A'},{id:'b2',pairId:'p2',variant:'B'},{id:'r',variant:'R'}];
test('T033 judgeWeak requires two consistent complete pairs and successful rephrasing',()=>{
  const all={a1:true,b1:true,a2:true,b2:true,r:true};
  assert.deepEqual(call('judgeWeak',pairs,all),{status:'ok',pairs:[{pairId:'p1',result:'pass'},{pairId:'p2',result:'pass'}],trap:2,plain:2,pairsN:2,rephrase:1,rephraseN:1});
  for(const [answers,status] of [[{b1:true,b2:true},'unsteady'],[{},'practice'],[{a1:true,a2:true},'unknown'],[{b1:true},'unknown'],[{...all,r:false},'unknown']])assert.equal(call('judgeWeak',pairs,answers).status,status);
  assert.equal(call('judgeWeak',pairs.slice(0,2),all).status,'unknown');
  assert.equal(call('judgeWeak',pairs.filter(x=>x.id!=='b1'),all).status,'unknown');
  assert.equal(call('judgeWeak',pairs.slice(0,4),all).status,'unknown');
});
test('T033 mathEval parses rational arithmetic exactly and rejects invalid or unsafe input',()=>{
  for(const [expr,result] of [['125×4','500'],['3/5+1/5','4/5'],['(2+3)×4','20'],['7÷0',null],['2+alert(1)',null],['0.3+0.2','0.5'],['7/5','7/5'],['-(-2+3)','-1'],['2/6','1/3'],['0.1*0.2','0.02'],['2 3',null],['',null],['1e2',null],['2**3',null],['9007199254740992',null]])assert.equal(call('mathEval',expr),result,expr);
});
const ctx={subject:'math',grade:3,whitelist:[{code:'N-3-9',grade:3},{code:'S-4-2',grade:4}]};
const checks=Array.from({length:10},(_,i)=>({id:'q'+i,weakKey:'w'+Math.floor(i/5),pairId:i%5===4?'':'p'+Math.floor(i/5)+'-'+Math.floor(i%5/2),variant:i%5===4?'R':i%2?'B':'A',q:'計算 2+3',expr:'2+3',o:[' 5 ','6'],a:'6',targetCode:'N-3-9'}));
test('T033 buildCheck verifies ten questions, overwrites AI answers and rejects invalid scope or options',()=>{
  const before=JSON.stringify(checks),good=call('buildCheck',checks,ctx);
  assert.equal(good.items.length,10);assert.equal(good.pending.length,0);
  assert.ok(good.items.every(x=>x.a==='5'&&x.verified));assert.equal(JSON.stringify(checks),before);
  assert.equal(call('buildCheck',[{...checks[0],targetCode:'S-4-2'}],ctx).pending.length,1);
  for(const change of [{o:['5',' 5 ']},{o:['6','7']},{expr:'1/0'},{q:'計算 123456+1'},{expr:'123456+1'},{targetCode:'N-3-8'}]){
    const result=call('buildCheck',[{...checks[0],...change}],ctx);assert.equal(result.pending.length,1);assert.equal(result.items.length,0);
  }
  assert.equal(call('buildCheck',[{q:'A cat',o:['cat','dog'],a:'cat'}],{subject:'en',words:['a','cat']}).pending.length,1);
  assert.equal(call('buildCheck',[{q:'A cat',o:['cat','dog'],a:'cat'}],{subject:'en',words:['a','cat','dog']}).items.length,1);
});
test('T033 arrangeCheck separates pairs deterministically and preserves impossible inputs',()=>{
  const result=call('arrangeCheck',checks);
  for(let i=1;i<result.length;i++)assert.ok(result[i].variant==='R'||result[i-1].variant==='R'||result[i].pairId!==result[i-1].pairId);
  assert.deepEqual(result,call('arrangeCheck',checks));assert.equal(new Set(result.map(x=>x.id)).size,10);
  assert.equal(call('arrangeCheck',pairs.slice(0,2)).length,2);
  // A dominant group must be spread apart, with free R questions used as separators.
  const uneven=Array.from({length:7},(_,i)=>({id:i,pairId:i<4?'x':'y'+i,variant:'A'}));
  const spread=call('arrangeCheck',uneven);assert.ok(spread.every((x,i)=>!i||x.pairId!==spread[i-1].pairId));
});
test('T033 redactPlan scales without enlargement and rounds rectangles outward within canvas',()=>{
  assert.deepEqual(run('redactPlan(4000,3000,[DIAG_TOP_BOX],1600)'),{w:1600,h:1200,rects:[{x:0,y:0,w:1600,h:180}]});
  assert.deepEqual(call('redactPlan',900,600,[]),{w:900,h:600,rects:[]});
  assert.deepEqual(call('redactPlan',100,100,[{x:-0.1,y:0.015,w:1.2,h:0.1}]).rects,[{x:0,y:1,w:100,h:11}]);
});
test('T033 jpegHasExif walks length-delimited markers and stops at SOS or malformed data',()=>{
  const exif=[255,216,255,225,0,8,69,120,105,102,0,0,255,218];
  assert.equal(call('jpegHasExif',exif),true);
  assert.equal(run(`jpegHasExif(new Uint8Array(${JSON.stringify(exif)}))`),true);
  assert.equal(call('jpegHasExif',[255,216,255,224,0,2,255,218,...exif.slice(2)]),false);
  assert.equal(call('jpegHasExif',[255,216,255,225,0,20,69,120,105,102,0,0]),false);
  assert.equal(call('jpegHasExif',[]),false);
});
test('T033 scheduleReview advances 1 to 3 to 7 days without mutating input',()=>{
  const cfg=run('DIAG_CFG'),day=86400000;
  let review=call('scheduleReview',[],{tags:'neg',qid:'q1',retry:0,ok:0,mode:'prac'},cfg,0);
  assert.equal(review[0].dueAt,day);
  const before=JSON.stringify(review);
  let next=call('scheduleReview',review,{tags:'neg',qid:'q2',retry:0,ok:1,mode:'rev'},cfg,day);
  assert.equal(next[0].dueAt,4*day);assert.equal(JSON.stringify(review),before);
  next=call('scheduleReview',next,{tags:'neg',qid:'q3',retry:0,ok:1,mode:'rev'},cfg,4*day);
  assert.equal(next[0].dueAt,11*day);
  assert.deepEqual(call('scheduleReview',next,{tags:'neg',qid:'q4',retry:0,ok:1,mode:'rev'},cfg,11*day),[]);
});
test('T033 composeRound uses a single subject profile, reserves about half and fades at five correct',()=>{
  const cfg=run('DIAG_CFG'),normal=Array.from({length:20},(_,i)=>({id:'n'+i}));
  const opts={profile:{weak:[{key:'tag:neg',n:10,ok:8}],review:[]},cfg,n:12,normal,weakPool:{'tag:neg':Array.from({length:10},(_,i)=>({id:'w'+i})),other:[{id:'other'}]},old:[{q:{id:'foreign'},entry:{tag:'other'}}]};
  const before=JSON.stringify(opts),round=call('composeRound',opts);
  assert.equal(round.length,12);assert.ok([5,6].includes(round.filter(x=>x.kind==='weak').length));
  assert.ok(round.every(x=>x.q.id!=='other'&&x.q.id!=='foreign'));assert.equal(JSON.stringify(opts),before);
  opts.profile.weak[0].streak=5;
  const fading=call('composeRound',opts).filter(x=>x.kind==='weak').length;
  assert.ok(fading>0&&fading<6);
  opts.profile.weak[0].streak=9;
  assert.ok(call('composeRound',opts).every(x=>x.kind==='normal'));
});
test('T033 classifyTag retains PR5 conservative minimum evidence classification',()=>{
  assert.deepEqual(call('classifyTag',[],run('DIAG_CFG'),0),{});
  const events=Array.from({length:4},(_,i)=>({ts:i,tags:'neg',ok:0,retry:0,intr:0,sec:0.1,len:10,sid:'s',qid:'q'+i}));
  assert.equal(call('classifyTag',events,run('DIAG_CFG'),10).neg.verdict,'slip');
});
test('T033 curriculum records have valid grades, exact source and lowercase vocabulary',()=>{
  const math=JSON.parse(fs.readFileSync(path.join(root,'data/curriculum/math.json'),'utf8'));
  assert.ok(math.length>0);assert.equal(new Set(math.map(x=>x.code)).size,math.length);
  for(const x of math){assert.equal(call('codeGrade',x.code),x.grade);assert.ok(x.grade>=1&&x.grade<=6);assert.ok(x.text.trim());assert.equal(x.source,'十二年國民基本教育課程綱要 數學領域（國家教育研究院）');}
  for(const code of ['n-3-9','N-0-1','N-3','N-3-0','X-3-1'])assert.equal(call('codeGrade',code),null);
  assert.equal(call('codeGrade','N-7-1'),7);
  const en=JSON.parse(fs.readFileSync(path.join(root,'data/curriculum/en.json'),'utf8'));
  assert.ok(en.source);assert.ok(en.words300.length>0);assert.ok(en.words1200.length>0);
  for(const list of [en.words300,en.words1200]){assert.equal(new Set(list).size,list.length);assert.ok(list.every(w=>w&&w===w.toLowerCase()));}
  assert.ok(en.words300.every(w=>en.words1200.includes(w)));
  assert.ok(en.words1200.includes('shoe')&&en.words1200.includes('shoes'));
  assert.ok(!en.words1200.includes('s'));
});
