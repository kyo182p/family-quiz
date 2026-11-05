# T-006 第 1 輪執行回報

〔記錄〕日期：2026-11-06（Asia/Taipei）。已讀 HANDOFF.md、SPEC 畫面 2–4 與設計規則、DESIGN.html 第 1–410 行。完成本輪小孩端獎勵兌換整合與自動驗收；手機人工驗收依工單留待雲端。

## 1. 修改檔案

- 〔記錄〕index.html：bsLoad 只更新本機原有題庫；開站不要求玩家餘額，玩家底板才帶 withBalance。新增首頁入口、銀金錢包、獎勵／我的申請分頁、申請及取消確認底板、UUID 重送與防連按、載入／離線／空清單、伺服器拒絕提示。使用 DESIGN 的徽章 SVG、現有色票與元件；API 錯誤保留額外欄位。
- 〔記錄〕test/frontend.test.js：從假 fetch 安裝時開始記錄開站請求，新增 9 項 T006 jsdom 測試。
- 〔記錄〕REPORT.md：本輪修改與驗收回報。
- 〔記錄〕未修改 Code.gs、建置工具、假後端或其他專案檔案；工作區原有 HANDOFF.md 差異及未追蹤檔案未動。未新增相依、啟動瀏覽器、連線真實服務、commit 或 push。

## 2. 每條驗收標準與證據

〔實測〕最後執行 `node --test`：

```text
ℹ tests 93
ℹ suites 0
ℹ pass 93
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7879.3931
```

〔實測〕`git diff --check -- index.html test/frontend.test.js` 無空白錯誤；僅有 Git 的 LF 轉 CRLF 提示。

| 驗收項目 | 結果與證據（下列測試均通過） |
| --- | --- |
| node --test 全通過 | 〔實測〕93 通過、0 失敗，包含既有後端與前端測試。 |
| 雲端專有題庫不落地、不復活；本機原有題庫更新 | 〔實測〕T006 regression: cloud-only banks never cached or resurrected; local originals updated。檢查 custom-banks 無雲端專有 ID；雲端刪除後 bsLoad 未發出該 ID 的 saveBank；另驗本機原有題庫更新為雲端新標題。 |
| 開站 playerList 無 withBalance，玩家底板有帶 | 〔實測〕T006 startup balance opt-in and homepage visibility，直接檢查開站及底板請求。 |
| 首頁邀請碼可見卡片，閱讀碼／無碼不可見 | 〔實測〕同上測試，分別斷言三種狀態。 |
| D1：三種需要、你有、週額度、不足停用 | 〔實測〕T006 D1: three costs, wallet, backend reasons, unlimited and gold substitution。種子銀 5／金 2；檢查只銀、只金、混合價格、保留 0；後端產生「還差金 1」與「下週一再來」且按鈕停用；不限次數不顯示週剩餘；金補銀提示照 pay。 |
| D2：送出後可用下降、保留增加、待核准；取消退回 | 〔實測〕T006 D2 D9: reserve/cancel actual silver and gold, no balance cache。送出後可用銀 0／金 1，保留銀 5／金 1；我的申請顯示「等家長核准」；取消後可用恢復銀 5／金 2，保留各 0。 |
| D6：四狀態、拒絕原因、新的在上 | 〔實測〕T006 D6 XSS: four states, newest first, escaped names/reasons, zero colors omitted。用假後端 API 建立待核准、核准、拒絕及取消，確認指定狀態文字、「家長說：」及新筆排序。 |
| D9：保留銀金分列，退回照實扣 | 〔實測〕D2 D9 測試以標價銀 6、實扣銀 5＋金 1 申請，確認底板、錢包、歷史保留及退回照實扣。D6 同時檢查歷史不顯示 0 的顏色。 |
| D3：連按只一請求；網路失敗重試同 requestId | 〔實測〕T006 D3: double send, lost response manual retry and busy retry retain UUID。連續呼叫處理器兩次只發一請求且立即停用；模擬已寫入但回應遺失，重試同 UUID，最後僅一筆申請；busy 自動重試一次也同 UUID。另驗 getRandomValues 備援 UUID v4 格式。 |
| G2：slow 骨架、offline 無數字及可按申請、empty 提示 | 〔實測〕T006 G2: slow skeleton, offline without numbers or apply, empty rewards。slow 立即有兩格錢包與一卡片骨架；offline 顯示指定錯誤及重試、錢包空且無申請鈕；empty 顯示「還沒有獎勵，請家長新增」。 |
| XSS：獎項名與拒絕原因以文字顯示 | 〔實測〕D6 XSS 測試確認 `<img src=x onerror=alert(1)>`、`<b>原因</b>` 原文可見，清單沒有 img／b 元素。 |
| 正式 index.html 不含假後端字串 | 〔實測〕既有 T005 build: mock only, CONFIG bait, root clean, every inline script compiles，檢查正式頁不含 mock://gas、createGasEnv，並編譯原始與測試建置版內嵌 script。 |
| 390×844、375×667 版面與觸控大小 | 〔記錄〕待雲端人工驗收；依工單「本機不驗」「不得啟動瀏覽器」未執行。jsdom 通過不等於視覺／觸控驗收通過。 |

〔實測〕額外 T006 race: late rewardList or myRedeems cannot replace active tab or homepage 通過：舊 rewardList 延遲後不覆蓋新分頁；myRedeems 延遲後不覆蓋已返回的首頁。

〔實測〕額外 T006 server rejections refresh with plain messages; cancellation conflict; disabled fallback 通過：insufficient／quota 顯示後端 reason；reward_disabled／not_found 顯示指定文字並刷新；取消 conflict 顯示「家長剛剛已經決定了」並刷新；p2 的 player_disabled 走既有 p1 回退。

## 3. 偏離事項

〔記錄〕無偏離。實際保留欄位名稱為 balance.silver.held／balance.gold.held，依工單以 Code.gs 契約為準。人工手機驗收依工單留待雲端。家長 API 只用於測試造資料，未製作家長頁。

## 4. 遇到的問題與未決事項

- 〔記錄〕假後端造資料需用 rewardSave 的 `{session,reward:{...}}`、redeemDecide 的 approve／reject，已按實際契約修正測試，未改後端。
- 〔記錄〕無需要後端新增的欄位或功能。
- 〔記錄〕未決事項：雲端確認兩種手機尺寸的版面、橫向捲動及觸控大小；結果取得前不宣稱全部人工驗收完成。
