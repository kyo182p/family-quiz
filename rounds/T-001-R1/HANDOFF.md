# 工單 HANDOFF

> Orchestrator 每輪填寫,交給 Executor。Executor 只做本工單範圍內的事。

## 任務編號
T-001 第 1 輪

## 任務類型
整合輪(測試基礎建設;後續所有後端驗收都靠它,假環境不誠實會全部假綠燈)

## 難度評分
錯誤成本高、推理深度中、判斷空間低 → 標準生成層|Codex 預設模型

## 任務描述
建立假 Apps Script 環境與測試基礎:`test/fake-gas.js` 用 Node `vm.runInContext` 載入 `Code.gs`,注入記憶體版 Apps Script 服務與可控時鐘;`test/backend.test.js` 用 `node --test` 跑基準情境。這張工單**不改 Code.gs**。

## 涉及檔案
- `test/fake-gas.js`(新增)
- `test/backend.test.js`(新增)
- `package.json`(新增;只要 name、private、scripts.test=`node --test`,不加相依)
- `REPORT.md`

## 具體步驟
1. 先讀 `Code.gs`、`docs/REWARD-CONTRACT.md`(第一節)、`docs/dispatch/SPEC.md` 的「技術做法」。
2. 實作 `createGasEnv(options)`,回傳 `{ doPost(obj), run(fnName, ...args), clock, sheets, props, cache, logs, onSheetOp, runDeferred }`:
   - `doPost(obj)`:把物件 JSON 後包成 `{postData:{contents}}` 呼叫,回傳解析後的 JSON 物件。
   - `SpreadsheetApp.getActive()`(也提供 `flush()`)、`getSheetByName`、`insertSheet`;Sheet 要有 `getDataRange`、`getRange(row,col,rows,cols)`(`getValue/getValues/setValue/setValues/clearContent/setFontWeight/setNumberFormat/getRow`)、`appendRow`、`deleteRow`、`getLastRow`、`getLastColumn`、`setFrozenRows`、`clearContents`。
   - `Utilities`:`getUuid`、`formatDate(d,tz,fmt)`(至少支援 yyyy MM dd HH mm ss,依指定時區計算)、`base64Encode`、`computeDigest`、`computeHmacSha256Signature`、`DigestAlgorithm.MD5/SHA_256`,回傳 Apps Script 同型的有號位元組陣列。雜湊實作由 `options.hash` 注入,預設用 node `crypto`(之後瀏覽器假後端會注入別的實作,所以 `fake-gas.js` 核心不可以在頂層 require crypto,要延遲載入或由預設參數取得)。
   - `PropertiesService.getScriptProperties()`、`CacheService.getScriptCache()`(TTL 依可控時鐘過期)、`ContentService`。`console` 全部記到 `env.logs`,測試才能搜字串。
   - `Date` 要換成可控時鐘版(`new Date()` 與 `Date.now()` 都走 `clock`,`new Date(x)` 正常),且 `clock.set(ms)`、`clock.advance(ms)`。`instanceof Date` 在 Code.gs 內要成立。
3. **誠實的儲存格行為**(這是本工單重點,寫入 `appendRow`/`setValues`/`setValue` 都要經過):
   - 字串開頭 `'`:去掉這個引號後存成文字,不再轉型。
   - 字串 `=` 開頭:存成 `{formula:'...'}` 這種明顯不是字串的東西並記入 `env.formulaCells`,讓測試抓得到公式注入。
   - 字串 `yyyy-MM-dd` 或 `yyyy/MM/dd` → Date;純數字字串 → number;`TRUE`/`FALSE`(不分大小寫)→ boolean。其他照存。
   - 欄位標頭(第一列)也一樣經過;`setNumberFormat('@')` 之後的格子不轉型。
   - `getValues` 回傳矩形陣列,空格是 `''`,不足的欄補 `''`。
