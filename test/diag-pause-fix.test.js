'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const {build}=require('../tools/build');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const css=[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x=>x[1]).join('\n');
const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(x=>({selector:x[1].trim(),body:x[2]}));
const rule=selector=>{const found=rules.filter(x=>x.selector===selector);assert.equal(found.length,1,selector);return found[0].body};

test('T044 CSS: pause button uses intrinsic width and a 44px touch target',()=>{
  const body=rule('#diag-view .toprow button');
  for(const text of ['flex:0 0 auto','width:auto','min-width:44px','min-height:44px'])assert.ok(body.split(';').includes(text),text);
  assert.equal(rule('#diag-view .toprow'),'flex-wrap:nowrap;gap:8px');
});

test('T044 CSS: only challenge options use full width within diag-view',()=>{
  const fullWidth=rules.filter(x=>x.selector.includes('#diag-view')&&/(?:^|;)\s*width\s*:\s*100%\s*(?:;|$)/.test(x.body));
  assert.deepEqual(fullWidth.map(x=>x.selector),['#diag-view .opt']);
});

test('T044 CSS: challenge title can shrink and truncate without wrapping',()=>{
  const body=rule('#diag-view h1');
  for(const text of ['font-size:clamp(1.3rem,6vw,1.8rem)','white-space:nowrap','min-width:0','overflow:hidden','text-overflow:ellipsis'])assert.ok(body.split(';').includes(text),text);
});

test('T044 CSS: option touch targets and question typography remain unchanged',()=>{
  const body=rule('#diag-view .opt');
  for(const text of ['width:100%','min-height:56px','font-size:max(20px,1.15em)'])assert.ok(body.split(';').includes(text),text);
  assert.equal(rule('#diag-view .q,#diag-view .passage'),'font-size:max(22px,1.25em)');
});

test('T044 child challenge: pause button returns home',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fq-pause-fix-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));build({outDir:dir});
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e)});
  const dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8'),{
    url:'https://quiz.invalid/',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
      w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
      w.speechSynthesis={cancel(){},getVoices(){return []},speak(){},addEventListener(){}};
    }
  });
  const w=dom.window;t.after(()=>{w.close();assert.deepEqual(errors,[])});
  const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))};
  await settle();
  const items=require('./fixtures/diag-check.json').filter(x=>x.weakKey==='code:N-1-1');
  w.viewCheck({checkId:'pause-check',subject:'math',items},'p1');
  assert.ok(w.document.querySelector('#diag-view .q'));
  const pause=w.document.querySelector('#diag-view #diag-pause');assert.ok(pause);assert.equal(pause.textContent,'暫停');
  pause.click();await settle();
  assert.equal(w.document.querySelector('#diag-view'),null);
  assert.match(w.document.querySelector('#app').textContent,/題庫書架/);
});
