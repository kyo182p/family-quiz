/* Cloud only; run from the repository root:
 * npm run build
 * npm i --no-save @playwright/test
 * npx playwright install chromium
 * npx playwright test test/e2e/reward.spec.js
 * Opens dist/index.html via file://; FQ_DIST can point to another built HTML file.
 * G3 is manual in cloud: npx lighthouse <網址> --form-factor=mobile --only-categories=performance
 * Use a cloud-hosted mock build for Lighthouse; target performance score >= 80.
 * Serve with gzip (GitHub Pages does); an uncompressed static server under-reports.
 */
'use strict';

(function register() {
  try { require.resolve('@playwright/test'); } catch { return; }
  // node --test also discovers this file, even when Playwright is installed.
  if (process.env.NODE_TEST_CONTEXT) return;
  const {test,expect} = require('@playwright/test');
  const {readFileSync} = require('node:fs');
  const {resolve} = require('node:path');
  const {pathToFileURL} = require('node:url');
  const dist = resolve(process.env.FQ_DIST || 'dist/index.html');
  const html = readFileSync(dist,'utf8');
  if (!html.includes("const CONFIG={API_URL:'mock://gas'};") || html.includes('script.google.com')) {
    throw new Error('FQ_DIST must be a mock build produced by npm run build');
  }
  const base = pathToFileURL(dist).href;
  const pin = '246810'; // Deliberately fake, used only by the local mock.
  const api = (page,action,data={}) => page.evaluate(async ({action,data}) => {
    const result = await window.api(action,data);
    if (!result.ok) throw new Error(action+': '+result.code);
    return result;
  },{action,data});

  test.use({browserName:'chromium',viewport:{width:390,height:844}});
  test.beforeEach(async ({page}) => {
    page.__errors = [];
    page.on('pageerror',error=>page.__errors.push(error.message));
    // All service traffic is forbidden. The build's mock://gas adapter is in-page.
    await page.route(/^https?:\/\//,route=>route.abort());
    await page.addInitScript(()=>{
      localStorage.setItem('tour-done',JSON.stringify(Object.fromEntries(
        ['lib','plant','mine','bank','upload','review','libBank','practice','feedback','analysis'].map(key=>[key,true])
      )));
    });
    await page.goto(base);
    await expect(page.locator('#rewards-home')).toBeVisible();
  });
  test.afterEach(async ({page}) => { expect(page.__errors).toEqual([]); });

  async function parent(page) {
    await page.goto(base+'#parent');
    await expect(page.locator('#parent-page')).toBeVisible();
    await expect(page.locator('#parent-setup, .parent-pad, [data-parent-tab="pending"]')).toBeVisible();
    if (await page.locator('#parent-setup').count()) {
      await page.locator('#parent-code').fill('MOCK2345');
      await page.locator('#parent-new-pin').fill(pin);
      await page.locator('#parent-repeat-pin').fill(pin);
      await page.locator('#parent-setup button').click();
    } else if (await page.locator('.parent-pad').count()) {
      for (const digit of pin) await page.locator(`[data-pin-key="${digit}"]`).click();
    }
    await expect(page.locator('[data-parent-tab="pending"]')).toBeVisible();
    await expect(page.locator('.reward-skeleton')).toHaveCount(0);
    return page.evaluate(()=>PARENT_SESSION);
  }
  test('A3 overlay: player sheet closes before parent PIN entry',async ({page})=>{
    await parent(page);
    await page.goto(base);
    await page.locator('#player-button').click();
    await expect(page.locator('#player-sheet')).toBeVisible();
    await page.evaluate(()=>{location.hash='parent'});
    await expect(page.locator('#player-sheet')).toHaveCount(0);
    for (const digit of pin) await page.locator(`[data-pin-key="${digit}"]`).click();
    await expect(page.locator('[data-parent-tab="pending"]')).toBeVisible();
  });

  async function tab(page,name) {
    await page.locator(`[data-parent-tab="${name}"]`).click();
    await expect(page.locator('.reward-skeleton')).toHaveCount(0);
  }
  async function child(page,mine=false) {
    await page.goto(base);
    await page.locator('#rewards-home').click();
    if (mine) await page.locator('[data-reward-tab="mine"]').click();
    await expect(page.locator('.reward-skeleton')).toHaveCount(0);
  }
  async function apply(page,id) {
    await page.locator(`[data-apply="${id}"]`).click();
    await page.locator('#reward-send').click();
    await expect(page.locator('.reward-dialog')).toHaveCount(0);
    await expect(page.locator('#reward-notice')).toContainText('已送出');
  }
  async function reward(page,session,values) {
    return (await api(page,'rewardSave',{session,reward:{name:'雲端測試',silver:1,gold:0,weeklyLimit:0,enabled:true,...values}})).reward.id;
  }
  async function geometry(page,label) {
    const result = await page.evaluate(()=>({
      overflow:document.documentElement.scrollWidth > innerWidth,
      small:[...document.querySelectorAll('button,input')].filter(el=>{
        const r=el.getBoundingClientRect(),s=getComputedStyle(el);
        return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none';
      }).filter(el=>{const r=el.getBoundingClientRect();return r.width<44 || r.height<44;})
        .map(el=>({id:el.id,text:el.textContent,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))
    }));
    expect(result,label).toEqual({overflow:false,small:[]});
  }

  for (const viewport of [{width:390,height:844},{width:375,height:667}]) {
    test(`G1 ${viewport.width}x${viewport.height}: all main screens and touch targets`,async ({page})=>{
      await page.setViewportSize(viewport);
      await geometry(page,'首頁');
      await child(page); await geometry(page,'獎勵');
      await page.locator('[data-reward-tab="mine"]').click();
      await expect(page.locator('.reward-skeleton')).toHaveCount(0);
      await geometry(page,'我的申請');
      await parent(page);
      await page.locator('#parent-lock').click();
      await expect(page.locator('.parent-pad')).toBeVisible();
      await geometry(page,'家長 PIN');
      await parent(page);
      for (const name of ['pending','rewards','players','log']) {
        await tab(page,name); await geometry(page,'家長 '+name);
      }
    });
  }

  test('A2: add, rename, choose icon and switch isolated players',async ({page})=>{
    await page.locator('#player-button').click();
    await page.locator('#player-name').fill('測試玩家');
    await page.locator('[data-player-icon="🐢"]').click();
    await page.locator('#player-submit').click();
    const row=page.locator('.player-row').filter({hasText:'測試玩家'});
    await expect(row).toContainText('銀 0・金 0');
    await row.locator('[data-edit-player]').click();
    await page.locator('#player-name').fill('改名玩家');
    await page.locator('#player-submit').click();
    const renamed=page.locator('.player-row').filter({hasText:'改名玩家'});
    await expect(renamed).toContainText('🐢');
    await renamed.locator('[data-player]').click();
    await expect(page.locator('#player-button')).toContainText('🐢');
    await page.locator('#player-button').click();
    await expect(page.locator('[data-player="p1"]')).toContainText('銀 5・金 2');
    await page.locator('[data-player="p1"]').click();
    await expect(page.locator('#player-button')).toContainText('🌱');
  });

  test('A3: disable cancels pending, hides player from menu, restore; p1 protected',async ({page})=>{
    const session=await parent(page);
    const id=await reward(page,session,{name:'一枚獎',silver:1});
    await api(page,'redeemRequest',{playerId:'p2',rewardId:id,requestId:'a3-valid'});
    await tab(page,'players');
    await expect(page.locator('[data-manage-player="p1"] [data-player-action]')).toHaveCount(0);
    await page.locator('[data-manage-player="p2"] [data-player-action="playerDisable"]').click();
    await page.getByRole('button',{name:'確定停用',exact:true}).click();
    await expect(page.locator('[data-manage-player="p2"]')).toContainText('停用');
    expect((await api(page,'myRedeems',{playerId:'p2'})).redeems[0].status).toBe('取消');
    await page.goto(base); await page.locator('#player-button').click();
    await expect(page.locator('[data-player="p2"]')).toHaveCount(0);
    await parent(page); await tab(page,'players');
    await page.locator('[data-player-action="playerRestore"]').click();
    await expect(page.locator('[data-manage-player="p2"]')).toContainText('啟用');
  });

  test('B5: background locks and removes protected content and memory session',async ({page})=>{
    const session=await parent(page); await tab(page,'players');
    expect(await page.evaluate(token=>JSON.stringify({...localStorage,...sessionStorage}).includes(token),session)).toBe(false);
    await page.evaluate(()=>{
      Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('.parent-pad')).toBeVisible();
    await expect(page.locator('[data-manage-player]')).toHaveCount(0);
    expect(await page.evaluate(()=>PARENT_SESSION)).toBe(null);
  });

  test('C1: add, edit and disable reward in parent UI updates child list',async ({page})=>{
    await parent(page); await tab(page,'rewards');
    await page.locator('#parent-add-reward').click();
    await page.locator('#parent-reward-name').fill('新增獎項');
    await page.locator('[data-step="silver"][data-delta="1"]').click();
    await page.locator('#parent-save-reward').click();
    await expect(page.locator('#parent-list')).toContainText('新增獎項');
    await child(page); await expect(page.locator('#reward-list')).toContainText('新增獎項');
    await parent(page); await tab(page,'rewards');
    await page.locator('article').filter({hasText:'新增獎項'}).locator('[data-edit-reward]').click();
    await page.locator('#parent-reward-name').fill('修改獎項');
    await page.locator('#parent-enabled').click(); await page.locator('#parent-save-reward').click();
    await expect(page.locator('.parent-off')).toContainText('修改獎項');
    await child(page); await expect(page.locator('#reward-list')).not.toContainText('修改獎項');
  });

  test('D1: prices, wallet, shortage and weekly quota disable apply',async ({page})=>{
    const session=await parent(page);
    const costly=await reward(page,session,{gold:3,silver:0,name:'金不足'});
    const once=await reward(page,session,{name:'每週一次',weeklyLimit:1});
    await child(page);
    await expect(page.locator('#reward-wallet')).toContainText('可用5');
    await expect(page.locator(`[data-apply="${costly}"]`).locator('..')).toContainText('還差金 1');
    await expect(page.locator(`[data-apply="${costly}"]`)).toBeDisabled();
    await apply(page,once);
    await expect(page.locator('#reward-list')).toContainText('下週一再來');
    await expect(page.locator(`[data-apply="${once}"]`)).toBeDisabled();
  });

  test('D2 D9: reserve actual silver/gold, edit price, cancel returns original amounts',async ({page})=>{
    const session=await parent(page);
    const id=await reward(page,session,{silver:6,goldForSilver:true,name:'金抵銀'});
    await child(page); await page.locator(`[data-apply="${id}"]`).click();
    await expect(page.locator('.reward-sheet')).toContainText('會先保留 銀 5・金 1');
    await page.locator('#reward-send').click();
    await expect(page.locator('#reward-wallet')).toContainText('保留 5');
    await expect(page.locator('#reward-wallet')).toContainText('保留 1');
    const token=await parent(page); await reward(page,token,{id,silver:1,gold:0,name:'金抵銀'});
    await child(page,true); await expect(page.locator('#reward-list')).toContainText('保留 銀 5・金 1');
    await page.locator('[data-cancel]').click(); await page.locator('#reward-send').click();
    await expect(page.locator('#reward-list')).toContainText('退回 銀 5・金 1');
    await expect(page.locator('#reward-wallet')).toContainText('可用5');
    await expect(page.locator('#reward-wallet')).toContainText('可用2');
  });

  test('D6: mine shows pending, approved, rejected with reason, cancelled',async ({page})=>{
    const session=await parent(page);
    for (const [i,decision] of ['pending','approve','reject','cancel'].entries()) {
      const id=await reward(page,session,{name:'狀態'+i});
      const j=await api(page,'redeemRequest',{rewardId:id,requestId:'d6-state-'+i});
      if (decision==='cancel') await api(page,'redeemCancel',{id:j.redeem.id});
      else if (decision!=='pending') await api(page,'redeemDecide',{session,id:j.redeem.id,decision,reason:'先寫功課'});
    }
    await child(page,true);
    for (const text of ['等家長核准','已核准','被拒絕','已取消','家長說：先寫功課']) {
      await expect(page.locator('#reward-list')).toContainText(text);
    }
  });

  test('D7 E1: silver/gold/mixed facts match parent cards; approve and reject UI',async ({page})=>{
    const session=await parent(page);
    const cases=[{silver:2,gold:0},{silver:0,gold:1},{silver:1,gold:1}];
    const ids=[];
    for (const [i,cost] of cases.entries()) ids.push(await reward(page,session,{...cost,name:'價格'+i}));
    await child(page);
    for (const [i,id] of ids.entries()) {
      const card=page.locator(`[data-apply="${id}"]`).locator('..');
      for (const [key,label] of [['silver','銀'],['gold','金']]) if(cases[i][key]) await expect(card).toContainText(label+' '+cases[i][key]);
      await apply(page,id);
    }
    await parent(page);
    await expect(page.locator('#parent-count')).toHaveText('3');
    const cards=page.locator('[data-request]');
    for (const [i,cost] of cases.entries()) {
      const card=cards.filter({hasText:'價格'+i});
      for (const text of ['小葉子','需要','這筆保留','他目前可用','本週已換']) await expect(card).toContainText(text);
      for (const [key,label] of [['silver','銀'],['gold','金']]) if(cost[key]) await expect(card).toContainText(label+' '+cost[key]);
    }
    await cards.filter({hasText:'價格0'}).locator('[data-approve]').click();
    await expect(page.locator('#parent-count')).toHaveText('2');
    const rejected=cards.filter({hasText:'價格1'});
    await rejected.locator('[data-reject]').click();
    await rejected.locator('input').fill('下次再換');
    await rejected.locator('[data-confirm-reject]').click();
    await expect(page.locator('#parent-count')).toHaveText('1');
    await child(page,true); await expect(page.locator('#reward-list')).toContainText('家長說：下次再換');
  });

  test('G2: slow, offline, empty rewards and no pending screens',async ({page})=>{
    await page.goto(base+'?mock=slow');
    await page.locator('#rewards-home').click();
    await expect(page.locator('.reward-skeleton').first()).toBeVisible();
    await expect(page.locator('.reward-skeleton')).toHaveCount(0);
    await page.goto(base+'?mock=offline'); await page.locator('#rewards-home').click();
    await expect(page.locator('#reward-page')).toContainText('連不到雲端，現在不能申請');
    await expect(page.locator('[data-apply]')).toHaveCount(0);
    // empty mode seeds only on first launch; clear the mock snapshot before reloading.
    await page.evaluate(()=>localStorage.clear());
    await page.goto(base+'?mock=empty'); await page.locator('#rewards-home').click();
    await expect(page.locator('#reward-list')).toContainText('還沒有獎勵，請家長新增');
    await parent(page); await expect(page.locator('#parent-list')).toContainText('現在沒有待核准的申請');
  });
})();
