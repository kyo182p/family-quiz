'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const {build}=require('../tools/build');
const {createGasEnv}=require('./fake-gas');
const fixture=require('./fixtures/diag-page.json');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fq-parent-'));
build({outDir:dir});
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const curriculum=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/curriculum/math.json'),'utf8'));
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))};
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5))}assert.ok(fn(),'timed out')}
const plain=x=>JSON.parse(JSON.stringify(x));
async function open(t,{consent=true,mode='',left=10}={}){
  let aiMode=mode,gate=null,offline=false,badImage=false,zeroSize=false,curriculumFailure=false;
  const env=createGasEnv({ai(request){
    const content=JSON.parse(request.payload).messages[0].content;
    const prompt=content.filter(x=>x.type==='text').map(x=>x.text).join('');
    const input=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));
    if(aiMode==='fail2'&&input.page===2)return {code:500,body:{}};
    const page=plain(fixture);page.items.forEach(x=>x.q_no=String((input.page-1)*4+Number(x.q_no)));
    if(aiMode==='zero')page.items=[];
    return {code:200,body:{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(page)}]}};
  }});
  env.run('setup');env.doPost({code:'TEST-0000',action:'playerList'});
  const setup=env.run('adminParent',{action:'adminIssueSetupCode',family:'TEST-0000'});
  const session=env.doPost({code:'TEST-0000',action:'parentSetPin',setupCode:setup.setupCode,pin:'1234'}).session;
  env.props.setProperty('DIAG_SHEET_ID','fake-sheet');env.run('setupDiag');
  const post=(action,data={})=>env.doPost({code:'TEST-0000',session,playerId:'p1',action,...data});
  if(consent)post('diag_consent',{agree:true});
  env.props.setProperty(env.run('countKey',env.run('findFamily','TEST-0000')),String(10-left));
  const errors=[],requests=[],revoked=[],created=[],canvases=[],fills=[],exports=[],vc=new VirtualConsole();
  vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e)});
  const dom=new JSDOM(html,{url:'https://quiz.invalid/#parent',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
    w.speechSynthesis={cancel(){},getVoices(){return []},speak(){},addEventListener(){}};
    w.URL.createObjectURL=()=>{const url='blob:fake-'+created.length;created.push(url);return url};
    w.URL.revokeObjectURL=url=>revoked.push(url);
    w.Image=function(){const img=w.document.createElement('img');Object.defineProperty(img,'naturalWidth',{get:()=>zeroSize?0:2400});Object.defineProperty(img,'naturalHeight',{get:()=>zeroSize?0:3200});Object.defineProperty(img,'src',{set(value){img.setAttribute('src',value);queueMicrotask(()=>badImage?img.onerror():img.onload())},get(){return img.getAttribute('src')}});return img};
    w.HTMLCanvasElement.prototype.getContext=function(){if(!canvases.includes(this))canvases.push(this);return {drawImage(){},globalAlpha:1,fillStyle:'',fillRect(...rect){fills.push({color:this.fillStyle,rect})}}};
    w.HTMLCanvasElement.prototype.setPointerCapture=function(){};
    w.HTMLCanvasElement.prototype.toBlob=function(cb,type,quality){exports.push({type,quality,w:this.width,h:this.height});cb(new w.Blob([new Uint8Array([255,216,255,218,0,2,255,217])],{type}))};
  }});
  const w=dom.window;t.after(()=>{w.close();assert.deepEqual(errors,[])});await settle();
  w.fetch=async(url,options={})=>{
    if(String(url)==='data/curriculum/math.json'){if(curriculumFailure)throw Error('missing');return {json:async()=>curriculum}}
    assert.equal(String(url),'mock://gas');const req=JSON.parse(options.body);requests.push(req);
    if(req.action==='diag_analyzeExam'){if(gate)await gate;if(offline)throw Error('offline')}
    return {json:async()=>env.doPost(req)};
  };
  w.parentSession=session;w.eval('PARENT_SESSION=parentSession');
  w.document.querySelectorAll('script').forEach(s=>s.remove());
  await w.parentMain('exam');
  const q=sel=>w.document.querySelector(sel);
  async function add(n=1){const input=q('#ex-files');Object.defineProperty(input,'files',{configurable:true,value:Array.from({length:n},(_,i)=>new w.File(['fake'],'page'+i+'.jpg',{type:'image/jpeg'}))});await input.onchange({target:input})}
  function change(sel,value){const el=q(sel);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}))}
  async function redact(n=1){await add(n);change('#ex-grade','1');q('#ex-next').click();assert.ok(q('#ex-send'))}
  async function send(){for(const c of w.document.querySelectorAll('#ex-checks input')){c.checked=true;c.dispatchEvent(new w.Event('change'))}q('#ex-send').click();await until(()=>!!w.eval('exJob')&&!w.eval('exJob.busy'));await settle()}
  return {w,env,post,q,add,change,redact,send,requests,revoked,created,canvases,fills,exports,ai:mode=>aiMode=mode,offline:()=>offline=true,badImage:()=>badImage=true,zeroSize:()=>zeroSize=true,curriculumFailure:()=>curriculumFailure=true,hold:()=>{let release;gate=new Promise(r=>release=r);return release}};
}

