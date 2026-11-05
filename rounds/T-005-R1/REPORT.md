# T-005 第 1 輪執行回報

〔記錄〕回報日期：2026-11-06（Asia/Taipei）。已讀 HANDOFF.md、docs/REWARD-CONTRACT.md、docs/dispatch/SPEC.md 與 DESIGN.html 的玩家切換、色票及元件內容。完成本輪玩家分流、玩家切換、假後端建置與前端測試；獎勵兌換頁、家長頁未納入本輪。

## 1. 修改檔案

- 〔記錄〕`index.html`：新增 ACTIVE_PLAYER、scopeKey；植物、書架、徽章、練習進度依玩家使用本機鍵。新增 applyView／toWire、逐玩家時鐘合併、完整本機備份及只送目前玩家的雲端儲存；徽章請求帶 playerId。加入玩家圓鈕、底板、新增／修改暱稱與 12 個圖示、停用狀態、清理刪除玩家的本機鍵，以及失效玩家回退提示。切換等待計時儲存、進行中及排隊儲存、進行中徽章同步。
- 〔記錄〕`Code.gs`：僅修改 playerList 分支；withBalance:true 時，在既有鎖內補入既存 earned 並回每位玩家的 balance，未帶參數時維持原列表內容。
- 〔記錄〕`tools/build.js`（新增）：可匯入 build({outDir, html})；複製 index.html 與 zhuyin-tw.txt、替換 CONFIG、在主程式前注入假環境／Code.gs／假 fetch，跳脫 script 結尾；缺 CONFIG 或殘留正式端點字串時拒絕建置。
- 〔記錄〕`tools/mock-backend.js`（新增）：只攔 mock://gas；提供持久化、即時時鐘、假家庭／玩家／徽章／三種價格獎項、固定設定碼橫幅，以及 offline／slow／empty 模式。純 JS 雜湊明示僅供假後端使用。
- 〔記錄〕`test/fake-gas.js`：Node vm 改為延遲載入，支援 evaluate 與 base64 注入；新增 snapshot／restore，保留 Date、工作表格式、屬性與快取。
- 〔記錄〕`test/backend.test.js`：原 A4 子字串斷言改為精確玩家 ID 欄位及 ledgerinit 屬性鍵比對，仍要求 p2 完全移除。
- 〔記錄〕`test/frontend.test.js`（新增）：14 項 jsdom／建置／持久化測試，完整執行主程式，僅補 scrollTo、matchMedia、speechSynthesis。
- 〔記錄〕`package.json`：新增 build 指令及唯一直接開發相依 jsdom。
- 〔記錄〕`package-lock.json`（新增）：鎖定相依版本。
- 〔記錄〕`.gitignore`：加入 dist/、node_modules/。
- 〔記錄〕`REPORT.md`：本輪結果與驗收證據。

〔記錄〕開始時 HANDOFF.md 已修改，且有多個既存未追蹤檔案；本輪未更動這些既存工作。dist/ 為忽略的建置產物。未啟動瀏覽器、未連真實 Sheets／Apps Script、未 commit 或 push。

## 2. 逐條驗收與證據

| HANDOFF 驗收條件 | 結果與證據 |
| --- | --- |
| npm run build 成功，dist/index.html 含 mock://gas 且無正式部署網址 | 〔實測〕`npm.cmd run build` exit 0，輸出 `Built dist with mock backend`。`T005 build` 驗 dist/index.html、zhuyin-tw.txt 存在、含 mock://gas、不含 script.google.com。 |
| 缺 CONFIG 誘餌失敗；正式 index 不含假後端 | 〔實測〕`T005 build` 用 assert.throws 驗沒有 CONFIG 的 HTML；另驗替換後仍殘留端點字串亦失敗。根 index.html 不含 mock://gas、createGasEnv。 |
| node --test 全過，連跑五次 | 〔實測〕五次 exit 0，每次 84 pass、0 fail、0 skipped；原後端 69 項、fake-gas 自動載入 1 項、新增前端 14 項。逐次摘要如下。 |
| 根目錄與 dist 每段內嵌 script 可編譯 | 〔實測〕`T005 build` 逐段以 new vm.Script 編譯兩份 HTML，通過。 |
| jsdom 開站無未捕捉例外、假後端正常、圓鈕正確 | 〔實測〕所有 jsdom 實例結束時斷言例外清單為空；startup 驗 p1 圓鈕 🌱、p2 圓鈕 🐢、橫幅、列表、餘額及獎項 API。 |
| A2 新增、改名、圖示、切換、作答隔離、切回 p1 | 〔實測〕`T005 A2: form adds...` 以表單新增小星／⭐，再改小彩虹／🌈；有正在執行與排隊的 saveBank 時，player 鍵保持原值，解除請求阻擋後才寫 p2 並要求 reload。`T005 A2: p2 answers...` 將 p2 seen 2→3，雲端頂層 p1 seen 7 不變；days、summary、badge 分流，重新建立 p1 頁面仍見 seen 7，p2 seen 3 保留。 |
| scopeKey 與 clearProgress | 〔實測〕`T005 scopeKey` 驗四類玩家鍵都有 p2:；p1 badges 無前綴；family、ui-style、reader、custom-banks、resume、zy-test 無前綴；clearProgress 只刪 p2:progress-demo，保留 p1 鍵。 |
| A4 本機清理及失敗不刪 | 〔實測〕`T005 A4` 開站成功刪 pdead:badges、pdead:lib-rec:x，保留 p2 與 p1 原鍵；offline 列表失敗保留全部原鍵，底板顯示重試提示。 |
| 閱讀碼模式無玩家鈕、badges 不帶 playerId | 〔實測〕`T005 reader mode` 用後端產生的有效假閱讀碼，驗 p1 scope、無玩家鈕、badges 請求無 playerId。`T005 reader entry` 另驗從 p2 進閱讀碼及離開時 reload，重新載入後分別使用 p1 與原 p2 鍵。 |
| saveBank 不含 __p1／__view，必帶 players | 〔實測〕`T005 A2: p2 answers...` 檢查實際 fetch 送出資料，無內部標記，p2 僅有 players.p2；p1 明確送 players:{}，未覆蓋雲端 p2。 |
| 對抗：p2 離線存檔不污染 p1 快取 | 〔實測〕`T005 adversarial offline` 在 ?mock=offline 將 p2 seen 改 99，本機頂層 rec 與原 p1 深比完全相同，players.p2 為 99，無內部標記；再次 bsLoad 仍見 p2 的 99。 |
| 390×844、375×667 實際版面與觸控大小 | 〔記錄〕依工單交由雲端人工／瀏覽器測試，本機未啟動瀏覽器、未聲稱通過。新增 CSS 對玩家鈕、表單及選項設至少 44×44px，但實際排版與觸控仍待雲端確認。 |

