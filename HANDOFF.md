# 工單 HANDOFF

> Orchestrator 每輪填寫,交給 Executor。Executor 只做本工單範圍內的事。

## 任務編號
T-002 第 2 輪

## 任務類型
修復輪

## 難度評分
錯誤成本高、推理深度低、判斷空間低 → 標準生成層|Codex 預設模型

## 任務描述
修正 Orchestrator 審查 T-002 第 1 輪 diff 找到的 4 個問題,並補 1 個對抗測試。範圍很小,不要動其他東西。

## 涉及檔案
- `Code.gs`
- `test/fake-gas.js`
- `test/backend.test.js`
- `REPORT.md`

## 具體步驟
1. `safeCell`:空字串(含 null/undefined)回傳 `''`,不加引號;其他照舊。
2. `test/fake-gas.js` 的 `convert`:值剛好是單獨一個 `'` 時保留成字串 `'`,不要吃掉。真 Sheets 的行為未驗證,假環境取比較嚴格的一邊,這樣才抓得到空字串沒處理。
3. 把 `writeQuestionRows`、`removeQuestionRows` 還原成 `git show HEAD:Code.gs` 的寫法(不經 safeCell)。第 1 輪測試若依賴這個行為,改測試。`putBank`、`setPublish`、`updatePublicMeta` 的 safeCell 保留。
4. `badgeSync`:邀請碼遇到不合法的徽章鍵時略過該鍵(和舊版、閱讀碼一樣),其他鍵照常合併與入帳,不回 `bad_request`。
5. `balance` action:在 `playerBalance` 前先呼叫 `syncLedger(code, pid, {})`,讓補入不必等第一次同步。
6. 補測試、寫 `REPORT.md`。

## 驗收標準(全部達成才算完成)
- [ ] [測試] `node --test` 全數通過
- [ ] [測試] 入帳列的「異常」欄讀回是空字串,不是 `'`;`env.sheets` 內找不到任何值等於單獨 `'` 的儲存格(跑完一次 setup、playerSave、saveBank、badges 之後逐格檢查)
- [ ] [測試] `git diff HEAD -- Code.gs` 中 `writeQuestionRows`、`removeQuestionRows` 沒有變更
- [ ] [測試] `badges` 同時送一個合法鍵與一個含 `:` 的鍵,回 `ok:true`,合法鍵入帳,非法鍵不入帳也不寫入徽章表
- [ ] [測試] 雲端有 p1 舊徽章、尚未同步過,直接呼叫 `balance` 就得到正確的銀、金數量;再呼叫一次數字不變
- [ ] [測試] 舊前端回送它從雲端讀到的 `players`(沒有新前端邏輯、內容未變)時,p2 資料不變、p1 的新作答被採用

## 假設與未知
- 假設:`'` 開頭的非空字串在一般格式欄位,真 Sheets 會去掉引號(官方行為);單獨 `'` 不確定,所以一律不寫。
- 遇到未知:選保守方案、記到 REPORT.md「偏離事項」、繼續,不得擴大範圍。

## 禁止事項
- 不得修改「涉及檔案」以外的檔案;不得新增相依;不得連線真實服務;不得啟動瀏覽器
- 不得 git commit、git push
- 不得做本單以外的重構
- 最簡解原則:能少寫就少寫

## 上下文 / 已知的坑
- 第 1 輪回報見 `rounds/T-002-R1/REPORT.md`;審查見 `rounds/T-002-R1/REVIEW.md`。

## 完成後回報格式(寫入 REPORT.md)
1. 修改了哪些檔案(逐一列出)
2. 每條驗收標準的達成狀況與證據(指令輸出)
3. **偏離事項**(必填章節,沒有偏離就明確寫「無偏離」;缺這章節視為回報不完整)
4. 遇到的問題與未決事項
每項關鍵陳述標〔實測〕〔記錄〕〔推測〕。
