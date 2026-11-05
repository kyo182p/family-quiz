# T-003 第 1 輪執行回報

## 1. 修改檔案

- 〔記錄〕`Code.gs`：setup 僅於缺少 PEPPER 時建立 64 字元 hex；新增管理者發碼／重設、家長狀態／設 PIN／登入／登出、家庭共用失敗計數與鎖定、固定 30 分鐘 session，以及需 session 的玩家停用／還原／永久刪除。新增 `cancelPendingFor(code, pid)` 與 `purgeRedeemsFor(code, pid)` 空接口，供 T-004 接續。
- 〔記錄〕`test/backend.test.js`：新增 13 個 T003 具名測試，覆蓋 B1–B4、A3／A4、時鐘邊界、機密掃描、設定缺失、管理者驗證、忙碌與鎖內交錯、跨家庭登出隔離。沿用既有 fake-gas 與可控時鐘，未修改 helper。
- 〔記錄〕`REPORT.md`：以本輪實作、驗收證據、偏離及未決事項更新回報。

## 2. 驗收標準與證據

〔實測〕執行 `node --test`，exit code 0；48 個具名測試加 helper 檔案，共 49 項，全部通過。摘要輸出：

```text
ℹ tests 49
ℹ suites 0
ℹ pass 49
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

〔實測〕下表測試名稱均出現在同一次 `node --test` 的通過輸出；細節是測試內實際斷言，非僅人工推測。

| 驗收標準 | 達成狀況與證據 |
| --- | --- |
| 全數測試通過 | 〔實測〕49／49 通過，包含全部既有測試。 |
| B1 設定碼必需、錯碼拒絕、一次性、重設作廢 | 〔實測〕`T003 B1: setup codes are required, hashed, replaced, single-use and invalidated by reset` 通過。未發碼／舊碼／錯碼均拒絕；重發覆蓋舊碼；成功後刪除設定碼雜湊，再用回 pin_exists；重設後已用及未用舊碼都拒絕。PIN 非 4–6 位數字回 bad_pin_format 且計數不變。 |
| B2 連錯 5 次鎖 15 分鐘 | 〔實測〕`T003 B2: fifth wrong PIN locks the family through 14:59; unlock at exactly 15:00` 通過。第 4 次 left=1；第 6 次正確 PIN 仍 locked／minutes=15；14:59 時 minutes=1；15:00 可登入，pinfail 為 {n:0,until:0}。 |
| B2 延伸設定碼共用計數 | 〔實測〕`T003 B2 extension: wrong or absent setup code shares family lock; correct setup cannot bypass it` 通過。錯碼 5 次後正確設定碼及登入均 locked，15 分後可設定。B1 另驗證缺設定碼也累計。 |
| B3 機密掃描與 pin 屬性格式 | 〔實測〕`T003 B3: secrets stay out of sheets, logs, responses and non-secret properties; cache uses hashes` 通過。跑發碼、設 PIN、狀態、玩家清單、登出、失效 session、失敗／成功登入後，串接屬性、logs、所有表格與回應掃描 PIN、設定碼、session、PEPPER、管理者 token，無非預期明文；必要儲存／回傳位置的豁免見第 3 節。pin 屬性只有 salt、h，皆為 64 字元 hex；另以 Node crypto 獨立計算 HMAC 比對。 |
| B3 誘餌 | 〔實測〕`T003 B3 bait: equal PINs have different family hashes; changing PEPPER breaks old PIN` 通過。相同假 PIN 的兩家庭雜湊不同；更換 PEPPER 後舊 PIN 回 bad_pin。 |
| B4 無效與跨家庭 session | 〔實測〕`T003 B4: missing, random and foreign sessions reject every player mutation without data changes` 通過。三種 session × 三個玩家管理 action 共 9 組，均回完整 no_session 錯誤，所有工作表及屬性快照完全相同。 |
| session 固定 TTL、登出及重設 | 〔實測〕`T003 session: fixed TTL accepts 29:59, expires 30:00; logout and reset invalidate immediately` 通過。29:59 可操作，30:00 失效，期間操作不延長 TTL；登出立即失效；重設 PIN 後舊 session 立即失效，重設新 PIN 後仍失效。獨立 SHA-256 計算驗證 Cache 鍵與家庭／salt 值。 |
| A3 停用、還原與 p1 保護 | 〔實測〕`T003 A3: disable sorts last and blocks writes, restore clears timestamp; p1 is protected` 通過。停用者在清單最後，停用時間為 Date；saveBank／badges 回 player_disabled；還原清除停用時間，兩種寫入恢復；p1 停用及永久刪除回 bad_request。 |
| A4 永久刪除與家庭隔離 | 〔實測〕`T003 A4: purge removes only target family player everywhere and stale saves cannot resurrect` 通過。刪除本家庭 p2 的玩家、徽章及入帳列、兩個題庫的 players.p2、ledgerinit 屬性；本家庭 p1／另一玩家列與進度、另一家庭同 pid 全部不變。舊裝置以 p2 saveBank 回 bad_player；以 p1 回送含舊 p2 的 JSON 也無法救回。 |
| 缺 PEPPER 拒絕且不自動建立 | 〔實測〕`T003 configuration: missing PEPPER rejects parent actions without regeneration; legacy ping works` 通過。移除 PEPPER 後四個 parent action 均回 server_error 與「請管理者執行 setup」，屬性仍不存在；ping 正常。B1 另驗證 setup 產生 64 字元 hex 且再次執行不覆蓋。 |
| 管理者驗證及家庭不存在 | 〔實測〕`T003 admin: bad tokens do not issue/reset credentials; absent families return not_found` 通過。發碼／重設 token 錯均 bad_token，資料不變；有效 token 但家庭不存在回 not_found。 |
| index.html 不變 | 〔實測〕`git diff --exit-code -- index.html test/fake-gas.js` exit code 0，無輸出。 |

〔實測〕額外測試通過輸出：

```text
✔ T003 lock: parent/admin/player mutations return busy without changes; concurrent failures serialize
✔ T003 session isolation: foreign-family logout cannot revoke the owning family session
```

〔實測〕鎖測試於玩家管理已取得鎖後，在玩家表讀取時注入錯誤登入，觀察 deferred，再執行佇列後失敗計數僅增加一次。另以 busy 模式驗證九種新 action 均回 busy 且不改資料。外家庭拿到另一家庭 session 呼叫登出，不會撤銷原家庭 session。

〔實測〕`git diff --check` exit code 0。Git 僅提示既有 HANDOFF.md 與測試檔的 LF／CRLF 轉換，沒有空白格式錯誤。`git diff --stat` 顯示的 HANDOFF.md 差異為執行前已存在的工單更新，本輪未編輯它。

## 3. 偏離事項

- 〔記錄〕B3 字面要求「env.props 全部值搜尋不到 PEPPER」與步驟 2／SPEC 明定 PEPPER 必須存在 Script Properties 互相衝突。依明確儲存合約保留 PEPPER，掃描時僅排除 `PEPPER`、既有 `ADMIN_TOKEN` 兩個指定機密屬性；其他屬性值與所有 logs、工作表及回應仍完整掃描。此項不能宣稱滿足矛盾條文的字面版本。
- 〔記錄〕B3 只明列登入／設定回應的 session 豁免，但步驟 3 明定發碼回應必須含 setupCode。因此掃描時另排除唯一合法的發碼回應 setupCode 欄位，仍將設定碼納入其他所有位置的搜尋。這與工單禁止事項中的「發碼回應除外」一致。
- 〔記錄〕其餘無偏離。只編輯指定三檔，未新增相依、未連線真實服務、未啟動瀏覽器、未 commit 或 push；保留工作區原有修改及未追蹤檔案。

## 4. 遇到的問題與未決事項

- 〔實測〕新增鎖交錯測試初版將 hook 放在家庭表讀取，此時尚未取得鎖，因而注入請求立即執行、測試失敗；已改在鎖內的玩家表讀取點注入，觀察 deferred 並驗證後續計數，完整測試重跑通過。未為測試新增後端繞過參數。
- 〔記錄〕兌換表取消／清除依工單由 T-004 實作，兩個接口目前明確為空函式。本輪永久刪除範圍不含尚未接上的兌換表。
- 〔記錄〕驗證均在本機 fake-gas 執行，未對真實 Apps Script／Sheets 部署或驗證；正式環境 session 快取仍依 CacheService 行為運作。
- 〔記錄〕工單範圍實作與測試完成；B3 的文字矛盾已依合約處理並於第 3 節揭露，無其他阻塞事項。