test('T036 A: disabled upload, decline text, explicit consent persists v2 in backend profiles',async t=>{
  const a=await open(t,{consent:false}),{w,q}=a;
  assert.equal(q('#ex-upload').disabled,true);assert.equal(q('#ex-consent').disabled,true);
  assert.equal(q('#ex-notice').textContent,w.eval('DIAG_NOTICE'));
  q('#ex-decline').click();assert.match(q('#ex-message').textContent,/孩子照常可以練習/);assert.equal(q('#ex-upload').disabled,true);
  q('#ex-agree').checked=true;q('#ex-agree').dispatchEvent(new w.Event('change'));assert.equal(q('#ex-consent').disabled,false);
  await q('#ex-consent').onclick();assert.equal(q('#ex-upload').disabled,false);
  assert.equal(a.post('diag_getProfile').consent.ver,2);
  const rows=a.env.sheets.get('profiles').data;assert.ok(JSON.stringify(rows).includes('consent'));
});

test('T036 B: exact image accept, 1/2/3 page quota updates, insufficient quota and removal',async t=>{
  const a=await open(t,{left:2}),{q}=a;assert.equal(q('#ex-files').getAttribute('accept'),'image/*');assert.equal(q('#ex-files').multiple,true);
  a.change('#ex-grade','1');
  for(let n=1;n<=3;n++){await a.add();assert.match(q('.quota').textContent,new RegExp('大約扣 '+n+' 次 AI · 今天還剩 2 次'))}
  assert.equal(q('#ex-next').disabled,true);assert.match(q('#ex-limit').textContent,/今天的次數不夠。可以先移除幾頁、只分析部分頁，或明天再分析。/);
  q('#ex-pages button').click();assert.match(q('.quota').textContent,/大約扣 2 次/);assert.equal(q('#ex-next').disabled,false);
});

test('T036 B/L: four-page limit, failed image and zero dimensions never join photos',async t=>{
  const a=await open(t);await a.add(5);assert.equal(a.w.eval('exPhotos.length'),4);assert.equal(a.q('#ex-message').textContent,'一次最多 4 頁。');
  const b=await open(t);b.badImage();await b.add();assert.equal(b.w.eval('exPhotos.length'),0);assert.equal(b.q('#ex-message').textContent,b.w.eval('EX_IMAGE_ERROR'));assert.equal(b.revoked.length,1);
  const c=await open(t);c.zeroSize();await c.add();assert.equal(c.w.eval('exPhotos.length'),0);assert.equal(c.q('#ex-next').disabled,true);
});

