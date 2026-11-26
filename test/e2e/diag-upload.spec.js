/* Cloud only; run with npm run e2e (see reward.spec.js for setup).
 * Exam pages are drawn here by code: fictional text only, never a real exam photo.
 * FQ_SHOT_DIR, when set, saves the form / confirm / zoomed-fix screenshots there.
 */
'use strict';

(function register() {
  try { require.resolve('@playwright/test'); } catch { return; }
  if (process.env.NODE_TEST_CONTEXT) return;
  const base = process.env.FQ_BASE;
  if (!base) throw new Error('FQ_BASE is missing: run this suite with npm run e2e');
  const {test,expect} = require('@playwright/test');
  const path = require('node:path');
  const shots = process.env.FQ_SHOT_DIR;
  const pin = '246810'; // Deliberately fake, used only by the local mock.

  test.use({browserName:'chromium',viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  test.beforeEach(async ({page}) => {
    page.__errors = [];
    page.on('pageerror',error=>page.__errors.push(error.message));
    await page.route(/^https?:\/\//,route=>new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    await page.addInitScript(()=>{
      localStorage.setItem('tour-done',JSON.stringify(Object.fromEntries(
        ['lib','plant','mine','bank','upload','review','libBank','practice','feedback','analysis'].map(key=>[key,true])
      )));
    });
  });
  test.afterEach(async ({page}) => { expect(page.__errors).toEqual([]); });

  // A fictional 1200x1600 exam page with no near-black pixels, as PNG bytes.
  async function fakeExam(page,n) {
    const b64 = await page.evaluate(n=>{
      const c=document.createElement('canvas');c.width=1200;c.height=1600;const x=c.getContext('2d');
      x.fillStyle='#fbf7ec';x.fillRect(0,0,1200,1600);
      x.fillStyle='#2a4d8f';x.font='bold 56px sans-serif';x.fillText('虛構練習卷 第 '+n+' 頁',80,110);
      x.font='40px sans-serif';x.fillText('姓名：示範用　座號：00　分數：--',80,200);
      x.strokeStyle='#8aa0c8';x.lineWidth=4;
      for(let i=0;i<8;i++){const y=320+i*150;x.fillStyle='#3d5a99';x.fillText((i+1)+'. '+(i+2)+' + '+(i*3+1)+' = ______',80,y);x.beginPath();x.moveTo(80,y+40);x.lineTo(1120,y+40);x.stroke();}
      x.fillStyle='#d9534f';x.font='bold 64px sans-serif';x.fillText('○',900,320);
      return c.toDataURL('image/png').split(',')[1];
    },n);
    return {name:'fake-'+n+'.png',mimeType:'image/png',buffer:Buffer.from(b64,'base64')};
  }

  async function openExam(page) {
    await page.goto(base+'#parent');
    await expect(page.locator('#parent-setup')).toBeVisible();
    await page.locator('#parent-code').fill('MOCK2345');
    await page.locator('#parent-new-pin').fill(pin);
    await page.locator('#parent-repeat-pin').fill(pin);
    await page.locator('#parent-setup button').click();
    await page.locator('[data-parent-tab="exam"]').click();
    await page.locator('#ex-agree').check();
    await page.locator('#ex-consent').click();
    await expect(page.locator('#ex-form')).toBeVisible();
    await page.evaluate(()=>{
      const next=window.fetch;window.__sent=[];
      window.fetch=async(url,options)=>{
        if(String(url)==='mock://gas'){const body=JSON.parse(options.body);if(body.action==='diag_analyzeExam')window.__sent.push(...body.pages)}
        return next(url,options);
      };
    });
  }
  async function toConfirm(page,n=1) {
    const files=[];for(let i=1;i<=n;i++)files.push(await fakeExam(page,i));
    await page.locator('#ex-files').setInputFiles(files);
    await expect(page.locator('#ex-pages img')).toHaveCount(n);
    await page.locator('#ex-grade').selectOption('1');
    await expect(page.locator('#ex-next')).toHaveText('下一步：確認');
    await page.locator('#ex-next').click();
    await expect(page.locator('#ex-body h3')).toHaveText('這些都遮好了嗎？');
  }
  async function checkAll(page) { for (const box of await page.locator('#ex-checks input').all()) await box.check(); }
  async function sendAndWait(page,n) {
    await page.locator('#ex-send').click();
    await expect.poll(()=>page.evaluate(()=>window.__sent.length)).toBe(n);
    await expect(page.locator('#ex-progress')).toContainText('完成');
  }

  // Decode a sent JPEG in the page; compare with the original fake page or find black runs.
  function decode(page,index,script,arg) {
    return page.evaluate(async ({index,script,arg})=>{
      const load=src=>new Promise((ok,bad)=>{const img=new Image();img.onload=()=>ok(img);img.onerror=bad;img.src=src});
      const pixels=img=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return {w:c.width,h:c.height,d:x.getImageData(0,0,c.width,c.height).data}};
      const sent=pixels(await load('data:image/jpeg;base64,'+window.__sent[index].b64));
      return new Function('sent','arg','pixels','load','return ('+script+')(sent,arg,pixels,load)')(sent,arg,pixels,load);
    },{index,script,arg});
  }
  const blackBounds = `(s,{x,y})=>{
    const dark=(px,py)=>{const i=(py*s.w+px)*4;return s.d[i]<40&&s.d[i+1]<40&&s.d[i+2]<40};
    if(!dark(x,y))return null;
    let l=x,r=x,t=y,b=y;while(l>0&&dark(l-1,y))l--;while(r<s.w-1&&dark(r+1,y))r++;while(t>0&&dark(x,t-1))t--;while(b<s.h-1&&dark(x,b+1))b++;
    let count=0;for(let i=0;i<s.d.length;i+=4)if(s.d[i]<40&&s.d[i+1]<40&&s.d[i+2]<40)count++;
    return {x:l,y:t,w:r-l+1,h:b-t+1,w0:s.w,h0:s.h,count};
  }`;

  async function touch(page,cdp,type,points) {
    await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y],id)=>({x,y,id}))});
  }
  async function drag(page,cdp,[x1,y1],[x2,y2]) {
    await touch(page,cdp,'touchStart',[[x1,y1]]);
    for (let i=1;i<=8;i++) await touch(page,cdp,'touchMove',[[x1+(x2-x1)*i/8,y1+(y2-y1)*i/8]]);
    await touch(page,cdp,'touchEnd',[]);
  }
  async function pinch(page,cdp,[cx,cy],from,to) {
    await touch(page,cdp,'touchStart',[[cx-from,cy],[cx+from,cy]]);
    for (let i=1;i<=10;i++){const d=from+(to-from)*i/10;await touch(page,cdp,'touchMove',[[cx-d,cy],[cx+d,cy]]);}
    await touch(page,cdp,'touchEnd',[]);
  }
  // Client point for a pixel of the 1200x1600 original, from the canvas' transformed rect.
  async function client(page,[px,py]) {
    const r = await page.locator('.redwrap canvas').evaluate(c=>{const b=c.getBoundingClientRect();return {l:b.left,t:b.top,w:b.width,h:b.height}});
    return [r.l+px/1200*r.w,r.t+py/1600*r.h];
  }
  // Centre the drawing area so neither the sticky parent bar nor the bottom label covers it.
  async function centre(page) {
    await page.locator('.redwrap').evaluate(el=>el.scrollIntoView({block:'center'}));
  }
  async function scale(page) {
    return page.evaluate(()=>{const c=document.querySelector('.redwrap canvas'),w=document.querySelector('.redwrap');return c.getBoundingClientRect().width/w.clientWidth});
  }

  test('R3 gate: send is disabled until all four checks are ticked',async ({page})=>{
    await openExam(page);await toConfirm(page);
    const boxes=await page.locator('#ex-checks input').all();
    expect(boxes.length).toBe(4);
    for (const box of boxes.slice(0,3)) { await box.check(); await expect(page.locator('#ex-send')).toBeDisabled(); }
    await boxes[3].check();await expect(page.locator('#ex-send')).toBeEnabled();
    await boxes[1].uncheck();await expect(page.locator('#ex-send')).toBeDisabled();
  });

  test('R3 no redaction: backend receives the original page',async ({page})=>{
    await openExam(page);await toConfirm(page);await checkAll(page);await sendAndWait(page,1);
    const diff = await decode(page,0,`async (s,arg,pixels,load)=>{
      const o=pixels(await load(arg));let sum=0,big=0;
      for(let i=0;i<s.d.length;i+=4){const d=Math.abs(s.d[i]-o.d[i])+Math.abs(s.d[i+1]-o.d[i+1])+Math.abs(s.d[i+2]-o.d[i+2]);sum+=d/3;if(d/3>64)big++}
      let dark=0;for(let i=0;i<s.d.length;i+=4)if(s.d[i]<40&&s.d[i+1]<40&&s.d[i+2]<40)dark++;
      return {w:s.w,h:s.h,ow:o.w,oh:o.h,mean:sum/(s.w*s.h),big,dark};
    }`,'data:image/png;base64,'+(await fakeExam(page,1)).buffer.toString('base64'));
    expect({w:diff.w,h:diff.h}).toEqual({w:diff.ow,h:diff.oh});
    expect(diff.mean).toBeLessThan(3);
    expect(diff.big/(diff.w*diff.h)).toBeLessThan(0.002);
    expect(diff.dark).toBe(0);
  });

  test('R3 fix: pinch zoom >= 4x, box drawn at 2x maps back to the original like a 1x box',async ({page})=>{
    await openExam(page);await toConfirm(page,2);
    const cdp=await page.context().newCDPSession(page);
    const target={x:300,y:420,w:240,h:120};
    const steps=[];

    // Page 1: zoom to 2x around a point, then draw.
    await page.locator('[data-ex-fix]').nth(0).click();
    await centre(page);
    const wrap=await page.locator('.redwrap').boundingBox();
    const scrollBefore=await page.evaluate(()=>scrollY);
    await pinch(page,cdp,[wrap.x+wrap.width*0.4,wrap.y+wrap.height*0.3],30,60);
    const s2=await scale(page);expect(Math.abs(s2-2)).toBeLessThan(0.02);
    await drag(page,cdp,await client(page,[target.x,target.y]),await client(page,[target.x+target.w,target.y+target.h]));
    steps.push(await page.evaluate(()=>exPhotos[0].boxes.map(b=>({...b}))));
    expect(await page.evaluate(()=>scrollY)).toBe(scrollBefore);
    expect(await page.evaluate(()=>visualViewport.scale)).toBe(1);
    // Then zoom further to prove the 4x requirement, and take the zoomed screenshot.
    await pinch(page,cdp,[wrap.x+wrap.width*0.5,wrap.y+wrap.height*0.4],20,80);
    expect(await scale(page)).toBeGreaterThanOrEqual(4);
    expect(await page.evaluate(()=>visualViewport.scale)).toBe(1);
    if (shots) await page.screenshot({path:path.join(shots,'3-fix-zoomed.png')});
    await page.locator('[data-ex-done]').click();
    await expect(page.locator('.ex-thumb p').nth(0)).toContainText('已塗黑 1 處');

    // Page 2: the same box at 1x.
    await page.locator('[data-ex-fix]').nth(1).click();
    await centre(page);
    expect(await scale(page)).toBe(1);
    await drag(page,cdp,await client(page,[target.x,target.y]),await client(page,[target.x+target.w,target.y+target.h]));
    steps.push(await page.evaluate(()=>exPhotos[1].boxes.map(b=>({...b}))));
    await page.locator('[data-ex-done]').click();
    if (shots) {
      await page.evaluate(()=>{document.querySelector('#ex-body h3').scrollIntoView({block:'start'});scrollBy(0,-150)});
      await page.screenshot({path:path.join(shots,'2-confirm.png')});
    }

    expect(steps[0].length).toBe(1);expect(steps[1].length).toBe(1);
    await checkAll(page);await sendAndWait(page,2);
    const mid={x:target.x+target.w/2,y:target.y+target.h/2};
    const zoomed=await decode(page,0,blackBounds,mid),plain=await decode(page,1,blackBounds,mid);
    for (const found of [zoomed,plain]) {
      expect(found,'black box present').not.toBeNull();
      expect({w:found.w0,h:found.h0}).toEqual({w:1200,h:1600});
      for (const k of ['x','y','w','h']) expect(Math.abs(found[k]-target[k]),k+' '+JSON.stringify(found)).toBeLessThanOrEqual(2);
    }
    for (const k of ['x','y','w','h']) expect(Math.abs(zoomed[k]-plain[k])).toBeLessThanOrEqual(2);
  });

  test('R3 fix screen: touch targets are at least 44px and the page does not scroll while drawing',async ({page})=>{
    await openExam(page);await toConfirm(page);
    for (const el of await page.locator('[data-ex-fix], #ex-send').all()) { const b=await el.boundingBox(); expect(b.height).toBeGreaterThanOrEqual(44); }
    await page.locator('[data-ex-fix]').click();
    for (const el of await page.locator('.ex-tools button, [data-ex-done]').all()) {
      const b=await el.boundingBox();expect(Math.min(b.width,b.height)).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('[data-ex-undo]')).toHaveText('復原上一個');
    const cdp=await page.context().newCDPSession(page);
    await centre(page);
    const wrap=await page.locator('.redwrap').boundingBox();
    const before=await page.evaluate(()=>scrollY);
    // A vertical drag that would scroll the page if touches were not captured.
    await drag(page,cdp,[wrap.x+40,wrap.y+wrap.height-40],[wrap.x+200,wrap.y+40]);
    expect(await page.evaluate(()=>scrollY)).toBe(before);
    expect(await page.evaluate(()=>exPhotos[0].boxes.length)).toBe(1);
    await page.locator('[data-ex-undo]').click();
    expect(await page.evaluate(()=>exPhotos[0].boxes.length)).toBe(0);
  });

  for (const viewport of [{width:390,height:844},{width:375,height:667}]) {
    test(`R3 form ${viewport.width}x${viewport.height}: no horizontal scroll, date field inside the card`,async ({page})=>{
      await page.setViewportSize(viewport);
      await openExam(page);
      await page.locator('#ex-files').setInputFiles([await fakeExam(page,1)]);
      await expect(page.locator('#ex-pages img')).toHaveCount(1);
      await page.locator('#ex-grade').selectOption('1');
      await expect(page.locator('.ex-tip')).toHaveText('拍照前，先用便利貼或手指遮住姓名、座號、學校、班級、分數、老師評語和家長簽名。');
      const g = await page.evaluate(()=>{
        const rect=el=>el.getBoundingClientRect(),card=rect(document.querySelector('#ex-panel')),date=rect(document.querySelector('#ex-date')),grade=rect(document.querySelector('#ex-grade'));
        return {scroll:document.documentElement.scrollWidth,inner:innerWidth,cardRight:card.right,cardLeft:card.left,dateRight:date.right,dateLeft:date.left,dateWidth:date.width,gradeWidth:grade.width,gradeLeft:grade.left};
      });
      expect(g.scroll,JSON.stringify(g)).toBeLessThanOrEqual(g.inner);
      expect(g.dateRight,JSON.stringify(g)).toBeLessThanOrEqual(g.cardRight);
      expect(g.dateLeft).toBeGreaterThanOrEqual(g.cardLeft);
      expect(Math.abs(g.dateWidth-g.gradeWidth),JSON.stringify(g)).toBeLessThanOrEqual(1);
      expect(Math.abs(g.dateLeft-g.gradeLeft)).toBeLessThanOrEqual(1);
      if (shots && viewport.width===390) {
        await page.evaluate(()=>{document.querySelector('.ex-tip').scrollIntoView({block:'start'});scrollBy(0,-150)});
        await page.screenshot({path:path.join(shots,'1-form.png')});
        await page.evaluate(()=>document.querySelector('#ex-date').scrollIntoView({block:'center'}));
        await page.screenshot({path:path.join(shots,'1b-form-date.png')});
      }
    });
  }
})();
