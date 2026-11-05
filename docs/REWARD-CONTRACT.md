# 家長權限與徽章兌換：資料合約（實作用）

SPEC.md 沒寫死、但實作一定要一致的決定都在這裡。SPEC.md 與這份衝突時以 SPEC.md 的驗收條件為準，並回報偏離。

## 一、試算表的坑（一律遵守）

1. **Sheets 會自動轉型**：`appendRow`／`setValues` 寫入 `2026-11-02` 會變 Date、`123` 變數字、`TRUE` 變布林。所有文字欄位讀回時一律正規化，週鍵讀回若是 Date 要轉回 `yyyy-MM-dd`（台北時區）再比對。
2. **公式注入**：使用者文字（暱稱、獎項名稱、拒絕原因）寫入前經 `safeCell(s)`：開頭是 `= + - @` 或 `'` 時前面加一個 `'`。同時也用於任何前端傳來、寫進儲存格的文字欄位。
3. **ID 欄位驗格式**：`playerId` `^p[a-z0-9]{1,12}$`；`rewardId`、兌換 `id` `^[A-Za-z0-9_-]{1,40}$`；`requestId` `^[A-Za-z0-9_-]{8,64}$`；徽章鍵沿用現有 `^[\w\-]{1,80}$`。不符回 `bad_request`，不寫入。
4. **所有查找都要帶家庭**：任何列都要比對邀請碼，別的家庭的列一律當不存在（`not_found`）。

## 二、鎖

`withLock(fn)`：`LockService.getScriptLock().waitLock(10000)`，拿不到回 `{ok:false, code:'busy', message:'系統忙碌，請再試一次'}`；`finally` 釋放；鎖內不呼叫 UrlFetch。寫入後釋放前 `SpreadsheetApp.flush()`。

## 三、玩家

- `playerId` 由後端產生：`'p'`＋`Utilities.getUuid()` 去掉 `-` 的前 8 碼小寫。**不重複使用 ID**（舊裝置的 `p2:` 快取不可以對到新玩家）。p1 是固定 ID。
- 圖示白名單（12 個）：🌱🦊🐢🐳🦄🚀🐼🐰🦖🐝🌈⭐。不在名單內回 `bad_request`。
- 暱稱 trim 後 1–12 字。一個家庭最多 12 位玩家（常數 `MAX_PLAYERS`），超過回 `player_limit`。
- **p1 不能停用也不能永久刪除**（舊前端永遠以 p1 寫入）；只能改名、改圖示。回 `bad_request`。
- `req.playerId` 空白＝p1。帶了但不屬於這個家庭回 `bad_player`；停用中的玩家，寫入類（`redeemRequest`、`playerSave` 以外的同步寫入）回 `player_disabled`。
- 閱讀碼使用者沒有玩家，也不入帳：`badges` 以閱讀碼呼叫時行為完全不變。

## 四、題庫 JSON

- 頂層 `rec` `days` `summary` `badge` 是 p1；其他玩家在 `players[pid] = {rec, days, summary, badge, updatedAt}`。
- 新增頂層 `p1At`：p1 進度最後變動的毫秒時間（舊資料沒有時以 `updatedAt` 代替）。
- `saveBank`（整段在鎖內，含 `mergeChecks`）：
  - **沒帶 `players`（舊前端）**：頂層照收（行為同現在），`p1At` 設成傳入的 `updatedAt`；`players` 保留雲端原本的。
  - **有帶 `players`（新前端）**：題目等內容仍以傳入為準；p1 的 `rec/days/summary` 比 `p1At`（傳入 ≥ 雲端才採用傳入）；p1 與每位傳入玩家的 `badge` 用既有 `mergeBadgeRec`（earned 取聯集）；其他玩家 `rec/days/summary` 比各自 `updatedAt`（傳入 ≥ 雲端才採用傳入）。沒有傳入的玩家保留雲端。
  - **傳入的 pid 不在玩家表或已停用：丟棄該筆**，保留雲端（防止舊裝置把永久刪除的玩家救回來）。
- `listBanks` 照舊回傳完整 JSON（含 `players`）；`libGet` 維持只回練習內容，不得含 `players`。

## 五、徽章表與入帳

