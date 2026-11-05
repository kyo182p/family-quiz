# BUILD_REPORT：家長權限與徽章兌換獎勵 第 1 輪

## 結論

第一階段功能都做完了，在分支 `build/fq-reward`，PR 未合併。106 項自動測試全過。
這些測試都是用假後端跑的：**真的 Google 試算表、真瀏覽器、真手機都還沒驗**。
A1–H2 共 28 條：26 條通過（其中 11 條要靠 jsdom 才驗得到），2 條未測（G1、G3）。

## 驗收條件

「後」＝`test/backend.test.js`，用假 Apps Script 載入真的 `Code.gs`。
「前」＝`test/frontend.test.js`，用 jsdom（在 Node 裡模擬網頁，不開瀏覽器）驅動真的 `index.html`。jsdom 驗得到流程與資料，驗不到版面和真實手機行為，所以標「✅（jsdom）」的條目，真瀏覽器還要再跑一次：`test/e2e/reward.spec.js` 已寫好，但沒有實際執行過。

| # | 結果 | 證據或原因 |
| --- | --- | --- |
| A1 | ✅ | 後：`A1: legacy saves preserve all p2…`、`T002 R2: legacy frontend echoes…` |
| A2 | ✅（jsdom） | 前：`T005 A2: form adds…`、`T005 A2: p2 answers/badges…` |
| A3 | ✅（後＋jsdom） | 後：`T003 A3`、`T004 A3/A4`；前：`T007 A3 A4`、`T005 disabled rows…` |
| A4 | ✅ | 後：`T003 A4`、`T004 A3/A4`、`T004 A4 exact IDs`；本機鍵：`T005 A4`、`T007 A3 A4` |
| B1 | ✅ | 後：`T003 B1` |
| B2 | ✅ | 後：`T003 B2`（14:59 仍鎖、15:00 解鎖）、`T003 B2 extension` |
| B3 | ✅ | 後：`T003 B3`、`T003 B3 bait`。例外：`PEPPER` 本來就存在 Script Properties，掃描排除它與 `ADMIN_TOKEN` |
| B4 | ✅ | 後：`T003 B4`、`T004 setup/B4` |
| B5 | ✅（jsdom） | 前：`T007 B5`、`T007 B5 race`。切背景是用程式發出事件模擬的，iPhone 實機未驗 |
| C1 | ✅（後＋jsdom） | 後：`T004 reward validation/C1`；前：`T007 C1 D7` |
| C2 | ✅ | 後：`T004 C2/week boundary` |
| D1 | ✅（jsdom） | 前：`T006 D1` |
| D2 | ✅（後＋jsdom） | 後：`T004 D2/D9`；前：`T006 D2 D9` |
| D3 | ✅ | 後：`T004 D3`；前：`T006 D3`（連按、重試都沿用同一個 requestId） |
| D4 | ✅ | 後：`T004 D4: seeded 200 interleavings…`、`T004 D4 targeted` |
| D5 | ✅ | 後：`T004 D5` |
| D6 | ✅（jsdom） | 前：`T006 D6 XSS` |
| D7 | ✅（後＋jsdom） | 後：`T004 D7`；前：`T007 C1 D7`、`T007 E1 D7` |
| D8 | ✅ | 後：`T004 D8` |
| D9 | ✅（後＋jsdom） | 後：`T004 D2/D9`；前：`T006 D2 D9` |
| E1 | ✅（jsdom） | 前：`T007 E1 D7`、`T007 E1: gold substitution…` |
| F1 | ✅ | 後：`F1: cap, exact five-minute boundary…` |
| F2 | ✅ | 後：`F2: cloud bank plus badge table…`、`T002 R2: first balance…`、`T004 F2 integration` |
| G1 | 未測 | 留給雲端收回時測：版面與觸控大小要真瀏覽器，腳本已寫在 `test/e2e/reward.spec.js`。「無 JS 錯誤」在 jsdom 測過 |
| G2 | ✅（jsdom） | 前：`T006 G2`、`T007 G2 routing…`（`?mock=slow`、`offline`、`empty`） |
| G3 | 未測 | 留給雲端收回時測：Lighthouse 要真瀏覽器 |
| H1 | ✅ | 後：`T004 H1/D3`、`T004 H1/D4`、`T004 H1/D5`，都要求拿掉鎖或查重後斷言真的失敗 |
| H2 | ✅ | 掃過 PEPPER／ADMIN_TOKEN 賦值、API 金鑰、試算表網址，沒有命中。只有測試用的假 PIN（`246810`、`000000`）與假設定碼（`MOCK2345`）。部署網址只在 `index.html`，是現有的，派工指示允許 |

Orchestrator 另外自己寫了 4 輪 Executor 沒寫過的對抗測試（T-002、T-003、T-004、T-007），包含 `__proto__` 徽章鍵、PIN 與 session 型別攻擊、跨家庭操作、週鍵被改成 Date、含引號的獎項名稱走完真實 UI。沒有抓到新問題。這些腳本沒有進 repo。

## 怎麼在本機執行

```
npm install
npm run build
node --test
```