〔實測〕最終五次連續執行指令：

```powershell
foreach($run in 1..5) {
  $result = & node --test 2>&1
  $testExit = $LASTEXITCODE
  Write-Output "RUN $run EXIT $testExit"
  $result | Select-Object -Last 9
  if($testExit -ne 0) { $result; exit $testExit }
}
```

```text
RUN 1 EXIT 0: tests 84, pass 84, fail 0, skipped 0, duration_ms 5391.048
RUN 2 EXIT 0: tests 84, pass 84, fail 0, skipped 0, duration_ms 5471.4153
RUN 3 EXIT 0: tests 84, pass 84, fail 0, skipped 0, duration_ms 5308.9416
RUN 4 EXIT 0: tests 84, pass 84, fail 0, skipped 0, duration_ms 5362.7211
RUN 5 EXIT 0: tests 84, pass 84, fail 0, skipped 0, duration_ms 5323.079
```

〔實測〕其餘有執行測試的邊界：

- `T005 stale local metadata`：本機總 updatedAt 較新、玩家進度卻較舊時，補送未套視圖的本機 wire；記憶體及本機備份保留較新的雲端 p1／p2。
- `T005 player clocks`：雲端題目與總 updatedAt 較新、本機 p2 進度較新時，保留雲端題目並補送 p2 新進度；第三位玩家的較新雲端紀錄保留，送出仍只有目前玩家。
- `T005 legacy p1 clock`：舊題庫缺 p1At 且沒有 p2 時，p2 視圖起始為空；首次作答後 p1 舊 updatedAt=100 留作 p1At，不以 p2 新時間冒充 p1 進度時間。
- `T005 disabled rows`：停用玩家置底、按鈕 disabled、無修改入口；saveBank／badges 各自回 player_disabled／bad_player，以及列表不含目前玩家／標停用，均要求 reload 至 p1 並保存指定提示。
- `T005 mock startup`：p1 銀 5 金 2、p2 銀 1；只銀／只金／搭配共三個獎項；持久化後新增玩家仍在；empty 無獎項；slow 實測等待至少 1450ms；固定假設定碼可經後端驗證。
- `T005 fake snapshot`：JSON 序列化後匯入保留 Date 型別與毫秒、工作表格式、屬性、快取，快照深比一致。

〔實測〕`git diff --check`（本輪涉及的追蹤檔案）exit 0，無空白錯誤。根目錄與 dist 的語法檢查包含於上述每輪測試。

## 3. 偏離事項

〔記錄〕無偏離。搜尋題庫讀寫後，依玩家分流欄位維持 rec、days、summary、badge；題目、注音修正、題庫內容等沿用共用行為。植物與書架紀錄依玩家分開，仍只存在裝置。匯出既有白名單內容未帶內部視圖標記，未新增其他 API 傳送整份視圖物件。

〔記錄〕補充實作選擇：players-cache 只儲存身分資料，不快取 balance；切換底板每次向後端讀餘額。被後端拒絕的玩家立即存回退通知並 reload，不把遭拒的儲存改成 p1 重送。閱讀碼進出若會改變目前玩家鍵的歸屬，等待儲存後 reload，以重新初始化全域資料。

## 4. 遇到的問題與未決事項

- 〔實測〕首次 npm 安裝遇預設 npm-cache 權限 EPERM；改用 `npm.cmd install --save-dev jsdom --cache "$env:TEMP/family-quiz-npm"` 後成功，稽核輸出 0 vulnerabilities。未增加其他直接相依。
- 〔記錄〕開發過程曾遇 PowerShell 對 Python stdin 的中文字元編碼問題，已改用 UTF-8 並修正受影響文字與精確欄位斷言，最終檢查及五次完整測試皆在修正後執行。
- 〔實測〕初版假徽章種子逐筆取 Date.now 時可能生成重複 at；已改用固定基準時間減序號，startup 精確驗證 5／2 與 1／0。
- 〔記錄〕jsdom 不實作 location.reload 導航；測試將其預期 navigation 訊息另行收集，驗證確實要求 reload，再以相同 localStorage 建立新 jsdom 實例驗重載後資料。其他 jsdom 錯誤一律使測試失敗。
- 〔記錄〕未決事項：僅工單指定交由雲端的兩種手機尺寸版面、實際觸控大小驗證。本輪自動化驗收均通過；未執行正式部署或真實服務驗證。
