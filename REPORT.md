# T-008 第 1 輪執行回報

〔記錄〕日期：2026-11-06（Asia/Taipei）。已讀 HANDOFF.md，完成本輪文件與測試腳本實作及本機允許的驗證。雲端人工驗收尚待執行，不宣稱全部驗收結案。

## 1. 修改檔案

- 〔記錄〕`docs/DEPLOY-reward.md`：新增非工程師升級說明，依指定順序列出九步、暫時函式、PIN 重設與退回，以及上線前法律施行日與試算表分享範圍確認。
- 〔記錄〕`README.md`：在「九、安全與限制」前加入「家長權限與獎勵(新增)」，包含入口、徽章分玩家規則、部署文件連結及三個開發指令用途；既有章節未重新編號。
- 〔記錄〕`test/backend.test.js`：只新增一個 `T008 docs: 編輯器暫時函式可以發設定碼` 測試，直接呼叫全域 adminParent，不提供管理者 token，驗證發碼成功且可設定 PIN。
- 〔記錄〕`test/e2e/reward.spec.js`：新增雲端 Chromium 腳本，共 11 個案例；G1 兩個尺寸，及 A2、A3、B5、C1、D1、D2/D9、D6、D7/E1、G2 主流程。用真實 file:// 導覽、按鈕與表單操作；部分資料透過頁面 API 在假後端準備，不使用 page.setContent。附執行指令、FQ_DIST 與 G3 Lighthouse 手動指令。
- 〔記錄〕`REPORT.md`：更新本輪報告。
- 〔記錄〕未修改 index.html、Code.gs、package.json 或其他專案檔案；保留原有 HANDOFF.md 差異及既有未追蹤檔案。

## 2. 驗收標準與證據

### Node 全數通過，e2e 檔案不造成失敗

〔實測〕`node --test` 全數通過，輸出包含 `✔ test\e2e\reward.spec.js`。最終再次執行 `node --test | Select-Object -Last 12`：

```text
ℹ tests 106
ℹ suites 0
ℹ pass 106
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9574.3642
```

〔記錄〕e2e 檔案以函式包住，require.resolve 找不到 Playwright 就 return；另檢查 NODE_TEST_CONTEXT，避免日後安裝 Playwright 後被 Node 測試探索時註冊 Playwright 案例。上述 106 項包含 Node 對腳本檔的探索，並非已執行瀏覽器案例。

### T008 docs 測試通過

〔實測〕`node --test --test-name-pattern='T008 docs' test/backend.test.js`：

```text
✔ T008 docs: 編輯器暫時函式可以發設定碼 (14.7252ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ duration_ms 121.1007
```

〔實測〕驗證 issued.ok 為 true、setupCode 為非空字串，以及使用該碼 parentSetPin 回 ok:true 與 session。

### 腳本語法

〔實測〕`node --check test/e2e/reward.spec.js` 無輸出，退出碼 0。

### 修改範圍

〔實測〕寫報告前 `git diff --stat`：

```text
 HANDOFF.md           | 115 +++++++++++++++++++++------------------------------
 README.md            |   6 +++
 test/backend.test.js |  10 +++++
 3 files changed, 64 insertions(+), 67 deletions(-)
```

〔記錄〕HANDOFF.md 是開始時已存在的差異，本輪未改。當時新增文件與 e2e 檔仍未追蹤，因此不在 diff --stat；git status --short 顯示 `?? docs/DEPLOY-reward.md` 與 `?? test/e2e/`。本報告寫入後另有 REPORT.md 差異。上述 stat 沒有 index.html、Code.gs、package.json。

〔實測〕`git diff --check` 無空白錯誤，只有既有 HANDOFF.md 的 LF/CRLF 提示。

### 文件九步與端點檢查

〔實測〕`rg -n '^([1-9]\. |## 上線前)' docs/DEPLOY-reward.md` 找到步驟 1–9（行 5、6、7、8、9、18、19、20、21）與上線前再確認（行 23）。

〔記錄〕逐條複核順序為備份、貼程式、setup、更新部署、發設定碼、設定 PIN、手機實測／使用者合併 PR、重設 PIN、退回；內容包含指定的 PEPPER 注意、刪暫時函式與不必重新部署、舊前端第一位玩家行為。

〔實測〕`git grep -n 'script.google.com/macros/s/' -- docs/DEPLOY-reward.md` 無輸出。因新增檔未追蹤，再用 `rg -n 'script\.google\.com/macros/s/' docs/DEPLOY-reward.md` 直接讀檔確認無匹配（退出碼 1 代表無匹配）。

〔記錄〕文件僅有指定的法規公開連結與網站入口佔位文字，無真實部署網址、邀請碼、金鑰或 PIN。

### 雲端人工驗收

〔記錄〕**尚未做:Playwright 實際執行**。依工單禁止事項，本機未啟動瀏覽器、未安裝或執行 Playwright、未執行 Lighthouse，未部署或連線真實服務，未 commit 或 push。

〔記錄〕腳本 G1 量測首頁、獎勵、我的申請、家長 PIN 與四個分頁的 scrollWidth、可見 button/input 寬高；每個案例收集 pageerror。只接受含 mock://gas 的建置檔，並攔截 HTTP/HTTPS，避免使用真實服務。G2 使用 slow/offline/empty 模式，empty 前清除假後端快照再導覽。

〔推測〕實際 Chromium 的字型、emoji、觸控區域、操作等待與排版仍需雲端執行確認；語法與 Node 測試通過不構成瀏覽器驗收證據。G3 Lighthouse 效能分數亦待雲端手動確認。

## 3. 偏離事項

〔記錄〕無偏離。依工單保留雲端實際執行工作；未為執行瀏覽器測試安裝相依或修改產品程式。

## 4. 遇到的問題與未決事項

- 〔記錄〕PowerShell 預設讀取編碼使 HANDOFF.md 中文顯示異常，改用 UTF-8 重新讀取後依原文實作。
- 〔記錄〕Git 對使用者層 ignore 設定顯示權限提示，未影響 diff/status 的專案檢查；未改系統設定。
- 〔記錄〕假後端 empty 模式只在初次建立資料時生效，腳本已在該情境前清除 localStorage；每次導覽預先標記內建導覽為已讀，避免教學遮罩干擾測試點擊。
- 〔記錄〕未決事項：雲端依腳本開頭四個指令執行 Playwright，確認手機尺寸／主流程與 pageerror；另手動執行 G3 Lighthouse。若發現產品尺寸問題，需另開產品修改工單，本輪未改產品程式。
