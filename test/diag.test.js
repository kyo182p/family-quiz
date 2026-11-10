'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const gas=fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8');
const block=s=>s.split('// ==DIAG-SHARED-BEGIN==')[1].split('// ==DIAG-SHARED-END==')[0].replace(/\r\n/g,'\n');
const names=['DIAG_CFG','DIAG_TAGS','DIAG_TAG_IDS','primaryTag','ruleTags','speedOf','classifyTag','emptyProfile','scheduleReview','dueReviews','applyEvents','pickWeak','composeRound','buildDiagForm'];
const ctx=vm.createContext({});
const d=vm.runInContext(block(html)+'\n;({'+names.join(',')+'})',ctx);
const bankSource=html.slice(html.indexOf('const DIAG_BANK=')).split('];')[0]+'];';
const bank=vm.runInContext(bankSource+'\nDIAG_BANK',ctx);
const normSource=html.slice(html.indexOf('function normQ('),html.indexOf('const newId='));
const norm=vm.runInContext(normSource+'\nnormQ',ctx);
const cfg=d.DIAG_CFG,DAY=86400000,now=100*DAY;
const plain=x=>JSON.parse(JSON.stringify(x));
function rng(seed){return function(){let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
function event(i,extra={}){return {ts:now-1000+i,eid:'e'+i,qid:'q'+i,bank:'fake',tags:'neg',ok:1,sec:10,len:20,chg:'0',scf:0,scok:'',mode:'diag',sid:'s',retry:0,intr:0,...extra};}
function weakProfile(){const p=d.emptyProfile();p.tags.neg={n:10,ok:7,streak:0,w:1,scf:2,run:0,recent:[]};return p;}
function questions(tag,n){return Array.from({length:n},(_,i)=>({id:tag+i,sk:[tag]}));}

test('shared block identical',()=>{
  assert.equal(block(html),block(gas));
  assert.doesNotMatch(block(html),/Date\.now|Math\.random|\bwindow\b|\bdocument\b|localStorage/);
  assert.equal(html.split('// ==DIAG-SHARED-BEGIN==').length,2);
  assert.equal(gas.split('// ==DIAG-SHARED-BEGIN==').length,2);
});
test('diagnostic configuration, tag contract and rule offsets',()=>{
  assert.deepEqual(plain(d.DIAG_TAG_IDS),['neg','qnt','cnt','ctx','evi','shp','prf']);
  assert.deepEqual(plain(d.DIAG_TAGS.map(t=>t.name)),['否定題','限定詞','多項數數／組合','情境轉概念','閱讀找證據／推論','形近字與字形細節','校對錯字','未分類']);
  assert.equal(d.primaryTag({}),'unk');assert.equal(d.primaryTag({sk:['qnt','neg']}),'qnt');
  const text='下列哪一種動物「不是」用鰓呼吸？',hit=d.ruleTags(text);
  assert.equal(hit.neg.word,'不是');assert.equal(text[hit.neg.at],'不');
  assert.equal(d.ruleTags('不屬於').neg.word,'不屬於');
  for(const word of ['不正確','不可能','不符合','不會','不能','錯誤','沒有'])assert.equal(d.ruleTags('甲'+word).neg.at,1);
  for(const word of ['所有','有些','一定','至少','只有','都'])assert.equal(d.ruleTags(word).qnt.word,word);
  assert.deepEqual(plain(d.ruleTags('樹葉')), {neg:null,qnt:null});
});
test('speedOf uses eligible median, fallback and relative time',()=>{
  const es=Array.from({length:8},(_,i)=>event(i,{sec:i+1,len:10}));
  assert.equal(d.speedOf(es,cfg).spc,0.45);
  assert.equal(d.speedOf(es.slice(0,7),cfg).spc,0.35);
  assert.equal(d.speedOf(es.concat(event(9,{ok:0,sec:1000}),event(10,{intr:1,sec:1000}),event(11,{len:0})),cfg).spc,0.45);
  assert.equal(d.speedOf([],cfg).rel(event(0)),1);
});
// Six events: four first attempts (O,O,X,X) plus two successful retries.
// q2: fast + retry correct + preceding two correct = 3 slip.
// q3: fast + retry correct = 2 slip. Total slip 5, learn 0, n4/ok2/wrong2.
function slipEvents(){return [event(0),event(1),event(2,{ok:0,sec:3}),event(3,{ok:0,sec:3}),event(4,{qid:'q2',retry:1}),event(5,{qid:'q3',retry:1})];}
// Six events: four first attempts (O,O,X,X) plus two failed retries.
// q2: slow + retry wrong + RW + preceding two correct = learn3/slip1.
// q3: slow + retry wrong + WW = learn3. Total learn6/slip1, accuracy 50% adds 0.
function learnEvents(){return [event(0),event(1),event(2,{ok:0,sec:16,chg:'RW'}),event(3,{ok:0,sec:16,chg:'WW'}),event(4,{qid:'q2',retry:1,ok:0}),event(5,{qid:'q3',retry:1,ok:0})];}
test('classifyTag hand calculated six-event slip case',()=>{
  assert.deepEqual(plain(d.classifyTag(slipEvents(),cfg,now).neg),{tag:'neg',n:4,ok:2,wrong:2,fixes:0,slip:5,learn:0,verdict:'slip'});
});
test('classifyTag hand calculated six-event learn case',()=>{
  assert.deepEqual(plain(d.classifyTag(learnEvents(),cfg,now).neg),{tag:'neg',n:4,ok:2,wrong:2,fixes:0,slip:1,learn:6,verdict:'learn'});
});
test('classifyTag minimums, window, interruption, first tag and session boundaries',()=>{
  assert.equal(d.classifyTag(slipEvents().slice(0,3),cfg,now).neg.verdict,'unclear');
  assert.equal(d.classifyTag([event(0),event(1),event(2),event(3,{ok:0,sec:3})],cfg,now).neg.verdict,'unclear');
  const noise=[event(8,{ts:now-22*DAY,ok:0}),event(9,{intr:1,ok:0}),event(10,{sec:19,ok:0})];
  assert.deepEqual(plain(d.classifyTag(slipEvents().concat(noise),cfg,now)),plain(d.classifyTag(slipEvents(),cfg,now)));
  assert.equal(d.classifyTag([event(0,{tags:'qnt,neg',chg:'WR'})],cfg,now).qnt.fixes,1);
  assert.equal(d.classifyTag(slipEvents().map((e,i)=>i<2?{...e,sid:'other'}:e),cfg,now).neg.slip,4);
  assert.equal(d.classifyTag([event(0,{ok:0,sec:10})],cfg,now).neg.learn,1);
  assert.deepEqual(plain(d.classifyTag([event(0,{tags:'unk'})],cfg,now)),{});
});
test('applyEvents fades weight at fifth and sixth correct and adjusts scaffolding',()=>{
  const p=weakProfile(),snapshot=plain(p),es=Array.from({length:5},(_,i)=>event(i));
  const after=d.applyEvents(p,es,cfg,now);
  assert.ok(Math.abs(after.tags.neg.w-0.7)<1e-9);assert.equal(after.tags.neg.scf,1);assert.equal(after.tags.neg.run,0);
  const sixth=d.applyEvents(after,[event(6)],cfg,now);
  assert.ok(Math.abs(sixth.tags.neg.w-0.49)<1e-9);
  assert.equal(d.applyEvents(sixth,[event(7,{ok:0})],cfg,now).tags.neg.scf,2);
  assert.deepEqual(plain(p),snapshot);
  const wrongStep=d.applyEvents(after,[event(6,{scok:0})],cfg,now).tags.neg;
  assert.equal(wrongStep.streak,0);assert.equal(wrongStep.run,0);assert.equal(wrongStep.w,after.tags.neg.w);
  assert.equal(d.applyEvents(p,Array.from({length:10},(_,i)=>event(i)),cfg,now).tags.neg.w,0);
});
test('applyEvents skips retries entirely, reweakens, caps recent and tracks speed',()=>{
  const p=weakProfile();
  assert.deepEqual(plain(d.applyEvents(p,[event(1,{ok:0,retry:1,mode:'rev'})],cfg,now)),plain(p));
  const es=Array.from({length:3},(_,i)=>event(i,{ok:0}));
  const out=d.applyEvents(d.emptyProfile(),es,cfg,now);
  assert.equal(out.tags.neg.w,1);assert.equal(out.tags.neg.scf,2);assert.equal(out.spc,null);
  assert.equal(d.applyEvents(d.emptyProfile(),es.map(e=>({...e,tags:'ctx'})),cfg,now).tags.ctx.scf,0);
  const unknown=d.applyEvents(d.emptyProfile(),[event(0,{tags:'unk',ok:0})],cfg,now);
  assert.equal(unknown.tags.unk.n,1);assert.equal(unknown.tags.unk.recent.length,0);assert.equal(unknown.review.length,0);
  const many=d.applyEvents(d.emptyProfile(),Array.from({length:12},(_,i)=>event(i)),cfg,now);
  assert.equal(many.tags.neg.recent.length,10);assert.equal(many.spc,0.5);
  const reversed=d.applyEvents(p,[event(2,{ok:0}),event(1)],cfg,now);
  assert.equal(reversed.tags.neg.streak,0);
});
test('scheduleReview ladder, deduplication, removal and input immutability',()=>{
  const start=[];let rev=d.scheduleReview(start,event(0,{ok:0,mode:'prac'}),cfg,now);
  assert.equal(start.length,0);assert.equal(rev[0].step,0);assert.equal(rev[0].dueAt,now+DAY);
  const snap=plain(rev);
  rev=d.scheduleReview(rev,event(0,{mode:'rev'}),cfg,now);
  assert.equal(rev[0].step,1);assert.equal(rev[0].dueAt,now+3*DAY);assert.equal(rev[0].qidSeen.length,1);
  rev=d.scheduleReview(rev,event(1,{ok:0,mode:'rev'}),cfg,now);
  assert.equal(rev[0].step,0);assert.equal(rev[0].dueAt,now+DAY);assert.equal(rev[0].qidSeen.length,2);
  const last=[{...rev[0],step:4}];assert.equal(d.scheduleReview(last,event(0,{mode:'rev'}),cfg,now).length,0);assert.equal(last.length,1);
  assert.equal(snap[0].step,0);
  assert.deepEqual(plain(d.scheduleReview([],event(1,{tags:'unk',ok:0}),cfg,now)),[]);
  const appended=d.scheduleReview(rev,event(2,{ok:0}),cfg,now+DAY);
  assert.equal(appended[0].dueAt,rev[0].dueAt);assert.equal(rev[0].qidSeen.length,2);
});
test('dueReviews orders due entries and returns at most three',()=>{
  const rs=[5,-1,-3,-2,1,-4].map((offset,i)=>({tag:'t'+i,dueAt:now+offset*DAY}));
  assert.deepEqual(plain(d.dueReviews(rs,now,cfg).map(x=>x.tag)),['t5','t2','t3']);
});
test('pickWeak ratios and descending weights',()=>{
  const p=weakProfile();p.tags.qnt={w:1};assert.equal(d.pickWeak(p,cfg).ratio,0.5);
  p.tags={neg:{w:0.3}};assert.equal(d.pickWeak(p,cfg).ratio,0.2);
  p.tags={};assert.equal(d.pickWeak(p,cfg).ratio,0);
  p.tags={neg:{w:0.3},qnt:{w:0.8}};assert.equal(d.pickWeak(p,cfg).tags[0].tag,'qnt');
});
test('composeRound quota, endpoints, max two weak, deterministic across twenty seeds',()=>{
  const p=weakProfile();p.tags.qnt={...p.tags.neg};
  for(let seed=0;seed<20;seed++){
    const opts={normal:questions('unk',20),weakPool:{neg:questions('neg',20),qnt:questions('qnt',20)},old:[{entry:{tag:'neg'},q:{id:'old',sk:['neg']}}],profile:p,cfg,n:12};
    const out=d.composeRound({...opts,rng:rng(seed)}),weak=out.filter(x=>x.kind!=='normal');
    assert.equal(out.length,12);assert.ok(weak.length>=5&&weak.length<=6);assert.equal(out[0].kind,'normal');assert.equal(out[11].kind,'normal');
    assert.equal(new Set(out.map(x=>x.q.id)).size,12);assert.equal(out.filter(x=>x.kind==='old').length,1);
    for(let i=2;i<out.length;i++)assert.ok(out.slice(i-2,i+1).some(x=>x.kind==='normal'));
    assert.deepEqual(plain(out),plain(d.composeRound({...opts,rng:rng(seed)})));
  }
});
test('composeRound difficulty valve, empty pools and duplicate avoidance',()=>{
  const p=weakProfile();p.tags.neg.ok=0;
  const opts={normal:questions('unk',20),weakPool:{neg:questions('neg',20)},old:[],profile:p,cfg,n:12,rng:rng(7)};
  const out=d.composeRound(opts);assert.equal(out.filter(x=>x.kind==='weak').length,2);
  assert.equal(d.composeRound({...opts,normal:[],weakPool:{},rng:rng(1)}).length,0);
  const q={id:'dup',sk:['neg']};
  const small=d.composeRound({...opts,normal:[q,q],weakPool:{neg:[q,q]},rng:rng(1)});
  assert.equal(small.length,1);
});
test('buildDiagForm builtin balance and no adjacent tag across twenty seeds',()=>{
  const pool=bank.map(q=>({q,src:'builtin',bankId:''}));
  for(let seed=0;seed<20;seed++){
    const form=d.buildDiagForm(pool,cfg,rng(seed));assert.equal(form.items.length,20);assert.equal(form.short.length,0);
    assert.equal(new Set(form.items.map(x=>x.q.id)).size,20);
    for(const tag of d.DIAG_TAG_IDS)assert.ok(form.items.filter(x=>d.primaryTag(x.q)===tag).length>=2);
    for(let i=1;i<form.items.length;i++)assert.notEqual(d.primaryTag(form.items[i-1].q),d.primaryTag(form.items[i].q));
  }
});
test('buildDiagForm prioritizes all three bank neg questions and reports shortages',()=>{
  const custom=questions('neg',3).map(q=>({q,src:'bank',bankId:'fake'}));
  const pool=bank.map(q=>({q,src:'builtin',bankId:''})).concat(custom);
  for(let seed=0;seed<20;seed++){
    const form=d.buildDiagForm(pool,cfg,rng(seed));
    for(const q of custom)assert.ok(form.items.some(x=>x.q.id===q.q.id&&x.bankId==='fake'));
  }
  const small=d.buildDiagForm([custom[0],custom[0],{q:{id:'unknown'},src:'bank'}],cfg,rng(1));
  assert.equal(small.items.length,1);assert.equal(small.short.length,7);
});
test('DIAG_BANK has 35 valid original questions, balanced tags, count answers and literal evidence',()=>{
  assert.equal(bank.length,35);assert.equal(new Set(bank.map(q=>q.id)).size,35);
  for(const tag of d.DIAG_TAG_IDS)assert.equal(bank.filter(q=>q.c===tag).length,5);
  for(const q of bank){
    assert.match(q.id,new RegExp('^d-'+q.c+'-[1-5]$'));assert.equal(q.src,'內建');assert.equal(q.lv,2);assert.equal(q.skc,1);assert.equal(q.sksrc,'rule');
    assert.ok(norm(q,new Set(d.DIAG_TAG_IDS)));assert.ok(q.q.length<=160&&q.why.length<=200);assert.ok(q.o.every(x=>x.length<=40));
    assert.equal(q.sk[0],q.c);
    if(q.c==='neg'||q.c==='qnt')assert.ok(d.ruleTags(q.q)[q.c]);
    if(q.c==='cnt'){assert.ok(q.items.length>=3&&q.items.length<=5);assert.equal(Number(q.a),q.items.filter(x=>x.yes).length);assert.ok(['數學','自然','社會'].includes(q.subj));}
    if(q.c==='evi'){assert.ok(q.ptext.includes(q.ev));assert.ok(q.ptext.split('。').filter(Boolean).length>=2);assert.ok(q.ptext.split('。').filter(Boolean).length<=4);assert.equal(q.subj,'國語');}
    if(['shp','prf'].includes(q.c))assert.equal(q.subj,'國語');
  }
});
test('normQ preserves only valid new fields and leaves legacy output identical',()=>{
  const q={c:'x',t:'mc',q:'測試題',o:['甲','乙'],a:'甲',why:'說明',lv:2,src:'原題'};
  const legacy={c:'x',q:'測試題',why:'說明',lv:2,src:'原題',ansByAI:false,icon:'',t:'mc',o:['甲','乙'],a:'甲'};
  assert.deepEqual(plain(norm(q)),legacy);
  const fields={sk:['neg','qnt'],skc:0,sksrc:'parent',items:[{t:'甲',yes:true},{t:'乙',yes:false}]};
  assert.deepEqual(plain(norm({...q,...fields})),{...legacy,...fields});
  for(const sk of [[],['bad'],['neg','qnt','cnt'],'neg'])assert.equal(norm({...q,sk}).sk,undefined);
  for(const skc of [-1,2,NaN,Infinity,'0.5'])assert.equal(norm({...q,skc}).skc,undefined);
  assert.equal(norm({...q,sksrc:'other'}).sksrc,undefined);
  for(const items of [[],[{t:'甲',yes:true}],[{t:'甲',yes:1},{t:'乙',yes:false}],[{t:'x'.repeat(41),yes:true},{t:'乙',yes:false}],Array(7).fill({t:'甲',yes:true})])assert.equal(norm({...q,items}).items,undefined);
  assert.ok(norm({...q,t:'tf',a:'O',...fields}).sk);
});
