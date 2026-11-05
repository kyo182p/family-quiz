# T-001 第 1 輪執行回報

## 1. 修改檔案

- 〔記錄〕新增 `test/fake-gas.js`：以 Node VM 載入原始 `Code.gs`，提供記憶體工作表、Properties、Cache、ContentService、Utilities、日誌、可控 Date 與鎖模擬。
- 〔記錄〕新增 `test/backend.test.js`：基準情境、假環境誘餌、工具驗證與移除鎖的反證測試。
- 〔記錄〕新增 `package.json`：僅包含 name、private、scripts.test，沒有相依套件。
- 〔記錄〕新增 `REPORT.md`：本回報與實際驗收輸出。

## 2. 驗收結果與證據

| 工單驗收條件 | 結果及測試證據 |
| --- | --- |
| `node --test` 全數通過 | 〔實測〕通過；完整輸出附於下方。helper 被自動發現為測試檔時也能成功載入。 |
| setup、ping 與錯誤邀請碼 | 〔實測〕重複 setup 不新增家庭；TEST-0000 回 ok:true；錯碼回 bad_code。 |
| saveBank/listBanks 與超過 45000 字分段 | 〔實測〕小題庫逐欄相等；超過 95000 字的 JSON 分三段，前兩段各 45000 字，重組與輸入相同；縮短題庫後舊分段清空。 |
| badges earned 聯集 | 〔實測〕同徽章兩次同步 at=100、200，兩筆均保留；再送舊紀錄不重複入列。 |
| 儲存格轉型與公式誘餌 | 〔實測〕appendRow、setValues、setValue 各自驗證日期、單引號逸出、公式物件與 formulaCells、數字、普通字串、大小寫布林；第一列同樣轉型。另驗證純文字格式、矩形補空、清空、刪列與 Date 複本。 |
| 可控時鐘與快取 TTL | 〔實測〕VM 內 new Date()、Date.now()、instanceof Date 正確；new Date(x) 不受目前時鐘影響；TTL 到期前有效、到期當下及之後為 null。原有 countKey 在台北午夜換日，saveBank 的 Date 使用設定時鐘。 |
| onSheetOp 與 real/none 鎖 | 〔實測〕外層持鎖時兩個巢狀請求均回 deferred:true；runDeferred 依 FIFO 執行並產生兩個結果；none 模式立即執行且呈現覆寫，驗證假環境確實允許交錯。未持鎖的巢狀 ping 可立即執行。 |
| busy 模式不向外拋錯 | 〔實測〕saveBank 回 ok:false、server_error，沒有寫入題庫；logs 可搜尋 Lock busy。這是現有 Code.gs 的行為，本工單不改成未來規格的 busy code。 |
| Code.gs、index.html 未變更 | 〔實測〕下方 git diff / git status 輸出顯示這兩檔沒有變更。 |

〔實測〕額外工具驗證：指定時區 yyyy/MM/dd/HH/mm/ss、UTF-8 base64、MD5/SHA-256/HMAC 已知向量、有號位元組、UUID 格式、注入 hash adapter、Properties 字串化與 console 訊息皆通過。

〔實測〕反證只以 options.source 在記憶體移除 putBank 的 waitLock；巢狀請求立刻成功後被外層覆寫，證明測試架構能暴露少鎖的交錯問題。磁碟上的 Code.gs 未修改。

## 3. 偏離事項

〔記錄〕無偏離。

〔記錄〕工單同時描述「外層請求結束後依序執行」與「runDeferred 才執行」；採驗收標準明確指定的後者：巢狀請求在持鎖時只排隊，外層結束後由 runDeferred() 同步依序執行並回傳結果，避免結果被提前消耗。

## 4. 遇到的問題與未決事項

