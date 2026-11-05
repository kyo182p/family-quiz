# T-007 第 1 輪執行回報

〔記錄〕日期：2026-11-06（Asia/Taipei）。已讀 HANDOFF.md、SPEC 畫面 5–10／設計規則／法律與標示、DESIGN.html 第 1–223 與 411–600 行，並依 Code.gs 的實際參數接線。家長端實作與本機自動驗收完成；工單指定的手機人工驗收仍待雲端確認，未宣稱全部驗收結案。

## 1. 修改檔案

- 〔記錄〕`index.html`：新增 `#parent` 路由、PIN 鍵盤、首次設定、四分頁、待核准決定、獎項表單、玩家停用／還原／永久刪除、紀錄及告知文字。新增亮／暗／黑板家長色票、44px 點擊區與 60px PIN 鍵。Session 只留在 `let PARENT_SESSION=null` 的記憶體變數，背景、閒置與伺服器驗證失效均上鎖，並盡力登出。
- 〔記錄〕`test/frontend.test.js`：新增 11 個名稱帶 T007／驗收編號的 jsdom 測試，使用既有假後端；測試 helper 新增 iframe 情境。涵蓋登入、上鎖、資料管理、競態、離線與 XSS。
- 〔記錄〕`REPORT.md`：寫入本輪修改、逐條驗收證據、偏離事項與未決事項。
- 〔記錄〕未修改 Code.gs 或上述三檔以外的專案檔案。原有 HANDOFF.md 差異及未追蹤檔案保留。未新增相依、啟動瀏覽器、連線真實服務、commit 或 push；測試建置輸出使用既有 helper 的暫存目錄，不改 dist。

## 2. 每條驗收標準與證據

〔實測〕最終執行 `node --test | Select-Object -Last 21`，指令退出碼 0，測試摘要如下；前一輪直接執行 `node --test` 亦為 104／104 通過。

```text
✔ T007 setup: validation stays local, wrong code left, weak PIN second submit, pin_exists refresh
✔ T007 PIN: six auto, four confirm, dots only, lock at five and no more login requests
✔ T007 B5: memory-only session, hidden clears DOM/logs out; idle reset and no_session lock
✔ T007 B5 race: late login and list after lock never restore session or protected DOM
✔ T007 C1 D7: reward form ranges/preview, child consistency, edit/disable still visible to parent
✔ T007 E1 D7: pending facts/snapshots, approve once, reject reason reaches child, badge vanishes at zero
✔ T007 E1: gold substitution, busy retries once, conflict refresh and insufficient retry
✔ T007 A3 A4: p1 protected, disable/restore ordering, exact purge name, pid keys and active fallback
✔ T007 G2 routing, offline/retry without stale data, notice sentences, iframe placeholder hidden
✔ T007 XSS: player/reward/rejection and anomaly text escaped in all parent views
✔ T007 routing race: late homepage cannot replace PIN; old no_session cannot lock a new login
ℹ tests 104
ℹ suites 0
ℹ pass 104
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9618.2421
```

〔記錄〕下表按 HANDOFF.md 的驗收清單順序逐條對應，測試名稱以上述指令輸出為準。