test('T036 C: top/undo/clear, normalized pointer boxes and all four checklist gates',async t=>{
  const a=await open(t),{w,q}=a;await a.redact();
  q('[data-ex-top]').click();assert.equal(w.eval('exPhotos[0].boxes.length'),1);assert.deepEqual(plain(w.eval('exPhotos[0].boxes[0]')),plain(w.eval('DIAG_TOP_BOX')));
  q('[data-ex-undo]').click();assert.equal(w.eval('exPhotos[0].boxes.length'),0);
  q('[data-ex-top]').click();q('[data-ex-top]').click();q('[data-ex-clear]').click();assert.equal(w.eval('exPhotos[0].boxes.length'),0);
  const c=q('canvas');c.getBoundingClientRect=()=>({left:0,top:0,width:100,height:200});
  c.onpointerdown({preventDefault(){},clientX:80,clientY:100,pointerId:1});c.onpointerup({clientX:20,clientY:20,pointerId:1});
  assert.deepEqual(plain(w.eval('exPhotos[0].boxes[0]')),{x:.2,y:.1,w:.6000000000000001,h:.4});
  const checks=[...w.document.querySelectorAll('#ex-checks input')];for(const c of checks.slice(0,3)){c.checked=true;c.dispatchEvent(new w.Event('change'))}assert.equal(q('#ex-send').disabled,true);
  checks[3].checked=true;checks[3].dispatchEvent(new w.Event('change'));assert.equal(q('#ex-send').disabled,false);
});

