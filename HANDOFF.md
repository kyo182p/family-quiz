# 工單 HANDOFF

> Orchestrator 每輪填寫,交給 Executor。Executor 只做本工單範圍內的事。

## 任務編號
T-004 第 1 輪

## 任務類型
整合輪(資料正確性:餘額算錯或重複扣,整個獎勵系統就不可信)

## 難度評分
錯誤成本高、推理深度高、判斷空間低 → 深推理層|Codex 預設模型

## 任務描述
後端獎勵與兌換:`rewardList`、`rewardSave`、`balance`(接上保留與已扣)、`redeemRequest`、`redeemCancel`、`myRedeems`、`redeemList`、`redeemDecide`、家長紀錄;填入上一張留的 `cancelPendingFor`、`purgeRedeemsFor`。只改後端與測試,不動 index.html。

## 涉及檔案
- `Code.gs`
- `test/backend.test.js`
- `REPORT.md`

## 具體步驟
1. 讀 `docs/REWARD-CONTRACT.md` 第一、二、七節與 `docs/dispatch/SPEC.md` 的「新增工作表」「計算規則」「後端 action」。合約第七節是實扣與文字的權威。
2. `setup` 補「獎勵」「兌換」「兌換紀錄」表,欄位順序照 SPEC 表格。
3. 實作下列 action。ID 格式照合約第一節;所有列都比對家庭。
   - `rewardSave {session, reward:{id?, name, silver, gold, goldForSilver, weeklyLimit, enabled}}`:要 session。名稱 trim 後 1–20 字;銀、金各為 0–99 的整數且合計 ≥ 1;上限 0–14 的整數。不合法回 `bad_request`。沒有 `id` 就新增(ID 用 `'w'`＋uuid 去掉 `-` 的前 12 碼);帶 `id` 但不屬於本家庭回 `not_found`。回 `{ok:true, reward}`。
   - `rewardList {playerId}`:邀請碼可呼叫。回 `{ok:true, rewards:[{id,name,silver,gold,goldForSilver,weeklyLimit,enabled,weekUsed,weekLeft,canRedeem,reason,pay:{silver,gold}}], balance}`。小孩端只回啟用中的。帶有效 `session` 時回全部(含停用),供家長管理,此時 `canRedeem` 等欄位仍依 `playerId` 計算。`weekLeft` 在上限 0 時為 `null`。`reason` 是合約第七節的逐字文字,可換時是空字串。`pay` 是若現在申請的實扣。
   - `balance {playerId}`:`silver`、`gold` 各回 `{available, held, total}`。
   - `redeemRequest {playerId, rewardId, requestId}`:整段鎖內。順序:requestId 查重 → 玩家啟用 → 獎項存在且啟用 → 次數 → 計算實扣與餘額 → 寫入兌換列(狀態「待核准」、版本 1、週鍵用**現在**時間)與紀錄列(舊狀態空白、新狀態待核准、操作者 child)→ flush。回 `{ok:true, redeem, balance}`。
   - `redeemCancel {playerId, id}`:只能取消自己這位玩家的。不是待核准回 `conflict`(已取消回 `{ok:true, already:true}`)。紀錄操作者 child。
   - `myRedeems {playerId}`:回該玩家所有申請,新的在前。
   - `redeemList {session, status?}`:要 session。回本家庭申請(預設只回待核准),新的在前,每筆附 `playerName`、`playerIcon`、目前的 `balance`、`weekUsed`(該玩家該獎項**當前週**已用)。並回 `pendingCount`。
   - `redeemDecide {session, id, decision:'approve'|'reject', reason}`:要 session。鎖內重讀;已是同決定回 `{ok:true, already:true}`,不寫紀錄;是其他終態回 `{ok:false, code:'conflict', status}`。核准時重算,可用銀或金 < 0 回 `insufficient`,狀態不變。拒絕原因 trim 後最多 40 字(超過截斷)。更新決定時間、版本加 1,寫紀錄(操作者 parent)。
   - `parentLog {session}`:要 session。回 `{ok:true, entries}`:最近 50 筆決定(兌換紀錄中新狀態為核准/拒絕者,附玩家暱稱、獎項名稱快照)與該家庭入帳異常列(玩家、徽章鍵、at、顏色、異常原因),各自新的在前。
4. `playerBalance`:依合約第七節接上兌換表。`rewardList`、`redeemRequest`、`redeemDecide` 計算前都先 `syncLedger(code,pid,{})` 確保補入完成。
5. `cancelPendingFor`:把該玩家的待核准改為取消,寫紀錄(操作者 parent)。`purgeRedeemsFor`:刪除該玩家的兌換列,以及對應兌換ID 的兌換紀錄列。
6. 所有文字欄位(名稱快照、拒絕原因、週鍵、狀態、requestId…)寫入都經 `safeCell`。週鍵讀回時可能是 Date(舊資料或手動編輯),比較前一律正規化成 `yyyy-MM-dd`。`金可抵銀` 欄布林值用 `isTrue` 讀。
7. 補測試(編號寫在測試名稱),寫 `REPORT.md`。