| # | 驗收標準 | 狀況及證據 |
| --- | --- | --- |
| 1 | `node --test` 全數通過 | 〔實測〕104 通過，0 失敗／取消／略過，含既有 93 項與新增 11 項。 |
| 2 | 首次設定成功、格式與重複輸入驗證、錯設定碼 | 〔實測〕T007 setup：MOCK2345 進主畫面；兩次不同與不足四位不送 parentSetPin；錯設定碼顯示剩 4 次；弱 PIN 第一次提示、第二次可送；pin_exists 重新取得狀態。 |
| 3 | PIN 六位自動送、四位確認、錯誤次數與五次鎖定 | 〔實測〕T007 PIN：五位只填圓點，第六位自動登入；另一家庭以四位 PIN 按確定登入；錯五次顯示 15 分鐘，數字／刪除／確定全停用，點擊不再送登入。 |
| 4 | B5 背景／閒置／no_session 上鎖 | 〔實測〕T007 B5：hidden 後 session 為 null、玩家 DOM 清除、回 PIN 且有 parentLogout；攔截 180000ms 計時器，pointer 與 key 各重設、到期上鎖；no_session 同樣上鎖。兩個 race 測試確認晚回登入／清單不會解鎖，舊 session 的 no_session 不影響新登入。 |
| 5 | Session 不進儲存、網址與 DOM | 〔實測〕T007 B5 比對實際 token，不存在 localStorage、sessionStorage、location.href、document.documentElement.outerHTML；T007 PIN 檢查輸入中數字不進 HTML 屬性，僅顯示圓點數。〔記錄〕新增程式沒有憑證 console 輸出。 |
| 6 | C1 獎項新增、修改、停用後兩端一致 | 〔實測〕T007 C1 D7 使用表單新增，確認小孩卡片出現；修改名稱並停用後，家長有虛框列、小孩 rewardList 沒該項。 |
| 7 | D7 只銀、只金、銀金搭配一致 | 〔實測〕T007 C1 D7 驗證小孩卡片三種價格；T007 E1 D7 以真實假後端建立三種申請，逐卡確認家長「需要」的銀金枚數及零色省略；既有 T004 D7 同時驗證後端快照一致。 |
| 8 | E1 待核准資訊與分頁筆數 | 〔實測〕T007 E1 D7 驗證玩家、獎項、需要／保留／可用、本週已換及價格快照；標記從 3 降到 2，決定完後不顯示。T007 E1 另驗證金 1 枚抵銀提示。 |
| 9 | 核准／拒絕／衝突 | 〔實測〕T007 E1 D7 核准立即停用且連點只送一次；展開 40 字原因欄後拒絕，小孩顯示「家長說：先寫完功課」。T007 E1 注入 conflict，顯示指定文字並刷新；insufficient 顯示指定文字及重試；busy 只重試一次。 |
| 10 | A3 p1 保護、停用置底、還原、刪除精確確認 | 〔實測〕T007 A3 A4：p1 沒有管理按鈕；停用前有頁內說明，停用後管理列及切換清單置底，切換鈕灰且 disabled；還原恢復順序；暱稱多一個空白仍不能永久刪除，完全相同才開放。 |
| 11 | A4 刪本機所有該玩家 pid: 鍵 | 〔實測〕T007 A3 A4 永久刪除 p2 後，自訂 p2:any-custom-key 與 p2:badges 均清除，其他玩家鍵保留；另驗證停用目前玩家會呼叫既有 fallback，儲存 p1 並要求重新載入。 |
| 12 | 獎項零價格／空名稱不送、預覽一致 | 〔實測〕T007 C1 D7：0＋0 儲存 disabled；空白名稱不送 rewardSave；預覽隨可抵銀開關改指定文字，銀 0 不加註解；銀價格上限 99、每週上限 14。 |
| 13 | G2 空待核准及離線文字 | 〔實測〕T007 G2：出現「現在沒有待核准的申請」；`?mock=offline#parent` 出現「連不到雲端，請稍後再試」與重試。已登入玩家頁遇離線會移除舊資料，恢復 fetch 後按重試重新載入。 |
| 14 | 五句告知、Face ID disabled／iframe 隱藏 | 〔實測〕T007 G2 逐句比對五句告知；T007 PIN 確認 Face ID disabled；以 self !== top 的 iframe 情境確認沒有 Face ID 文案／按鈕。 |
| 15 | XSS 暱稱、獎項、拒絕原因 | 〔實測〕T007 XSS 將 `<img src=x onerror=1>` 注入暱稱、圖示、獎項、決定原因與異常原因，四個家長分頁均以文字顯示，沒有生成 img；含紀錄的「異常」標記。 |
| 16 | 非 #parent 維持原行為、正式頁無假後端 | 〔實測〕既有 T005／T006 全過；T005 build 檢查正式頁不含 mock://gas、createGasEnv，且所有 inline script 編譯成功。T007 G2 離開 hash 會清 session 並回首頁；無家庭碼與閱讀碼模式顯示工單指定說明。routing race 測試確認延遲首頁不蓋 PIN。 |
| 17 | 390×844、375×667 手機版面／觸控 | 〔記錄〕依工單「本機不驗、由雲端測試確認」，未開瀏覽器，留待雲端人工驗收。〔記錄〕CSS 已設定 parent-page button 最小 44×44px、PIN 鍵高 60px 與可換行內容。〔推測〕實際無橫向捲動及視覺表現仍需上述兩個尺寸確認，jsdom 不提供此證據。 |

〔實測〕`git diff --check -- index.html test/frontend.test.js` 無空白錯誤，只有 Git 的既有 LF／CRLF 提示。

## 3. 偏離事項

〔記錄〕無偏離。採用工單要求的直接回 PIN 上鎖流程；手機人工驗收留待雲端，不以 CSS 或 jsdom 結果冒充實機驗收。沒有增加後端欄位或修改其他檔案。

## 4. 遇到的問題與未決事項

- 〔實測〕晚回登入可能在上鎖後帶回新 token，現以世代號拒絕，並盡力登出該 token；晚回受保護清單同樣不再寫 DOM，T007 B5 race 通過。
- 〔實測〕首頁 libHome 的非同步載入可能晚於 hash 切換，現於畫面寫入前檢查 #parent，啟動時恢復題庫的流程也檢查路由。routing race 測試通過。
- 〔實測〕舊請求回 no_session 可能誤鎖新登入，現檢查請求與目前 session 是否相同；未登入的 parentStatus 錯誤不再反覆觸發上鎖。routing race 包含舊 session 失效與直接 API 失效測試。
- 〔記錄〕閒置測試攔截 window.setTimeout／clearTimeout 並手動執行 180000ms 回呼，沒有加入正式網址參數或可跳過上鎖的後門。
- 〔記錄〕未決事項：僅剩工單指定的雲端手機尺寸與觸控人工確認；無待新增的後端參數。正式服務與部署未操作。