test('T036 C/D: JPEG export, pure black fill, cleanup and no image data in any storage',async t=>{
  const a=await open(t),{w,q}=a,input=q('#ex-files');await a.redact(2);q('[data-ex-top]').click();await a.send();assert.equal(input.value,'');
  assert.equal(a.exports.length,2);for(const e of a.exports)assert.deepEqual(e,{type:'image/jpeg',quality:.85,w:1200,h:1600});
  assert.ok(a.fills.some(f=>f.color==='#000'&&f.rect[2]===1200));
  assert.ok(a.canvases.every(c=>c.width===0&&c.height===0));assert.equal(w.eval('exPhotos.length'),0);assert.equal(w.eval('exInput'),null);assert.deepEqual(a.revoked,a.created);
  const req=a.requests.find(r=>r.action==='diag_analyzeExam');assert.equal(req.pages.length,2);assert.ok(req.codes.includes('N-1-1'));assert.deepEqual(req.codes,curriculum.filter(x=>x.grade<=1).map(x=>x.code));
  w.jpegBytes=[...Buffer.from(req.pages[0].b64,'base64')];assert.equal(w.eval('jpegHasExif(jpegBytes)'),false);
  for(const storage of [w.localStorage,w.sessionStorage])for(const key of Object.keys(storage))assert.doesNotMatch(storage.getItem(key),/data:image|\/9j\//);
  if(w.indexedDB?.databases)assert.deepEqual(await w.indexedDB.databases(),[]);else t.diagnostic('未測 IndexedDB：jsdom 無 IndexedDB；未測真實 RGB / EXIF：留給雲端瀏覽器。');
  assert.match(q('#ex-progress').textContent,/第 1 頁：完成/);assert.match(q('#ex-progress').textContent,/共讀到 8 題/);
  q('[data-ex-review]').click();assert.equal(q('#ex-message').textContent,'下一步畫面準備中');
  w.viewExamReview=id=>w.reviewed=id;q('[data-ex-review]').click();assert.equal(w.reviewed,req.examId||w.eval('exJob.examId'));
});

test('T036 D: page 2 failure refunds quota, retry sends only that page under same examId and clears memory',async t=>{
  const a=await open(t,{mode:'fail2'}),{w,q}=a;await a.redact(2);await a.send();
  assert.equal(a.post('diag_quota').left,9);assert.match(q('#ex-progress').textContent,/第 2 頁沒有讀到。這頁不扣次數。/);assert.equal(q('[data-ex-retry]').textContent,'重送第 2 頁');
  assert.equal(w.eval('exJob.pages[0].b64'),undefined);assert.equal(typeof w.eval('exJob.pages[1].b64'),'string');
  const id=w.eval('exJob.examId');a.ai('');q('[data-ex-retry]').click();await until(()=>!w.eval('exJob.busy'));await settle();
  const req=a.requests.filter(r=>r.action==='diag_analyzeExam').at(-1);assert.equal(req.examId,id);assert.equal(req.pages.length,1);assert.equal(req.pages[0].n,2);assert.equal(a.post('diag_quota').left,8);assert.equal(w.eval('exJob.pages[1].b64'),undefined);assert.match(q('#ex-progress').textContent,/第 2 頁：完成，讀到 4 題/);
});

test('T036 D/L: abandoning failed page clears its JPEG; zero items refunds and offers retake text',async t=>{
  const a=await open(t,{mode:'fail2'});await a.redact(2);await a.send();a.q('[data-ex-abandon]').click();assert.equal(a.w.eval('exJob.pages[1].b64'),undefined);assert.equal(a.q('[data-ex-retry]'),null);
  const b=await open(t,{mode:'zero'});await b.redact();await b.send();assert.equal(b.post('diag_quota').left,10);assert.match(b.q('#ex-progress').textContent,/第 1 頁沒有讀到題目，沒有扣次數。可以重拍這頁再送。/);assert.equal(b.w.eval('exJob.pages[0].b64'),undefined);
});

test('T036 D/L: network failure clears JPEG; curriculum failure and other subjects send empty whitelist',async t=>{
  const a=await open(t);a.curriculumFailure();await a.redact();a.offline();await a.send();assert.match(a.q('#ex-progress').textContent,/送不出去，照片沒有存下來。請確認網路後再試一次。/);assert.equal(a.w.eval('exJob.pages[0].b64'),undefined);assert.deepEqual(a.requests.find(r=>r.action==='diag_analyzeExam').codes,[]);
  const b=await open(t);await b.add();b.change('#ex-grade','1');b.q('[value="zh"]').checked=true;b.q('#ex-next').click();await b.send();assert.deepEqual(b.requests.find(r=>r.action==='diag_analyzeExam').codes,[]);
});

test('T036 lifecycle: pagehide zeroes canvas and file input, revokes URLs; lock drops failed JPEG',async t=>{
  const a=await open(t),{w,q}=a;const input=q('#ex-files');await a.redact();w.dispatchEvent(new w.Event('pagehide'));assert.ok(a.canvases.every(c=>c.width===0&&c.height===0));assert.equal(input.value,'');assert.equal(w.eval('exPhotos.length'),0);assert.deepEqual(a.revoked,a.created);
  const b=await open(t,{mode:'fail2'});await b.redact(2);await b.send();b.w.savedJob=b.w.eval('exJob');b.w.parentLock();assert.equal(b.w.eval('exJob'),null);assert.equal(b.w.savedJob.pages[1].b64,undefined);
  const c=await open(t,{mode:'fail2'});await c.redact(2);await c.send();c.w.savedJob=c.w.eval('exJob');c.w.dispatchEvent(new c.w.Event('pagehide'));assert.equal(c.w.savedJob.pages[1].b64,undefined);assert.equal(c.w.eval('exJob'),null);
  const d=await open(t);const adding=d.add();d.w.dispatchEvent(new d.w.Event('pagehide'));await adding;assert.equal(d.w.eval('exPhotos.length'),0);assert.ok(d.created.every(url=>d.revoked.includes(url)));
});

test('T036 D: switch tabs during request, return before completion and refresh results plus history',async t=>{
  const a=await open(t),{w,q}=a;await a.redact(2);const release=a.hold();
  for(const c of w.document.querySelectorAll('#ex-checks input')){c.checked=true;c.dispatchEvent(new w.Event('change'))}q('#ex-send').click();await until(()=>a.requests.some(r=>r.action==='diag_analyzeExam'));
  await w.parentMain('players');await w.parentMain('exam');assert.match(q('#ex-progress').textContent,/分析中/);release();await until(()=>!w.eval('exJob.busy'));await settle();assert.match(q('#ex-progress').textContent,/第 2 頁：完成/);assert.ok(q('[data-ex-review]'));
});

test('T036 scope: immutable shared blocks and prohibited image APIs absent from new code',()=>{
  const front=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),back=fs.readFileSync(path.join(__dirname,'../Code.gs'),'utf8');
  const block=s=>s.slice(s.indexOf('// ==DIAG-SHARED-BEGIN=='),s.indexOf('// ==DIAG-SHARED-END==')+'// ==DIAG-SHARED-END=='.length);assert.equal(block(front),block(back));
  assert.doesNotMatch(front,/createImageBitmap/);assert.doesNotMatch(front.slice(front.indexOf("// 家長考卷分析：")),/accept="[^"]*heic/);
});
