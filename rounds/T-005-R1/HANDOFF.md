# 工單 HANDOFF

> Orchestrator 每輪填寫,交給 Executor。Executor 只做本工單範圍內的事。

## 任務編號
T-005 第 1 輪

## 任務類型
整合輪(前端資料分流:做錯會把 A 小孩的作答存到 B 小孩,或蓋掉雲端)

## 難度評分
錯誤成本高、推理深度高、判斷空間中 → 深推理層|Codex 預設模型

## 任務描述
前端第一步:玩家切換(畫面 1)、localStorage 依玩家分開、題庫作答依玩家分開、`npm run build` 與假後端、jsdom 前端測試基礎。獎勵兌換頁與家長頁在後面的工單,這張不做。

## 涉及檔案
- `index.html`
- `Code.gs`(只加 `playerList` 的 `withBalance`)
- `tools/build.js`(新增)
- `tools/mock-backend.js`(新增)
- `test/fake-gas.js`
- `test/backend.test.js`
- `test/frontend.test.js`(新增)
- `package.json`
- `package-lock.json`(新增)
- `.gitignore`
- `REPORT.md`

窮舉證據(`index.html` 全部 localStorage 鍵,由 Orchestrator 掃描):
- **依玩家分開**:`badges`(953,1004,1007,1020)、`progress-*` 即 `progKey`(1109,1112,1114)、`libLocalKey`(3433,3434)、`g3plants-rec`(668,674,1408)
- **不分開**:`ui-style`、`g3plants-prefs`、`family`、`last-ai-raw`、`AI_KEY`、`PENDING_KEY`、`custom-prefs`、`custom-up-lv`、`custom-up-count`、`reader`、`HJ_KEY`、`zy-*`、`sheet-prefs`、`tour-done`、`resume`、`LS_BANKS`(本機題庫快取,存完整格式,含所有玩家)
- 1112 是直接呼叫 `localStorage.removeItem`,不經過 `store`,也要處理。

## 具體步驟
1. 讀 `docs/REWARD-CONTRACT.md` 第三、四、八節;`docs/dispatch/SPEC.md` 畫面 1 與「設計規則」;`docs/dispatch/DESIGN.html` 第一支手機(玩家切換)、色票與元件區。讀 `index.html` 時用搜尋,不要整檔讀(36 萬字)。
2. **玩家鍵**:在 `store` 定義前加 `ACTIVE_PLAYER`(讀 localStorage `player`,預設 `p1`;閱讀碼模式一律 `p1`)。加 `scopeKey(k)`:`k` 屬於上面「依玩家分開」的集合且玩家不是 p1,回傳 `pid + ':' + k`,否則原樣。`store.get/set` 與 1112 都走它。舊資料不搬。
3. **題庫視圖**(整份工單最容易錯的地方):
   - 記憶體裡的 `bank.rec/days/summary/badge` 永遠是**目前玩家**的。若有其他 per-player 欄位,請搜尋確認(工單假設只有這四個)。
   - `applyView(b)`:目前玩家不是 p1 時,把頂層這四欄與 `p1At` 收進 `b.__p1`,換成 `b.players[pid]` 的內容(沒有就空的),並標 `b.__view = pid`。
   - `toWire(b, keepTime)`:回傳要存的物件。有 `__view` 時把 `__p1` 還原回頂層,目前玩家的四欄放進 `players[pid]`(不是 keepTime 就更新其 `updatedAt`)。p1 時(不是 keepTime)更新 `p1At`。一律帶 `players` 鍵,否則後端會當舊前端。去掉 `__p1`、`__view`。
   - `bsSave`:`localPut` 存完整 wire(含全部 players);送 `saveBank` 時帶 `playerId`,`players` 只送目前玩家(p1 時送 `{}`)。
   - `bsLoad`:`applyView` 只在合併完成後做。本機較新時(1739)要送的是未套用視圖的本機版本,而且記憶體用的版本不可以用舊本機資料蓋掉雲端 `players` 裡比較新的玩家:逐位比 `updatedAt`、p1 比 `p1At`,取新的。
   - 搜尋所有用到 `clone(bank)`、`JSON.stringify(bank` 的地方,不可以把 `__p1`、`__view` 送到別的 API 或匯出。