## 驗收標準(全部達成才算完成)
- [ ] [測試] `node --test` 全數通過
- [ ] [測試] B4:沒有 session 呼叫 `rewardSave`、`redeemDecide`、`redeemList`、`parentLog` 都回 `no_session`,資料不變
- [ ] [測試] C2:每週上限 2,第 3 次回 `quota`,reason 為 `本週額度用完，下週一再來`。以台北時間 2026-11-08(日)23:59:59 申請、2026-11-09(一)00:00:00 核准:週鍵仍是 `2026-11-02`,新的一週額度完整。下週一可再申請
- [ ] [測試] 週鍵邊界:台北 2026-11-09 00:00:00 的週鍵是 `2026-11-09`;台北 2026-11-08 23:59:59 是 `2026-11-02`;UTC 2026-11-08 16:00:00 視為台北週一。週鍵寫入後讀回仍能正確計次(驗證假環境轉型沒有破壞比對)
- [ ] [測試] D2:送出後可用立刻減少、保留增加、狀態待核准;拒絕後退回;取消後退回
- [ ] [測試] D3:同 requestId 送兩次只產生一列,第二次回原筆與 `duplicate:true`;別的玩家用同一個 requestId 回 `bad_request`,回應不含別人的資料
- [ ] [測試] D4:種子固定的隨機交錯 200 次。每次在 `onSheetOp` 內隨機插入多個申請、核准、拒絕、取消,跑完 `runDeferred` 後驗證:每位玩家可用銀、可用金 ≥ 0;每週已用 ≤ 上限;每筆申請的狀態轉移合法
- [ ] [測試] D5:兩位家長同時核准同一筆,實扣只算一次;後到的若決定相同回 `already`,若決定不同回 `conflict`;紀錄表只有一筆決定
- [ ] [測試] D7:只銀、只金、銀＋金三種獎項,`rewardList` 與 `redeemList` 顯示的枚數一致
- [ ] [測試] D8:金可抵銀開著,有銀 1、金 2、獎項要銀 2 → 可申請,實扣銀 1＋金 1。關掉時同情況不能申請,reason 為 `還差銀 1`。有銀 5、金 0、獎項要金 1 → 不能申請,reason 為 `還差金 1`(銀不能抵金)。有銀 0、金 1、獎項要銀 2、可抵 → reason 為 `還差銀 1`。有銀 0、金 0、獎項要銀 1＋金 1、可抵 → reason 為 `還差銀 1、金 1`。有銀 0、金 2、獎項要銀 2＋金 1、可抵 → reason 為 `還差銀 1`
- [ ] [測試] D9:拒絕或取消退回的銀、金與當初實扣一致;核准後才改獎項價格,或申請後改價格與關掉金可抵銀,都不影響已送出的申請
- [ ] [測試] H1:用 `lockMode:'none'` 跑 D4/D5 的情境,測試斷言**必須**失敗(用「預期失敗」的方式寫,記錄實際違反了哪一條);用 `options.source` 把 requestId 查重函式覆寫成永遠找不到,D3 **必須**失敗。兩個反證都要寫成會跑的測試
- [ ] [測試] A3 接上:停用玩家時他的待核准變取消、餘額退回;還原後不會變回待核准。停用中的玩家申請回 `player_disabled`
- [ ] [測試] A4 接上:永久刪除後兌換、兌換紀錄都搜不到該玩家的列與兌換ID;別的玩家的不受影響
- [ ] [測試] 對抗:獎項名稱 `=HYPERLINK("x")`、拒絕原因 `+cmd`、`@a` 不進 `env.formulaCells`,讀回與輸入相同;別家庭的獎項不能申請(`not_found`);別家庭的兌換 ID 不能決定、不能取消
- [ ] [測試] 價格驗證:銀 0 金 0、銀 100、金 -1、銀 1.5、上限 15、名稱 21 字、名稱全空白都回 `bad_request`
- [ ] [測試] 負數調整列使可用變負時,`redeemDecide` 核准回 `insufficient`,新的 `redeemRequest` 被拒,`available` 回報真實數字
- [ ] [測試] `lockMode:'busy'` 時 `redeemRequest`、`redeemDecide` 回 `busy`,沒有寫入
- [ ] [複核] `index.html` 沒有變更

## 假設與未知
- 假設:獎項只能停用,不提供刪除(SPEC 只寫新增/修改/停用)。
- 假設:停用獎項時既有待核准不變,家長仍可決定。
- 假設:核准與否不影響週鍵,週鍵永遠是申請當下。
- 假設:SPEC 的「本週已換」以當前週、該玩家、該獎項計;不同獎項的額度各自獨立。
- 未知:D4 的隨機插入可能因為 `real` 模式全部排隊而看起來過於簡單,這正是鎖的效果;反證測試負責證明沒有鎖會壞。若 `none` 模式跑不出違反,調整插入點(例如在讀完餘額之後的寫入前),不得把斷言改鬆。
- 遇到未知:選保守方案(不讓餘額變多、不讓次數超限)、記到 REPORT.md「偏離事項」、繼續,不得擴大範圍。

## 禁止事項
- 不得修改「涉及檔案」以外的檔案;不得新增相依;不得連線真實服務;不得啟動瀏覽器
- 不得 git commit、git push
- 不得新增撤銷已核准、手動加減徽章、匯出等 SPEC 列為「不做」的功能
- 不得為測試在 Code.gs 加任何開關;反證一律用 `options.source`、`lockMode` 在測試層完成
- 不得放寬既有測試或安全檢查
- 最簡解原則:能少寫就少寫

## 上下文 / 已知的坑
- `playerBalance` 目前在 `Code.gs` 尾段,`held`、`available` 尚未扣兌換。
- `cancelPendingFor`、`purgeRedeemsFor` 是空函式,呼叫端已持鎖。
- `balance` 的 action 目前已呼叫 `syncLedger` 再算餘額。
- 上一張的鎖交錯經驗:`onSheetOp` 在讀家庭表時尚未取得鎖,要在鎖內的工作表操作才看得到 deferred。

## 完成後回報格式(寫入 REPORT.md)
1. 修改了哪些檔案(逐一列出)
2. 每條驗收標準的達成狀況與證據(指令輸出)
3. **偏離事項**(必填章節,沒有偏離就明確寫「無偏離」;缺這章節視為回報不完整)
4. 遇到的問題與未決事項
每項關鍵陳述標〔實測〕〔記錄〕〔推測〕。
