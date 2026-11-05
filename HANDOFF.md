# 工單 HANDOFF

> Orchestrator 每輪填寫,交給 Executor。Executor 只做本工單範圍內的事。

## 任務編號
T-008 第 1 輪

## 任務類型
機械輪(文件與雲端測試腳本;不動產品程式)

## 難度評分
錯誤成本中、推理深度低、判斷空間低 → 高吞吐層|Codex 預設模型

## 任務描述
寫部署說明、README 段落、留給雲端跑的 Playwright 腳本。不改 `index.html`、`Code.gs`。

## 涉及檔案
- `BUILD_REPORT.md`(新增;收尾由 Orchestrator 寫)
- `docs/DEPLOY-reward.md`(新增)
- `README.md`
- `test/e2e/reward.spec.js`(新增)
- `test/backend.test.js`(只加一個測試)
- `REPORT.md`

## 具體步驟
1. `docs/DEPLOY-reward.md`,給非工程師看,步驟依序(內容逐字採用下列重點,可以調整語句但不可以漏步驟、不可以換順序):
   1. **先備份**:打開試算表 → 檔案 → 建立副本。
   2. **貼上新程式**:擴充功能 → Apps Script → 打開 `Code.gs` → 全選、貼上 repo 裡新的 `Code.gs` → 儲存。
   3. **執行一次 `setup`**:上方函式選單選 `setup` → 執行。會補上「玩家、徽章入帳、獎勵、兌換、兌換紀錄」五個工作表、「徽章」表第 5 欄「玩家ID」,並產生 `PEPPER`(在專案設定的指令碼屬性看得到,不要外流、不要刪除;刪了所有 PIN 都會失效)。可以重複執行,不會覆蓋資料。
   4. **更新部署**:部署 → 管理部署作業 → 鉛筆(編輯)→ 版本選「新版本」→ 部署。網址不變。**不要用「新增部署作業」**,那會產生新網址。
   5. **發設定碼**(每個家庭一次),不必把管理者金鑰拿出來:在 Apps Script 編輯器新增下面這段暫時函式,把邀請碼改成該家庭的,選 `tmpIssue` 執行,到「執行紀錄」看設定碼,**看完把這段函式刪掉、再儲存**,不必重新部署:
      ```js
      function tmpIssue() {
        console.log(adminParent({ action: 'adminIssueSetupCode', family: '這裡填邀請碼' }));
      }
      ```
      設定碼私下交給家長。一個家庭只會有一組有效的,重發會讓舊的失效。
   6. **家長設定 PIN**:在手機打開 `網站網址/#parent` → 輸入設定碼與新 PIN。可以把這個網址加到手機主畫面。
   7. **手機實測**:用 PR 的前端實測(`npm run build` 後開 `dist/index.html` 是假後端示範;要測真後端,由使用者自行決定)。確認沒問題後,**使用者自己按合併 PR**。合併等於上線。舊前端在合併前可以照常用,它不帶玩家資料,一律當第一位玩家。
   8. **忘記 PIN 或要重設**:同第 5 步的暫時函式,把 `action` 改成 `adminResetPin`,再發一次設定碼。
   9. **退回**:部署 → 管理部署作業 → 編輯 → 版本選舊版 → 部署;前端未合併就不用動。新工作表留著不影響舊版。
   另外寫一節「上線前再確認」:個資法修法施行日(SPEC 要求上線前再查一次,連到 `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021`);試算表只分享給管理者自己。
   文件不可以出現任何真實網址、邀請碼、金鑰、PIN(`這裡填邀請碼` 這類佔位字可以)。