4. **徽章同步**:`badgeSync` 的 `libApi('badges', ...)` 帶 `playerId`(閱讀碼不帶)。
5. **玩家切換畫面(畫面 1)**,只有 `FAMILY.code` 存在時顯示:
   - 首頁右上玩家圓鈕(目前玩家 emoji),點開底板:清單顯示暱稱、圖示、`銀 n・金 n`;目前玩家標「使用中」;停用的灰、置底、不能點。新增表單:暱稱(placeholder `不要填真名`)、12 個圖示選擇;改名與改圖示共用表單。不用 `confirm()`。
   - 依 SPEC 色票與元件;可點元件 ≥ 44×44px;文字不用術語。
   - 切換:存完未完成的儲存(`recTimers` 與 `saving`)後,寫 `player`、`location.reload()`。
   - 開站時背景呼叫 `playerList`:成功時更新 `players-cache`,刪除本機不在清單內玩家的所有 `pid:` 鍵;目前玩家已停用或不存在時切回 p1 並提示「這位玩家已被停用，先切回 玩家名」。呼叫失敗不做任何刪除。`saveBank` 或 `badges` 回 `player_disabled`、`bad_player` 時同樣切回。
6. **`Code.gs`**:`playerList` 接受 `withBalance:true`,每位玩家多回 `balance`。
7. **`tools/build.js`、`npm run build`**:把 `index.html`、`zhuyin-tw.txt` 複製到 `dist/`。`dist/index.html` 把 `CONFIG.API_URL` 換成 `mock://gas`,在主程式前內嵌假後端(`test/fake-gas.js`、`Code.gs`、`tools/mock-backend.js` 的內容,跳脫 `</script>`)。**`dist/` 只有假後端,不可以留真實部署網址**;找不到 `CONFIG` 那一行或替換後仍有 `script.google.com` 就讓 build 失敗。根目錄 `index.html` 不可以有任何假後端程式。`.gitignore` 加 `dist/`、`node_modules/`。
8. **`test/fake-gas.js` 改成可在瀏覽器跑**:`node:vm`、`Buffer`、`crypto` 都不可以在頂層用。`options.evaluate(source, globals)` 注入執行方式,預設 node vm;瀏覽器用 `new Function`(把 `Date` 等當參數傳入)。`env.snapshot()`、`env.restore(data)` 匯出匯入工作表、屬性、快取(Date 要保留型別)。Node 端既有測試不改行為。
9. **`tools/mock-backend.js`**:攔截 `fetch('mock://gas')`,每次請求前把時鐘設成現在,呼叫 `env.doPost`,狀態存 localStorage `mock-gas-state`(reload 不會消失)。雜湊用簡單的純 JS 實作,註明只給假後端用。第一次開啟自動 `setup`,種入:假邀請碼 `TEST-0000`(也寫入 `family`)、p1「小葉子」與 p2「小石頭」、假徽章(p1 銀 5、金 2;p2 銀 1)、三個獎項(只銀、只金、銀＋金)。假設定碼固定 `MOCK2345`,用一條小橫幅顯示「假後端示範。家長設定碼：MOCK2345」。網址參數:`?mock=offline`(fetch 失敗)、`?mock=slow`(延遲 1500ms)、`?mock=empty`(不種獎項)。
10. **`test/frontend.test.js`**:用 `jsdom`(加 devDependency,`runScripts:'dangerously'`,不啟動瀏覽器;用 `tools/build.js` 匯出的函式把 dist 建到暫存資料夾或 repo 的 `dist/`)載入 `dist/index.html`。補 jsdom 缺的 API(`scrollTo`、`matchMedia`、`speechSynthesis`…),只補最少。
11. **修既有測試的隨機失敗**:`test/backend.test.js` 第 697、699 行 `includes('p2')` 改成精確比對該玩家 ID 欄位,不可以放寬驗證目的。
12. 寫 `REPORT.md`。