4. **併發模擬**(之後 D4/D5/H1 要用):
   - `env.onSheetOp(cb)`:每次讀或寫儲存格前呼叫 cb,cb 可以呼叫 `env.doPost`,模擬另一個請求在這一刻抵達。
   - `LockService.getScriptLock()`:`waitLock(ms)`/`tryLock(ms)`/`releaseLock`。`options.lockMode`:`'real'`(預設)表示鎖被占用時,巢狀請求不執行、排入佇列,外層請求結束後依序執行(用 `env.doPost` 的回傳值表示 `{deferred:true}`,實際結果由 `env.runDeferred()` 回傳陣列);`'none'` 表示鎖形同虛設,巢狀請求立刻插入執行;`'busy'` 表示 `waitLock` 直接丟例外(模擬拿不到鎖)。
   - `options.source`:可傳入要載入的原始碼字串(預設讀 repo 根目錄的 `Code.gs`),反證測試要用。
5. `test/backend.test.js` 寫基準測試(逐條見驗收標準)。測試斷言的期望值來自本工單與 Code.gs 既有規格,不是抄實作輸出。
6. 注意 **`node --test` 預設會把 `test/` 底下所有 js 都當測試跑**:`test/fake-gas.js` 不可以有副作用,載入時不能報錯。
7. 寫 `REPORT.md`。

## 驗收標準(全部達成才算完成)
- [ ] [測試] `node --test` 全數通過,輸出貼進 REPORT.md
- [ ] [測試] 基準:`setup` 後 `ping` 用 `TEST-0000` 回 `ok:true`;錯的邀請碼回 `bad_code`
- [ ] [測試] 基準:`saveBank` 後 `listBanks` 拿得到同一份內容;超過 45000 字的題庫 JSON 能分段存回
- [ ] [測試] 基準:兩次 `badges` 同步同一徽章不同 `at`,earned 取聯集
- [ ] [測試] 誘餌:寫入 `2026-11-02` 讀回是 Date;寫入 `'2026-11-02` 讀回是字串;寫入 `=1+1` 被記入 `env.formulaCells`;寫入 `'=1+1` 不會;寫入 `123` 讀回 number;寫入 `abc` 讀回字串
- [ ] [測試] 誘餌:`clock.set` 之後 Code.gs 內的 `new Date()` 與 `Date.now()` 都等於設定值;快取超過 TTL 取不到、未超過取得到
- [ ] [測試] 誘餌:`onSheetOp` 內發巢狀請求:`lockMode:'real'` 且外層持鎖時回 `{deferred:true}`,`runDeferred` 才執行;`lockMode:'none'` 立刻執行
- [ ] [測試] 誘餌:`lockMode:'busy'` 時呼叫 `saveBank` 不會讓 `doPost` 噴到外面(回傳 `ok:false`)
- [ ] [複核] `git status` 顯示沒有改到 `Code.gs`、`index.html`

## 假設與未知
- 假設:Node 24 內建 `node:test`、`node:vm`,不需要任何 npm 套件。
- 未知:Code.gs 用 `const` 宣告的頂層常數在 vm context 外取不到;需要時只透過 `run(fnName)` 或 `doPost` 操作,不要改 Code.gs。
- 未知:實作細節(例如巢狀請求的佇列)可能需要微調介面;遇到未知選保守方案,記到 REPORT.md「偏離事項」,繼續,不得擴大範圍。

## 禁止事項
- 不得修改「涉及檔案」以外的檔案;不得改 `docs/dispatch/`
- 不得新增任何相依套件
- 不得連線到真的試算表、Apps Script 網址;不得啟動瀏覽器
- 不得執行 git commit、git push(由 Orchestrator 處理)
- 不得在任何檔案放真實試算表 ID、金鑰、PIN;測試只用假暱稱
- 最簡解原則:先問需不需要存在 → 標準庫能不能解 → 能少寫就少寫,不新增不必要的抽象

## 上下文 / 已知的坑
- Code.gs 由 `SpreadsheetApp.getActive()`、`LockService`、`ContentService` 等全域取用;`out()` 回傳的物件要能取回 JSON。
- `doPost` 接收 `e.postData.contents`。

## 完成後回報格式(寫入 REPORT.md)
1. 修改了哪些檔案(逐一列出)
2. 每條驗收標準的達成狀況與證據(指令輸出)
3. **偏離事項**(必填章節,沒有偏離就明確寫「無偏離」;缺這章節視為回報不完整)
4. 遇到的問題與未決事項
每項關鍵陳述標〔實測〕〔記錄〕〔推測〕。