2. `README.md`:最後的「九、安全與限制」之前,加「## 家長權限與獎勵(新增)」一段:功能一句話、入口 `#parent`、徽章規則(一般銀、進階金,每位玩家分開)、升級步驟連到 `docs/DEPLOY-reward.md`、`npm install`、`npm run build`、`node --test` 的用途。編號慣例保持,不要重新編號既有章節。
3. `test/backend.test.js`:加一個測試 `T008 docs: 編輯器暫時函式可以發設定碼`,用 `env.run('adminParent',{action:'adminIssueSetupCode',family:'TEST-0000'})` 確認回 `ok:true` 與 `setupCode`,且該設定碼能用來 `parentSetPin`。
4. `test/e2e/reward.spec.js`,給雲端用 Playwright 跑:
   - **`node --test` 會把 `test/` 底下所有 js 當測試跑**,這個檔不可以讓 `node --test` 失敗。檔案開頭判斷:`require.resolve('@playwright/test')` 找不到就直接 `return` 式結束(用 `try/catch` 包起來、整個內容放進函式),不新增相依,也不把 Playwright 寫進 `package.json`。
   - 開檔註解寫明執行方式:`npm run build`、`npm i --no-save @playwright/test`、`npx playwright install chromium`、`npx playwright test test/e2e/reward.spec.js`(用 `file://` 開 `dist/index.html`,用 `FQ_DIST` 環境變數可以改路徑)。
   - 測試內容(只跑假後端,不連真實服務):G1:390×844 與 375×667 下,首頁、獎勵頁、我的申請、家長 PIN、家長四個分頁,`document.documentElement.scrollWidth <= window.innerWidth`,可見按鈕與輸入框的 `getBoundingClientRect` 高寬都 ≥ 44,且沒有 `pageerror`;A2、A3、B5、C1、D1、D2、D6、D7、D9、E1、G2 的畫面主流程各一個,用 `page.setContent` 以外的真實導覽。G3:開頭註解說明 Lighthouse 指令 `npx lighthouse <網址> --form-factor=mobile --only-categories=performance`,雲端手動跑。
5. 寫 `REPORT.md`。

## 驗收標準(全部達成才算完成)
- [ ] [測試] `node --test` 全數通過,`test/e2e/reward.spec.js` 不造成失敗
- [ ] [測試] `T008 docs` 測試通過
- [ ] [測試] `new vm.Script` 編譯 `test/e2e/reward.spec.js` 成功(或 `node --check`)
- [ ] [複核] `git diff --stat` 沒有 `index.html`、`Code.gs`、`package.json`
- [ ] [複核] `docs/DEPLOY-reward.md` 九個步驟都在、順序正確;`git grep` 查不到 `script.google.com/macros/s/` 出現在 `docs/DEPLOY-reward.md`
- [ ] [人工] e2e 腳本由雲端實際執行,本機未跑。REPORT 必須明寫「尚未做:Playwright 實際執行」

## 假設與未知
- 假設:`adminParent` 是全域函式,在 Apps Script 編輯器可以直接呼叫,不經 token。這只有擁有編輯器權限的管理者做得到。
- 未知:雲端 Chromium 的 emoji、字型差異可能影響量測,腳本量測只比尺寸,不比截圖。
- 遇到未知:選保守方案、記到 REPORT.md「偏離事項」、繼續。

## 禁止事項
- 不得修改「涉及檔案」以外的檔案;不得改 `docs/dispatch/`
- 不得啟動瀏覽器;不得執行 `playwright`、`lighthouse`;不得安裝 Playwright
- 不得部署;不得連線真實服務
- 不得 git commit、git push
- 文件不得放真實網址、邀請碼、金鑰、PIN
- 最簡解原則:能少寫就少寫

## 上下文 / 已知的坑
- 假後端設定碼 `MOCK2345`,網址參數 `?mock=offline|slow|empty`,見 `tools/mock-backend.js`。
- 既有前端流程可參考 `test/frontend.test.js` 的選擇器(`#player-button`、`#rewards-home`、`[data-reward-tab]`、`[data-apply]`、`#reward-send`、`[data-pin-key]`、`[data-parent-tab]`…)。

## 完成後回報格式(寫入 REPORT.md)
1. 修改了哪些檔案(逐一列出)
2. 每條驗收標準的達成狀況與證據(指令輸出)
3. **偏離事項**(必填章節,沒有偏離就明確寫「無偏離」;缺這章節視為回報不完整)
4. 遇到的問題與未決事項
每項關鍵陳述標〔實測〕〔記錄〕〔推測〕。
