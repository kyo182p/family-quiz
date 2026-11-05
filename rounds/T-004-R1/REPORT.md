# T-004 第 1 輪執行回報

〔記錄〕日期：2026-11-05。已讀取 HANDOFF.md、docs/REWARD-CONTRACT.md（含第一、二、七節）及 docs/dispatch/SPEC.md。依合約第七節實作實扣與不足原因文字。

## 1. 修改檔案

- 〔記錄〕`Code.gs`：setup 補建獎勵、兌換、兌換紀錄三表；實作 rewardSave、rewardList、redeemRequest、redeemCancel、myRedeems、redeemList、redeemDecide、parentLog；餘額扣除待核准與核准的實扣，待核准另計 held；接上停用取消與永久清除。
- 〔記錄〕`test/backend.test.js`：新增 21 個 T004 測試，包含固定種子 200 輪交錯、鎖與查重反證、跨週、快照、權限、家庭隔離、公式安全、補入與負數調整。
- 〔記錄〕`REPORT.md`：本回報、逐條驗收與已知問題。
- 〔實測〕`index.html` 無差異，`git diff --exit-code -- index.html` 結束碼 0。
- 〔記錄〕開始工作時 HANDOFF.md 已有修改，另有多個既存未追蹤檔案；本輪未修改它們。未新增依賴、未連線真實服務、未啟動瀏覽器、未 commit 或 push。

## 2. 驗收狀況與證據

〔實測〕最終執行 `node --test`，結束碼 0，摘要如下（共 70 項包含 Node 自動載入的 fake-gas.js 項目）：

```text
ℹ tests 70
ℹ suites 0
ℹ pass 70
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1521.5978
```

〔實測〕以下各項均已通過；測試名稱可在 `test/backend.test.js` 搜尋對應 T004 編號或文字。

| 驗收條件 | 狀況及測試證據 |
| --- | --- |
| 全數測試通過 | 〔實測〕`node --test`：70 pass、0 fail，既有測試未放寬。 |
| B4 家長 session | 〔實測〕`T004 setup/B4`：rewardSave、redeemDecide、redeemList、parentLog 遇缺少、隨機或外家庭 session 均 no_session，前後資料快照一致；同時驗三表完整欄序與 setup 冪等。 |
| C2 週限額 | 〔實測〕`T004 C2/week boundary`：上限 2，第 3 次 quota，reason 精確為「本週額度用完，下週一再來」。週日申請、週一核准仍保留 2026-11-02，當前週已用為 0，週一新申請成功。 |
| 週鍵邊界及 Date 讀回 | 〔實測〕同測試驗台北週一 00:00:00 → 2026-11-09、週日 23:59:59 → 2026-11-02、UTC 2026-11-08 16:00:00 → 2026-11-09；驗 safeCell 寫回為字串，另刻意以未跳脫舊值觸發假環境 Date 轉型，讀回仍計次正確。 |
| D2 保留與退回 | 〔實測〕`T004 D2/D9`：申請後待核准、可用減少、held 增加；拒絕及取消均退回原實扣銀金。 |
| D3 防重送及保密 | 〔實測〕`T004 D3`：同 requestId 回原 redeem、duplicate:true，只一列；不同玩家或家庭重用皆只回 bad_request，不洩漏他人資料。另驗 playerId、rewardId、requestId 格式。 |
| D4 隨機交錯 200 次 | 〔實測〕`T004 D4: seeded 200 interleavings`：每輪在玩家表操作 hook 插入 2–4 個隨機操作，runDeferred 後驗每位玩家銀金可用非負、各獎項週額度、requestId 唯一、紀錄不孤立、版本與狀態轉移一致。另有餘額讀取後插入多個申請的定向測試。 |
| D5 雙家長決定 | 〔實測〕`T004 D5`：兩個 session 在狀態寫入前交錯，後到同意為 already、後到拒絕為 conflict；只一筆決定紀錄、一次實扣。 |
| D7 三種價格 | 〔實測〕`T004 D7`：只銀、只金、銀金搭配，在 rewardList 與 redeemList 逐項比對；同驗玩家暱稱、圖示、目前餘額、weekUsed、pendingCount。 |
| D8 金抵銀及原因 | 〔實測〕`T004 D8`：工單全部六組情境逐字比對 reason；成功情境實扣銀 1＋金 1。金價先保留，銀不能抵金；另驗金可抵銀儲存為 TRUE/FALSE 文字也正確讀取。 |
| D9 快照固定 | 〔實測〕`T004 D2/D9`：申請後改價、停用獎項或關閉金抵銀，不影響拒絕、取消與核准時的原實扣；核准後再改價，餘額不變；拒絕原因 trim 並截至 40 字。 |
| H1 反證必須失敗 | 〔實測〕三個可執行的 `T004 H1` 測試均用 assert.throws 捕捉原驗收斷言失敗；lockMode:none 使 D4 可用銀變負、D5 決定紀錄重複；options.source 覆寫 findRedeemRequest 為永遠 null，D3 缺 duplicate 標記且實際產生兩列。正式 Code.gs 無測試開關。 |
| A3 停用與還原 | 〔實測〕`T004 A3/A4`：停用將待核准改取消、parent 紀錄、餘額退回，停用申請 player_disabled；還原後仍取消。 |
| A4 永久刪除 | 〔實測〕同測試驗目標兌換列及其 ID 對應紀錄全清，其他玩家及家庭均保留；`T004 A4 exact IDs` 另驗刪 p2 不影響 p2abcdef0 與其申請、紀錄。 |
| 對抗與隔離 | 〔實測〕`T004 adversarial`：名稱 =HYPERLINK("x")、原因 +cmd、@a 原樣讀回，env.formulaCells 為空；外家庭獎項申請／修改 not_found，外家庭兌換 ID 決定／取消 not_found，其他玩家亦不能取消。 |
| 價格驗證 | 〔實測〕`T004 reward validation/C1`：銀金合計 0、銀 100、金 -1、銀 1.5、上限 15、21 字及空白名稱均 bad_request 且資料不變；額外驗字串價格、負數或非整數上限及不合法 ID。 |
| 負數調整 | 〔實測〕`T004 negative adjustment`、`T004 negative gold adjustment`：分別測銀、金負值，balance 保留真實負數，核准 insufficient 且維持待核准，新申請也拒絕；拒絕仍可退回保留。 |
| busy | 〔實測〕`T004 busy`：lockMode:busy 下 redeemRequest、redeemDecide 回 busy，資料與 properties 快照不變。 |
| index.html 不變 | 〔實測〕`git diff --exit-code -- index.html` 無輸出、結束碼 0。 |

