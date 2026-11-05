# 工單 HANDOFF

> Orchestrator 每輪填寫,交給 Executor。Executor 只做本工單範圍內的事。

## 任務編號
T-003 第 1 輪

## 任務類型
整合輪(安全:小孩裝置上就有邀請碼,家長權限只靠這層)

## 難度評分
錯誤成本高、推理深度中、判斷空間低 → 標準生成層|Codex 預設模型

## 任務描述
後端家長憑證與玩家管理:PEPPER、一次性設定碼、PIN 雜湊、連錯鎖定、session;以及要 session 才能呼叫的 `playerDisable`、`playerRestore`、`playerPurge`。只改後端與測試,不動 index.html。

## 涉及檔案
- `Code.gs`
- `test/backend.test.js`
- `REPORT.md`

## 具體步驟
1. 讀 `docs/REWARD-CONTRACT.md` 第三、六節與 `docs/dispatch/SPEC.md` 的「Script Properties」、「後端 action」。
2. `setup`:沒有 `PEPPER` 才產生(32 位元組亂數的 hex,用兩個 `Utilities.getUuid()` 去掉 `-` 串接即可,共 64 個 hex 字元);已有不覆蓋。
3. 管理者 action(放在現有 `adminPending` 那一區,一樣比對 `ADMIN_TOKEN`,token 錯回 `bad_token`):
   - `adminIssueSetupCode {token, family}`:家庭要存在;產生 8 碼設定碼(字元集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`,用 `Utilities.getUuid()` 的位元組取,不要用 `Math.random`),`pinsetup:<邀請碼>` 存它的 SHA-256 hex,回 `{ok:true, setupCode}`。重發會蓋掉舊的。
   - `adminResetPin {token, family}`:刪 `pin:`、`pinfail:`、`pinsetup:`,回 `{ok:true}`。
4. 家長 action(`fam` 驗過邀請碼之後):
   - `parentStatus`:回 `{ok:true, hasPin, locked, minutes}`。沒有 PIN 時 `needSetup:true`。
   - `parentSetPin {setupCode, pin}`:鎖定中回 `locked`;已有 PIN 回 `pin_exists`;沒有 `pinsetup` 或設定碼錯回 `bad_setup_code` 並累計;PIN 格式錯回 `bad_pin_format`(不累計);成功存 `{salt,h}`、刪 `pinsetup`、歸零 `pinfail`,回 `{ok:true, session}`。
   - `parentLogin {pin}`:鎖定中回 `locked`;沒有 PIN 回 `no_pin`(不累計);錯回 `bad_pin`;對了歸零並回 `{ok:true, session}`。
   - `parentLogout {session}`:清除快取,回 `{ok:true}`;session 無效也回 `ok:true`。
   - 全部讀寫 `pinfail` 的流程在 `withLock` 內。
5. `requireSession(fam, req)`:依合約第六節驗證,回 `null` 或 `{ok:false, code:'no_session', message:'請重新輸入家長 PIN'}`。
6. 玩家管理(都要 session,都在 `withLock` 內):
   - `playerDisable {session, playerId}`:p1 回 `bad_request`;設狀態「停用」與停用時間。待核准改取消的部分留一個明確接口 `cancelPendingFor(code, pid)`,這張工單先做空函式,T-004 填入。
   - `playerRestore {session, playerId}`:設回「啟用」、清停用時間。
   - `playerPurge {session, playerId}`:p1 回 `bad_request`;只處理本家庭:刪除玩家列、徽章表該玩家列、徽章入帳該玩家所有列(唯一會刪入帳表的地方)、所有題庫 JSON 的 `players[pid]`(用 `putBank(fam, bank, true)` 寫回)、`ledgerinit:<邀請碼>:<pid>` 屬性。兌換表由 T-004 接上,同樣留接口 `purgeRedeemsFor(code, pid)` 先做空函式。回 `{ok:true}`。
7. `playerList` 不需要 session。回應不得多出任何憑證欄位。
8. 補測試(編號寫在測試名稱),寫 `REPORT.md`。

## 驗收標準(全部達成才算完成)
- [ ] [測試] `node --test` 全數通過
- [ ] [測試] B1:沒發過設定碼不能設 PIN;錯的設定碼不能設;對的設一次成功;同一設定碼再用回 `pin_exists`;`adminResetPin` 後舊設定碼失效
- [ ] [測試] B2:連錯 5 次後第 6 次用正確 PIN 也回 `locked`,`minutes` 為 15;過 14 分 59 秒仍鎖,`minutes` 為 1;過 15 分可登入,且 `pinfail` 歸零。第 4 次錯時 `left` 為 1
- [ ] [測試] B2 延伸:設定碼錯也累計,5 次後連對的設定碼也被拒
- [ ] [測試] B3:跑完一輪設 PIN、登入、登出、失敗之後,把 `env.props` 全部值、`env.logs` 全部、所有工作表儲存格、除了登入/設定回應 `session` 欄位以外的回應串接起來搜尋:找不到測試用 PIN、設定碼、session token、PEPPER。`pin:` 屬性只含 `salt`、`h`
- [ ] [測試] B3 誘餌:同一個 PIN、不同家庭得到不同雜湊;改 PEPPER 後原 PIN 無法登入
- [ ] [測試] B4(本單範圍):沒有 session、亂數 session、別家庭的 session 呼叫 `playerDisable`、`playerRestore`、`playerPurge` 都回 `no_session`,資料不變
- [ ] [測試] session 過 30 分鐘失效(29 分 59 秒還有效);`parentLogout` 後立刻失效;`adminResetPin` 後舊 session 失效;使用中不會延長 TTL
- [ ] [測試] A3(後端部分):停用後 `playerList` 排在最後、`saveBank`/`badges` 帶該玩家回 `player_disabled`;還原後恢復;p1 停用、永久刪除都回 `bad_request`
- [ ] [測試] A4(本單範圍):永久刪除 p2 後,玩家表、徽章表、徽章入帳、所有題庫 JSON、Script Properties 都搜不到該 pid;p1 與同家庭其他玩家、別家庭的同名資料都不變;舊裝置再帶該 pid 的 `saveBank` 不會救回
- [ ] [測試] 沒跑 setup(沒 PEPPER)時 `parentLogin` 回 `server_error` 且不自動產生 PEPPER;`ping` 等舊 action 照常
- [ ] [測試] `adminIssueSetupCode` token 錯回 `bad_token`,不產生設定碼;家庭不存在回 `not_found`
- [ ] [複核] `index.html` 沒有變更

## 假設與未知
- 假設:設定碼與 PIN 共用同一組 `pinfail`。沒有設定碼也會累計,這樣小孩亂猜不會讓攻擊面變大,最壞是家長要等 15 分鐘。
- 假設:鎖定是針對整個家庭,不是針對裝置。小孩可以故意把家長鎖 15 分鐘,這是可接受的取捨(SPEC 指定)。
- 假設:session 不滑動,家長操作 30 分鐘後要重輸 PIN。
- 遇到未知:選保守方案(拒絕)、記到 REPORT.md「偏離事項」、繼續,不得擴大範圍。

## 禁止事項
- 不得修改「涉及檔案」以外的檔案;不得新增相依;不得連線真實服務;不得啟動瀏覽器
- 不得 git commit、git push
- 任何 `console.*`、回應、試算表不得出現 PIN、設定碼(發碼回應除外)、token、PEPPER
- 不得加任何「僅供測試」的參數來繞過鎖定或 session;測試一律靠可控時鐘(邊界軟化即硬傷)
- 不得在 repo 放真實金鑰、PIN;測試的 PIN 用明顯的假值
- 最簡解原則:能少寫就少寫

## 上下文 / 已知的坑
- `Utilities.computeHmacSha256Signature(value, key)` 回傳有號位元組陣列,要自己轉 hex(`(b & 255)`)。
- `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str)` 同型。
- `doPost` 最外層 `catch` 有 `console.error(err)`,不可以把含機密的字串放進 Error message。

## 完成後回報格式(寫入 REPORT.md)
1. 修改了哪些檔案(逐一列出)
2. 每條驗收標準的達成狀況與證據(指令輸出)
3. **偏離事項**(必填章節,沒有偏離就明確寫「無偏離」;缺這章節視為回報不完整)
4. 遇到的問題與未決事項
每項關鍵陳述標〔實測〕〔記錄〕〔推測〕。