- 「徽章」表第 5 欄「玩家ID」，空白＝p1。以 代碼＋玩家ID 找列。
- 「徽章入帳」欄位順序：`家庭, 玩家, 徽章鍵, at, 顏色(銀/金), 入帳時間, 異常, 數量, 來源`。SPEC 的欄位後面多 `數量`（空白＝1，調整列為負）與 `來源`（`同步`／`補入`／`調整`）。
- 唯一鍵＝家庭＋玩家＋徽章鍵＋at。已存在（含異常列）一律跳過：異常列不會日後自動轉正，否則上限會被隔天繞過。
- 新入帳檢查順序：`at > now + 5 分鐘` → 異常「時間異常」；當日（台北）該玩家 `來源=同步`、異常空白的列已達 `DAILY_BADGE_CAP`=10 → 異常「超過每日上限」；否則正常。異常列不計入餘額，但要留列，家長紀錄看得到。
- **補入（F2）**：每位玩家第一次入帳時（Script Property `ledgerinit:<邀請碼>:<pid>` 不存在），在鎖內把雲端已存的 earned（所有題庫的該玩家 badge＋徽章表）補進來，`來源=補入`，不計每日上限（`at` 超前仍標異常），然後設定該屬性。**只有 p1 的第一次同步**連同這次傳入的 earned 也算補入；其他玩家本來就沒有舊資料，傳入一律走上限，否則新增玩家就能無限灌。
- 餘額只看入帳表，題庫被刪、earned 被截到 500 筆都不影響。

## 六、家長憑證

- `HMAC`：`Utilities.computeHmacSha256Signature(salt+PIN, PEPPER)` 轉 hex。PIN 必須 `^\d{4,6}$`。
- PEPPER 只在 `setup` 產生（不覆蓋既有）。缺 PEPPER 時家長 action 回 `server_error`＋「請管理者執行 setup」，不在請求中產生。
- 設定碼錯、PIN 錯都累計 `pinfail`；鎖定中連正確值都拒絕，回 `{ok:false, code:'locked', minutes:n}`（n 無條件進位）。PIN 錯回 `{ok:false, code:'bad_pin', left:n}`；設定碼錯回 `{ok:false, code:'bad_setup_code', left:n}`。讀寫 `pinfail` 在鎖內。
- 已有 PIN 時 `parentSetPin` 回 `pin_exists`。
- Session：Cache `ps:<SHA256(token) hex>` 值為 `<邀請碼>|<該 PIN 的 salt>`，TTL 1800 秒，不滑動。驗證時比對邀請碼與目前 PIN 的 salt，所以 `adminResetPin` 會讓舊 session 全部失效。要 session 的 action 參數名 `session`，無效回 `no_session`。
- 任何 `console.*`、回應、試算表都不得出現 PIN、session token、PEPPER（`parentLogin`／`parentSetPin` 回應的 `session` 除外）。

## 七、兌換

- 週鍵：`t = 時間毫秒 + 8 小時`，用 UTC 方法取星期（週一＝0），減去天數，取 `yyyy-MM-dd`。純算術，不用 `YYYY-ww`。台灣沒有日光節約。
- 計算餘額：`可用銀 = Σ(銀、異常空白的列 × 數量) − Σ(核准＋待核准 的實扣銀)`，金同理。另回傳 `保留銀/金`（待核准實扣）、`累計銀/金`（入帳總和）。
- 實扣：先 `金 ≥ 金價` 才有多的金可抵。`實扣銀 = min(可用銀, 銀價)`，`差 = 銀價 − 實扣銀`；可抵時 `實扣金 = 金價 + 差`；不可抵且 `差 > 0` 視為不足。
- 不足原因文字逐字：只缺金 `還差金 n`；只缺銀 `還差銀 n`；都缺 `還差銀 a、金 b`。可抵開著時，先扣金價，剩下的金抵銀，抵完還缺的才算「還差銀」。額度用完 `本週額度用完，下週一再來`。停用獎項回 `reward_disabled`。
- `redeemRequest`：requestId 已存在且同家庭同玩家 → 回原筆（`duplicate:true`）；已存在但屬於別人 → `bad_request`，不得回傳別人的列。
- 回應 code：`insufficient`（附 `reason`）、`quota`、`conflict`（附目前 `status`）、`not_found`、`reward_disabled`、`busy`。
- `redeemDecide`：核准前重算，可用銀或金 < 0 回 `insufficient`，狀態不變。同決定重送回 `{ok:true, already:true}`，不寫紀錄。

## 八、前端

- 製作時完全不引入框架。正式 `index.html` **不含任何假後端程式**；假後端只由 `npm run build` 注入 `dist/index.html`。
- 切換玩家：等待未完成的儲存後寫入 `player`，再 `location.reload()`，避免殘留全域狀態。
- 玩家相關 localStorage（`badges`、`progress-*`、`lib-rec:*`、`g3plants-rec`）在 `store` 這一層統一加前綴，p1 不加。其餘（`family`、`player`、`ui-style`…）不加。
- `playerList` 成功時，刪除本機不在清單內的玩家的 `pid:` 鍵（A4）。
- session token 只放記憶體變數，不進 localStorage。