〔實測〕隨機交錯測試的實際診斷輸出：

```text
✔ T004 D4: seeded 200 interleavings inject multiple requests/approvals/rejections/cancellations at sheet operations
ℹ seed=0x004d45; rounds=200; {"request":197,"approve":206,"reject":203,"cancel":207,"deferred":613,"injections":200}
✔ T004 D4 targeted: simultaneous requests recompute balance inside lock
✔ T004 H1/D4 counterexample: same interleaving without lock must violate nonnegative silver
✔ T004 D5: two parent sessions approve once; same decision already, different decision conflict
✔ T004 H1/D5 counterexample: no lock duplicates decision logs for both parent outcomes
✔ T004 H1/D3 counterexample: removing requestId lookup must fail the original D3 assertion
```

〔實測〕額外驗證 `T004 parentLog`：53 次決定僅回最近 50 次，各附玩家暱稱與獎項名稱快照；入帳異常另依新到舊排列，含玩家、徽章鍵、at、顏色、原因，排除外家庭異常。`T004 F2 integration` 驗 rewardList、redeemRequest、redeemDecide 計算前都會補入雲端既存 earned。

〔實測〕`git diff --check -- Code.gs test/backend.test.js REPORT.md` 結束碼 0，無空白錯誤。

## 3. 偏離事項

〔記錄〕無偏離。僅修改工單允許的三個檔案，所有驗收都有可執行測試。

〔記錄〕合約未指定列表陣列欄位名稱及「全部狀態」查詢值，採 `redeems` 與 `status:'all'`；未帶 status 預設待核准。parentLog 的 entries 先放最近 50 筆 decision，再放 anomaly，兩組各自新的在前，以 type 分辨。未授權或失效的可選 rewardList session，按小孩權限只回啟用獎項。

〔記錄〕負數餘額時採保守方案：不產生負實扣、不允許新申請或核准；balance 仍回報真實負數。鎖沿用 withLock，寫入後在 finally flush 再釋放。

## 4. 遇到的問題與未決事項

- 〔實測〕中途一輪測試為 60 pass／1 fail，失敗點在既有 T003 A4 的 `JSON.stringify(target).includes('p2')` 斷言；後續完整測試為 68/68，最終新增兩項後為 70/70。
- 〔實測〕以固定 UUID 產生合法玩家 p2abcdef0，可示範舊子字串檢查在精確 p2 已移除後仍回 true：`{"sibling":"p2abcdef0","exactTargetRemaining":false,"oldSubstringAssertion":true}`。本輪新測試也實際經 playerPurge 驗證 p2 移除、p2abcdef0 全部保留。
- 〔推測〕初次 T003 A4 失敗可能是隨機生成的其他玩家 ID 恰以 p2 開頭；當時未保存失敗列，無法確認該次具體 ID。這是既有測試的非決定性風險，未藉重寫或放寬原測試規避；後續可另立工單將子字串檢查改為精確欄位檢查。
- 〔記錄〕未決事項限上述既有測試風險；本工單功能與驗收已完成。本輪依工單只使用假環境，未做真實 Sheets 部署或瀏覽器驗證。