- 〔記錄〕onSheetOp(cb) 在每個儲存格讀寫前通知，參數為 `{sheet, op, row, col}`。callback 執行期間暫停重入通知，避免巢狀請求無限觸發自身；巢狀請求的資料操作仍正常執行。可用 onSheetOp(null) 移除 callback。
- 〔記錄〕sheets 是名稱對 Sheet 的 Map；props/cache 直接提供同一份注入服務；logs 是可搜尋字串陣列；formulaCells 是歷次未逸出公式寫入紀錄（不是目前公式格清單）。日期文字依台北午夜轉型，配合既有資料合約。
- 〔記錄〕options.hash 介面為 `{digest(algorithm, value), hmac(value, key)}`，回傳 byte iterable；未注入時才延遲 require node:crypto。UUID 使用假環境的隨機 UUID v4 格式生成器，不作正式憑證用途。預設 source 在建立環境時才讀取 Code.gs，載入 helper 本身不讀檔、不建立環境、不載入 crypto。
- 〔記錄〕字型粗細與 SpreadsheetApp.flush 為相容 API 的無動作實作；純文字 number format 有實際作用。併發採同步 callback 的可控交錯，沒有宣稱模擬多執行緒或完整 Google Sheets 計算引擎。
- 〔記錄〕未新增套件、未啟動瀏覽器、未呼叫真實 Apps Script 或試算表、未執行 commit/push；僅變更工單列出的四個檔案。
- 〔記錄〕工作區原有多個未追蹤檔案，維持原狀。git 在此環境會警告無法讀取使用者層級 ignore，命令仍成功。
- 〔記錄〕未決事項：無。

## 5. 實際命令輸出

〔實測〕執行環境與 `node --test` 完整輸出：

```text
node --version: v24.18.0
✔ baseline: setup is idempotent; ping accepts TEST-0000 and rejects a bad code (30.447ms)
✔ baseline: saveBank/listBanks preserve content and split JSON above 45000 characters (13.6703ms)
✔ baseline: badges union earned timestamps across syncs and deduplicate repeats (2.5498ms)
✔ storage bait: appendRow coerces dates/numbers/booleans and records formulas, including headers (1.0393ms)
✔ storage bait: setValues coerces dates/numbers/booleans and records formulas, including headers (0.7981ms)
✔ storage bait: setValue coerces dates/numbers/booleans and records formulas, including headers (0.8982ms)
✔ storage: text format, rectangular reads, defensive copies, deleteRow and clear preserve formats (1.6367ms)
✔ clock bait: vm Date constructors, Date.now, instanceof and cache TTL use the same clock (1.2368ms)
✔ clock integration: existing backend daily keys and stored Dates follow Taipei midnight (2.3589ms)
✔ utilities: timezone tokens, UTF-8 base64, signed digest/HMAC bytes and UUID (2.2826ms)
✔ utilities: injected hash adapter receives inputs and its bytes are signed (0.9691ms)
✔ concurrency bait: real lock defers until runDeferred (3.05ms)
✔ concurrency bait: none lock allows immediate nested execution (2.6506ms)
✔ hooks run before both reads and writes; real mode does not defer unlocked requests (2.0552ms)
✔ busy bait: saveBank returns ok:false without throwing, and error text is searchable in logs (2.9281ms)
✔ source injection: tryLock busy result, property strings and all console levels are observable (1.0281ms)
✔ source injection: removing the lock exposes an interleaving that the real lock prevents (4.5042ms)
✔ test\fake-gas.js (58.5087ms)
ℹ tests 18
ℹ suites 0
ℹ pass 18
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 201.1696
exit code: 0
```

〔實測〕變更範圍複核：

```text
git diff --exit-code -- Code.gs index.html

exit code: 0 (no diff)
git status --short --untracked-files=all
warning: unable to access 'C:\Users\kyo18/.config/git/ignore': Permission denied
?? .claude/hooks/__pycache__/_handoff.cpython-312.pyc
?? .claude/hooks/_handoff.py
?? .claude/hooks/archive_round.py
?? .claude/hooks/check_acceptance.py
?? .claude/hooks/check_memory.py
?? .claude/hooks/check_report.py
?? .claude/hooks/check_sync.py
?? .claude/hooks/guard_bash.py
?? .claude/hooks/guard_edit.py
?? .claude/hooks/log_bash.py
?? .claude/hooks/session_context.py
?? .claude/settings.json
?? .mcp.json
?? BDD_TEAM_MODE.md
?? CLAUDE.md
?? DOCS_STANDARD.md
?? HANDOFF.md
?? MEMORY.md
?? MODEL_BINDING.md
?? QA_PHASE.md
?? REPORT.md
?? REVIEW_TEMPLATE.md
?? STANDARDS_MAP.md
?? docs/REWARD-CONTRACT.md
?? docs/dispatch/DESIGN.html
?? docs/dispatch/ORCH_PROMPT.md
?? docs/dispatch/RESEARCH.md
?? docs/dispatch/SPEC.md
?? docs/dispatch/request.json
?? package.json
?? review.py
?? test/backend.test.js
?? test/fake-gas.js
?? 工單類型與切割檢核.md
?? 開案檢核表.md
exit code: 0
```