- 直接打開 `dist/index.html` 就是假後端示範，資料存在瀏覽器裡，不連任何真實服務。
- 家長頁：打開 `dist/index.html#parent`，設定碼是 `MOCK2345`（畫面橫幅也會顯示）。
- 模擬狀態：網址加 `?mock=offline`（連不到雲端）、`?mock=slow`（載入中）、`?mock=empty`（沒有獎項）。`empty` 只在第一次建立資料時有效，要先清掉該頁的 localStorage。
- 根目錄的 `index.html` 是正式版，連真後端，也不含任何假後端程式。
- 部署後端照 `docs/DEPLOY-reward.md`，由使用者自己做。

## 測試結果

```
> npm run build
Built dist with mock backend

> node --test
ℹ tests 106
ℹ pass 106
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 9683
```

`dist/index.html` 存在。它能在假後端開起來這件事是用 jsdom 驗的（`T005 mock startup`），沒有用真瀏覽器開過。

## 偏離事項

1. **commit 沒有照字面用 `git add -A`。** 流程範本檔（`CLAUDE.md`、`.claude/`、`.mcp.json`、`MODEL_BINDING.md`、`review.py`、`工單類型與切割檢核.md`、`開案檢核表.md` 等 12 項）當中有幾個提到其他客戶專案名稱，而這是公開 repo，推上去就收不回來，所以用 `git add -A -- . ':!路徑'` 排除。檔案都還在本機。要納入的話自己加一次就好。各輪的 `CHANGES.diff` 也沒有 commit，它們和 git 歷史重複。
2. **有 3 張工單的 codex 跑到背景。** 派工指示不准在背景跑 codex。我都是用前景執行，但 T-002、T-005、T-007 超過工具的 10 分鐘上限，被系統自動移到背景。每次都等它結束才開下一張，沒有同時跑兩個。
3. **新增開發相依 `jsdom`（MIT）。** 派工指示沒有提到。不開瀏覽器時，它是唯一能實際驅動前端的方式，否則前端驗收全部都會是未測。只用於測試，不影響正式網站。
4. **T-002 第 1 輪沒有歸檔。** 歸檔腳本拒絕了提到多個工單編號的 HANDOFF，我沒注意到就開了修復輪，那輪的 HANDOFF、REPORT 被覆蓋。審查結論記在 `rounds/T-002-R2/REVIEW.md`。之後各輪都正常歸檔。
5. **全部自審，沒有異質審核。** 環境沒有 `GEMINI_API_KEY`，派工指示允許。Executor 與審查者都是 AI，上線前可以考慮再找一次獨立審核。
6. **資料合約補了 SPEC 沒寫死的決定**（`docs/REWARD-CONTRACT.md`）：p1 不能停用；一個家庭最多 12 位玩家；頭像 12 個；徽章入帳表在 SPEC 的欄位後面多 `數量`、`來源`；補入豁免每日上限只限 p1；異常列不會日後轉正；每週上限以「該玩家＋該獎項」計算；獎項只能停用不能刪除。
7. **工單寫錯的兩處，由 Executor 回報後仲裁接受：** 暱稱測試字串超過 12 字上限；B3 字面要求 Properties 搜不到 PEPPER，與 PEPPER 就存在那裡互相矛盾。
8. **開工同步檢查要用 `python -X utf8` 才能跑。** 腳本在這台電腦遇到 cp950 編碼會當掉。腳本本身沒有改。

## 下一輪建議

**合併前一定要做：**

1. **雲端跑真瀏覽器：** `test/e2e/reward.spec.js`（G1 與各畫面主流程）和 Lighthouse（G3）。這份腳本沒有實際跑過，第一次執行可能要修選擇器。
2. **在複製的試算表上做一次真後端測試。** 假環境已盡量模擬 Sheets，但以下幾點只有真環境驗得到：
   - 開頭加 `'` 的文字，讀回時引號確實會被去掉。這是全案最重要的假設，週鍵、暱稱都靠它。
   - 第一次補入時逐列 `appendRow`，徽章多的家庭可能要跑很久。鎖只等 10 秒，這段期間其他人會收到 `busy`。
   - 整段流程在 Apps Script 的實際速度（`rewardList` 每個獎項重讀一次兌換表）。
3. **手機實測：** iPhone 切背景是否真的上鎖、數字鍵手感、加到主畫面後的行為。

**使用者要知道的限制：**

- 小孩裝置上有邀請碼，所以小孩可以替別的玩家送申請。核准權在家長手上，家長卡片上看得到玩家是誰。
- 徽章仍由前端回報，每日上限擋得住亂灌，擋不住每天慢慢偽造。這是 SPEC 選定的程度。
- PIN 連錯鎖整個家庭，小孩可以故意把家長鎖 15 分鐘。
- 一台裝置離線太久、一次同步超過 10 枚時，多的會標異常、不入帳，也不會自動轉正。目前沒有手動補發的功能（SPEC 列為「晚點」），可能是第二階段最先需要的。

**可以晚點做：** 鎖定畫面自動倒數、`rewardList` 減少重複讀表、Face ID（第二階段）。