## 驗收標準(全部達成才算完成)
- [ ] [測試] `npm run build` 成功,`dist/index.html` 存在,內含 `mock://gas`,不含 `script.google.com`
- [ ] [測試] 誘餌:給 build 一份沒有 `CONFIG` 行的 HTML 會失敗;根目錄 `index.html` 不含 `mock://gas`、`createGasEnv`
- [ ] [測試] `node --test` 全數通過,連跑 5 次都綠(隨機失敗已修)
- [ ] [測試] 語法:`dist/index.html` 與 `index.html` 的每段內嵌 script 都能被 `new vm.Script` 編譯
- [ ] [測試] jsdom 開站無未捕捉例外;假後端回應正常;玩家圓鈕顯示目前玩家
- [ ] [測試] A2:新增玩家、改名、選圖示;切換後 `localStorage.player` 改變;作答寫入 `bank.rec` 時,p2 的內容進 `players[p2]`、雲端頂層 p1 的 `rec` 不變;切回 p1 看到 p1 的數字
- [ ] [測試] `scopeKey`:p1 的 `badges` 不加前綴;p2 是 `p2xxx:badges`;`family`、`ui-style` 不加前綴;`clearProgress` 清的是目前玩家的鍵
- [ ] [測試] A4 本機部分:`playerList` 回應不含某玩家時,該玩家所有 `pid:` 鍵被刪,別的玩家與 p1 的鍵不動;`playerList` 失敗時什麼都不刪
- [ ] [測試] 閱讀碼模式:不顯示玩家圓鈕,`badges` 請求不帶 `playerId`
- [ ] [測試] 送到後端的 `saveBank` 內容不含 `__p1`、`__view`,且一定有 `players` 鍵
- [ ] [測試] 對抗:p2 使用中時裝置離線存檔(`?mock=offline`),本機快取的 p1 `rec` 不被 p2 的內容污染
- [ ] [人工] 390×844、375×667 實際版面、觸控大小由雲端測試確認,本機不驗

## 假設與未知
- 假設:per-player 欄位只有 `rec`、`days`、`summary`、`badge`。搜尋後若發現別的欄位,記到「偏離事項」並說明處理。
- 假設:植物與書架作答依玩家分開但留在裝置(SPEC 明定)。
- 未知:jsdom 能不能跑完這支 36 萬字的主程式。若某些瀏覽器 API 缺失,在測試裡補 stub,不可以改 `index.html` 去遷就 jsdom。jsdom 完全跑不起來時,改用最小 DOM stub,記到偏離事項,不得刪除這類驗收。
- 未知:npm 安裝失敗時,記到偏離事項,其他項目照做,前端測試標明未跑,不得假裝通過。
- 遇到未知:選保守方案、記到 REPORT.md「偏離事項」、繼續,不得擴大範圍。

## 禁止事項
- 不得修改「涉及檔案」以外的檔案;不得改 `docs/dispatch/`、`docs/REWARD-CONTRACT.md`
- 不得啟動瀏覽器(Edge、Chrome、Playwright、Puppeteer);不得連線真的試算表或 Apps Script
- 除了 `jsdom` 不得新增其他相依;不得新增框架、打包工具
- 不得 git commit、git push
- 不得改變既有題庫、徽章、AI、書架、講義功能的行為;p1 使用者的體驗除了多一個圓鈕以外不變
- 不得做獎勵兌換頁、家長頁(後面工單)
- 不得把真實網址、邀請碼、PIN 放進 `tools/` 或測試
- 最簡解原則:能少寫就少寫

## 上下文 / 已知的坑
- 主程式所有函式都掛在全域(頂層 `function`),`const`、`let` 不是。測試可以用 `window.eval` 取。
- 開站 3 秒後有 `setTimeout(badgeSync,3000)`;`hookTours` 會包 `libHome` 等函式。
- `node --test` 會把 `test/` 底下所有 js 當測試跑,`test/fake-gas.js` 不可以有副作用。
- 目前 `Code.gs` 的 `saveBank(fam, bank, pid)` 用 `req.playerId` 只做玩家檢查,實際合併看 `bank.players`。

## 完成後回報格式(寫入 REPORT.md)
1. 修改了哪些檔案(逐一列出)
2. 每條驗收標準的達成狀況與證據(指令輸出)
3. **偏離事項**(必填章節,沒有偏離就明確寫「無偏離」;缺這章節視為回報不完整)
4. 遇到的問題與未決事項
每項關鍵陳述標〔實測〕〔記錄〕〔推測〕。
