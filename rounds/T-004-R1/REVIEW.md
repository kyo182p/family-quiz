# REVIEW T-004 第 1 輪

自審(環境沒有 GEMINI_API_KEY,依派工指示不走異質審核)

- 〔實測〕`node --test` 70/70 通過,Orchestrator 親自重跑;Code.gs diff 全文讀過;H1 三個反證都確實用 `assert.throws` 要求違反。
- 〔實測〕對抗抽測(Executor 未寫過):週鍵被手動改成 Date 仍算進額度;別的玩家不能取消;41 字 emoji 原因截到 40 字且不切半;核准後不能取消或改拒絕且餘額不動;價格字串、null、1e400、路徑式 ID 全被拒;小孩端清單不含邀請碼、看不到停用獎項、亂數 session 也看不到;餘額守恆(入帳＝可用＋保留＋已核准)。全數通過。
- 問題(不擋本輪,併入 T-005):T003 A4 測試 `includes('p2')` 碰到隨機 ID 以 p2 開頭會誤判,約 1/16 機率。
- 建議(不打回):`rewardList` 每個獎項重讀一次兌換表,獎項多時會慢;拒絕用的 reason `reward_disabled` 是代碼,前端要對映成白話。
