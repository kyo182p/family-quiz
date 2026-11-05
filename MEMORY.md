# 專案記憶 MEMORY

> 外部記憶,跨輪次共用。Orchestrator 每輪結束必須更新。新資訊寫最上面。
> 便利貼牆,不是日誌:只留當前有效條目(上限約 30 條,`.claude/hooks/check_memory.py` 每輪驗收收尾會檢查),細節翻 rounds/ 歸檔。**每輪新增條目前先刪/合併至少一條過期條目,「完成:」條目下一輪要降級成一行摘要。**

## 專案概況
GitHub Pages 單檔 `index.html`＋Apps Script `Code.gs`＋Google 試算表。main 的 Pages 就是正式站,合併 PR＝上線,由使用者手機實測後自己按。資料合約見 `docs/REWARD-CONTRACT.md`。

## 目前狀態
- 最後更新:2026-11-06 fq-reward 第 1 輪 T-001～T-008
- 第一階段功能在本機 `build/fq-reward`,尚未推送、PR 未開(push 被工具權限擋下)。下一步:使用者推送開 PR,雲端跑 `test/e2e/reward.spec.js` 與 Lighthouse,使用者照 `docs/DEPLOY-reward.md` 部署後端、手機實測。

## 已完成
| 任務 | 結果 | 日期 |
|---|---|---|
| T-001～T-004 | 假 Apps Script 環境與後端(玩家、入帳、PIN、兌換) | 2026-11-05 |
| T-005～T-007 | 前端(玩家分流、小孩端、家長端)、build 與假後端 | 2026-11-06 |
| T-008 | 部署說明、README、Playwright 腳本(未實際執行) | 2026-11-06 |

## 採納率(跨輪成效指標;數據源 = rounds/ 歸檔)
- Executor 一次過率:6/8 張(T-002 開修復輪;T-005 的問題併入 T-006)〔實測〕
- 自審(Orchestrator 讀 diff)成立:8 項,都是測試綠燈抓不到的〔實測〕。對抗抽測 4 輪,0 項新問題〔實測〕
- Reviewer 意見成立率:本輪沒有異質審核,不適用

## 降級記錄(欠帳待補救)
- fq-reward T-001～T-008:沒有 GEMINI_API_KEY,全部自審,無異質審核。派工指示允許,未補救;上線前可補一次異質審核。

## 踩過的坑(重要!)
- Sheets 自動轉型:`2026-11-02` 變 Date、`=` 變公式;文字一律經 `safeCell`,讀回正規化。假環境已模擬〔實測於 fake-gas;真 Sheets 未驗〕
- `safeCell('')` 不可以寫單獨的 `'`,否則「異常」欄可能非空,餘額歸零〔推測真 Sheets 行為,一律避開〕
- `node --test` 會把 `test/` 底下所有 js 當測試,e2e 腳本要自己判斷沒有 Playwright 就跳過〔實測,Node 24〕
- 本機題庫快取只能更新原本就有的題庫,否則別台刪除後會被傳回雲端復活〔實測〕
- 這條分支的 upstream 預設指向 `origin/main`:推送一律寫明 `git push origin build/fq-reward`〔實測〕
- Windows cp950:`check_sync.py` 要用 `python -X utf8` 跑〔實測,Python 3.12〕
- `archive_round.py` 遇到工單提到多個 T 編號會拒絕,一律帶 `--label`〔實測〕

## 已忽略的審核意見
-

## 未決事項
- 流程範本檔(CLAUDE.md、.claude/ 等)沒有 commit:內含其他客戶專案名稱,這是公開 repo。要不要納入由使用者決定。
- 尚未做:Playwright 實際執行、Lighthouse、真 Sheets 端到端。
- `rewardList` 每個獎項重讀一次兌換表,獎項多時可能慢。
- 鎖定畫面的分鐘數沒有自動倒數。
