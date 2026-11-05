# 派工：家庭題庫：家長權限與徽章兌換獎勵 實作第 1 輪

你是這個 repo 的 Orchestrator。先讀 CLAUDE.md（repo 裡沒有就照下面的做法），照它的工作迴圈做。這是全自動派工，沒有人可以回答問題：
- 要訪談使用者的地方，改成把假設寫進 HANDOFF.md 的「假設與未知」，選保守方案，繼續。
- 異質審核：沒有 GEMINI_API_KEY 就自審，REVIEW.md 註明「自審」。不要用 agy。
- 終審包和隨堂測驗不用做，改成最後的 BUILD_REPORT.md。

## 這是既有 repo，不是新專案
- repo：公開 repo `kyo182p/family-quiz`（GitHub Pages 網站＋Google Apps Script 後端 Code.gs＋Google 試算表）。從 `main` 開工作分支，PR 開好但不合併。
- 先讀現有 index.html、Code.gs、README，再改；不要換框架、不要重寫既有功能。
- 正式網站就是 main 的 GitHub Pages：合併 PR＝上線，所以合併一定由使用者在手機實測後自己按。

## 目標（第一階段）
照 docs/dispatch/SPEC.md 做出第一版：SPEC「目標與範圍」表格裡所有「做」的項目，包含：
1. 玩家：切換、新增、改名、選圖示、停用、還原、永久刪除；徽章、作答、兌換依玩家分開；舊資料當玩家 p1，不搬資料。
2. 家長 PIN（4～6 位，提示 6 位）：一次性設定碼、連錯 5 次鎖 15 分鐘、session 30 分鐘、背景或閒置 3 分鐘自動上鎖；後端只存 HMAC 雜湊（PEPPER 放 Script Properties，第一次執行 setup 自動產生）。
3. 銀、金兩色徽章：每位玩家分開計數、分開顯示；徽章入帳表每筆記顏色。
4. 獎項與額度：價格可只銀、只金或搭配；「金可以抵銀」開關（預設開，1 金抵 1 銀，銀不能抵金）；每週上限（0＝不限）。
5. 兌換：申請→依顏色保留→家長核准才扣、拒絕或取消原色退回；requestId 防重送；LockService 鎖內重算；「我的申請」；家長待核准清單。
6. 家長頁告知文字、Code.gs 部署說明。
Face ID／WebAuthn 是第二階段，這輪不做（畫面只留停用的按鈕位置）。

畫面照 docs/dispatch/DESIGN.html（裡面的 HTML／CSS 可以當起點），做法照 docs/dispatch/RESEARCH.md。驗收條件照 SPEC.md「驗收條件」逐條（A1–H2）。

## 做法
1. 拆成工單（最多 8 張，建議照 SPEC「技術做法」的 8 步），一張一張來：寫 HANDOFF.md → 執行 `codex exec -s workspace-write -c sandbox_workspace_write.network_access=true "讀取 HANDOFF.md 並執行工單。完成後把回報寫入 REPORT.md，不要只輸出到終端。" < /dev/null`（一定要接 `< /dev/null`，不然 codex 會卡著等輸入）→ 讀 REPORT.md、跑測試、自己檢查 diff → 通過就 `git add -A` 加 `git commit -m "T-xxx: 一句說明"`。
2. 前端照 SPEC：維持現有單一 index.html，不引入 Vite 或框架（SPEC 明確寫了，優先於一般派工習慣）。加一個 `npm run build`：把 index.html 和它用到的檔案複製到 dist/，並讓 dist/index.html 在 `?api=mock`（或 dist 預設）時改用前端內建的假後端，直接用相對路徑打開就能操作，給雲端預覽和測試用。後端連不到時小孩端只顯示錯誤，不用本機數字冒充。
3. 測試一律用假後端：`test/fake-gas.js`（Node `vm.runInContext` 載入 Code.gs，注入假的 SpreadsheetApp、LockService、Utilities、PropertiesService、CacheService、可控時鐘）＋ `test/backend.test.js`（`node --test`）。絕對不連真的試算表或 Apps Script 網址。
4. Code.gs 改動要附 `docs/DEPLOY-reward.md`：怎麼備份試算表、怎麼貼回 Apps Script、執行一次 setup、「部署 → 管理部署作業」編輯現有部署選新版本（網址不變）、怎麼用 adminIssueSetupCode 發設定碼。由使用者自己做，你不要部署。
5. 最多 120 分鐘。時間快到就停在已經 commit 的進度，收尾。

## 不准
- git push 到 main、切到或修改 main、合併、rebase、刪除分支。（推工作分支、開 PR 可以。）
- 部署到任何地方（含 Apps Script、GitHub Pages 設定）、註冊服務、寫入任何金鑰或密碼。
- 在 repo 放任何 PIN、PEPPER、ADMIN_TOKEN、真實試算表 ID 或部署網址以外的新祕密、真實家庭或小孩資料。測試資料只用假暱稱。
- 新增付費服務或授權不乾淨的素材（照 SPEC.md 的素材清單：只用現有字型、自繪 SVG、emoji）。
- 改 docs/dispatch/ 裡的檔案。
- 在這台電腦上啟動瀏覽器（Edge、Chrome、Playwright、Puppeteer）做測試或截圖：這是使用者正在用的電腦，會變得很慢。要瀏覽器才能驗的驗收條件記「未測：留給雲端收回時測」。
- 兩張工單同時跑、或在背景跑 codex：一次只跑一個 codex，確認它結束了才開下一張。

## 收尾（一定要做）
1. `npm run build`，確認 dist/index.html 存在，且用假後端能打開。
2. `node --test` 全部跑過，`git grep` 確認沒有 PIN、PEPPER、ADMIN_TOKEN 值。
3. 寫 repo 根目錄的 BUILD_REPORT.md，章節固定：
   - 結論（3 行內）
   - 驗收條件（照 SPEC.md 逐條：✅／❌／未測，附證據或原因）
   - 怎麼在本機執行
   - 測試結果（指令和輸出摘要）
   - 偏離事項（沒有就寫「無偏離」）
   - 下一輪建議
4. `git add -A` 加 `git commit -m "build report"`。
