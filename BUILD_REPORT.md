# BUILD_REPORT：家庭題庫 學習檢定與弱點出題 實作第 1 輪

分支 `build/fq-diagnostic`(從 origin/main dece9d3 開),5 個工單 commit(5765671～8931f2e)+本報告,未推送、未部署。

## 結論
- SPEC 第 1 節 12 項「做」全部有實作:能力標籤、20 題檢定、家長報告、每位玩家弱點檔案、段考補登、弱點加權練習、三種讀題鷹架、老朋友間隔重練、重測卡、同次重做、同意／刪除／12 個月清除、AI 出題標示。
- `npm test` 270 項全過(原 210 + 新增 60),`npm run build` 成功;全部用假後端與虛構題目〔實測〕。
- 要瀏覽器才能驗的(手機寬度、對比、Lighthouse)依派工單未在本機測,留給雲端收回時測;加權只用在新的「練習 12 題」回合,既有練習排程沒動(見偏離事項)。

## 驗收條件
| # | 功能 | 結果 | 證據／原因 |
|---|---|---|---|
| 1 | 標籤 | ✅ | genPrompt 要求 sk、normQ 保留 sk/skc/sksrc/items,AI 題 sksrc='ai';舊題無 sk 照常練習(T028 normQ 舊題輸出不變、T031 無 sk 舊題進 normal);家長改標後再補標該題不變(T032 tags 測試,含請求途中家長改標)〔實測〕 |
| 2 | 檢定 | ✅ | buildDiagForm 20 題、7 標籤各 ≥2、同標籤不相鄰(20 組 seed);全內建 pool 也補滿 shp、prf;jsdom 走完 20 題,events 20 列帶 ok/sec/chg,改選記 RW(T028、T030)〔實測〕 |
| 3 | 報告 | ✅ | classifyTag 兩組 6 筆手算案例(slip 5/0、learn 1/6)一致;<4 題或錯 <2 為 unclear;報告頁不含「粗心」「不會」(T028、T030)〔實測〕 |
| 4 | 弱點檔案 | ✅ | p1、p2 各一列 profiles 互不影響;另開 env 以 snapshot 還原(換裝置)讀得到同一份(T029)〔實測〕 |
| 5 | 段考補登 | ✅ | exams 只存 7 欄(含 subject、examDate、qnos、tags),額外的 score/photo 被丟掉;補登後報告顯示「段考補登：錯 2 題。」(T029、T032)〔實測〕 |
| 6 | 加權出題 | ✅ | 兩個 w=1 弱點、12 題 → 弱點題 5–6、最多連續 2、首尾不是弱點(純函式 20 seed + jsdom 實際回合);連對 5 題 w=0.7、第 6 題 0.49(T028、T031)〔實測〕 |
| 7 | 鷹架 | ✅ | 否定 L2 點「不」前選項 disabled、點錯提示、鍵盤替代;數數未打完 disabled;閱讀點錯顯示「答案在第 N 句附近」;連對 5 題後端 scf 2→1;非弱點／檢定模式不套(T031)〔實測〕 |
| 8 | 老朋友 | ✅ | 答錯 dueAt=隔天;撥時鐘 +1 天首頁顯示「今天有 1 題老朋友要複習」、出同標籤不同 id;答錯退一格;每回合 ≤3(T028、T031)〔實測〕 |
| 9 | 重測 | ✅ | lastDiag 31 天前顯示「距離上次檢定 31 天」、10 天前不顯示;第 2 次檢定後報告有上次黑線;段考後 3–7 天且距上次 ≥14 天才提醒(T030、T031)〔實測〕 |
| 10 | 同次重做 | ✅ | 首次答錯只顯示「等一下再看一次」、無正解與 .ok;3–5 題後同 id、選項換序;retry=1(T031)〔實測〕 |
| 11 | 同意與刪除 | ✅ | 未同意 postEvents 回 no_consent、events 只有表頭、本機佇列清掉、不套鷹架;同意後 consent {ver,at};刪除後四表找不到該 fk、另一玩家仍在;撥到 366 天後舊 events 被每日清除(T029、T030、T032)〔實測〕 |
| 12 | AI 標示 | ✅ | 檢定、練習、既有植物與家庭題庫練習畫面:AI／改寫題顯示「AI 出題」、內建題顯示「內建題」(T030、T031)〔實測〕 |
| 13 | 手機與無障礙 | 部分 | 只用鍵盤完成檢定與三種鷹架 ✅(T030、T031 只派送 keydown);44px 與 32px 寫在 CSS 〔記錄〕。390/375 無橫向捲動、三套風格 AA 對比:**未測,留給雲端收回時測**(本機禁開瀏覽器) |
| 14 | 效能與安全 | 部分 | 送出不擋畫面:fetch 延遲 2 秒時同一 tick 已換題 ✅〔實測〕;補標送出的 prompt 不含暱稱、邀請碼、fk(T029 斷言 payload、T032 斷言請求)✅〔實測〕;repo 掃描無 `sk-ant-` 金鑰與試算表 ID ✅〔實測〕。手機 Lighthouse ≥70:**未測,留給雲端** |

## 怎麼在本機執行
```
npm install
npm test            # 270 項,約 70 秒
npm run build       # 產生 dist/index.html(內嵌假後端,直接以檔案開啟即可)
```
- dist 版本用瀏覽器開即可,首次開啟會建立假家庭(家長設定碼 `MOCK2345`)與假的學習檢定資料表(`mock-diag`,尚未同意)。網址可加 `?mock=offline`(斷線)、`?mock=slow`、`?mock=empty`。
- 流程試玩:書架頁「學習檢定要先請家長同意」→ 家長頁 → 「學習」分頁同意 → 回書架「開始學習檢定」或「練習 12 題」→ 家長頁看報告、段考補登、題目與標籤、玩家資料。
- 正式上線(使用者手動):新建資料試算表 → Script Properties 設 `DIAG_SHEET_ID` → 貼上新 Code.gs → 手動執行一次 `setupDiag`(建四張表與每日 3 點清除觸發器)→ 部署新版本 → 再合併前端。詳見 README「學習檢定」。

## 測試結果
- `npm test`:tests 270、pass 270、fail 0、cancelled 0、skipped 0、約 72 秒〔實測,最後一次於 T-032 後〕。
- 新增測試檔:test/diag.test.js(17,純函式、兩檔共用區塊逐字相同)、test/diag-backend.test.js(13,後端)、test/diag-ui.test.js(7)、test/diag-practice.test.js(15)、test/diag-parent.test.js(8)。
- `npm run build`:`Built dist with mock backend`,dist/index.html 598 KB〔實測〕。
- Orchestrator 對抗抽測 rounds/adv028.js:7/7 PASS(中斷剔除、多標籤取第一、ctx 弱點不給鷹架、輸入不被改、unk 不排佇列等)〔實測〕。
- 異質審核:沒有 GEMINI_API_KEY,5 張工單全部 Orchestrator 自審(REVIEW.md 註明「自審」)。

## 偏離事項
1. **沒有用 Vite**:repo 已有 `tools/build.js` 單檔建置(GitHub Pages 直接發布 index.html),改用 Vite 會改變發布方式。照派工單「沿用現有建置」;dist/index.html 是單檔、無外部相對路徑問題。
2. **events 表多兩欄** `len`(題幹＋選項字數,算個人速度用)、`scok`(鷹架步驟是否做對,「連對要鷹架也做對」用)。只是數字,不含內容。
3. **純函式前後端各一份**:Code.gs 要能單獨貼上,不能 import;以 `// ==DIAG-SHARED-BEGIN==` 區塊+「兩檔逐字相同」測試防漂移。
4. **弱點加權只用在新的「練習 12 題」回合**,既有植物小學堂／家庭題庫練習的 schedule/GAP_FIRST 未改;弱點題不夠時用內建題組補,**未做「AI 現出同標籤弱點題」**(SPEC 第 6 節第 5 點後半)。
5. **同意畫面放在家長頁「學習」分頁**(PIN 後),孩子端只顯示「請家長同意」;比例滑桿也在家長頁。
6. T-031:normal 題不足時補內建非弱點題湊滿 12 題;所有標籤 w=0 時,為了讓到期老朋友能出現,組題時用 profile 暫時副本保留名額(不存檔)。接受,但記技術債(應讓 composeRound 的老朋友獨立於弱點配額)。
7. **流程事故:T-030 有兩個 codex 同時執行**。第一次派工用工具的背景模式(預設 10 分鐘上限),我為了改長上限用 TaskStop 停掉它再重派,但 TaskStop 只終止外層 shell、codex 子行程繼續跑,違反「一次只跑一個 codex」。兩者都在 17:02 前結束;Executor 發現重複宣告後自行整併,最終 247 項全過,我另查無重複函式。之後 T-031、T-032 都一次只跑一個。
8. 執行 codex 時用工具的「背景等待完成通知」模式(單一行程,等它結束才開下一張),因為前景指令上限 10 分鐘。

## 下一輪建議
1. 雲端收回時測:390/375 寬無橫向捲動、44px、三套風格 AA 對比、手機 Lighthouse ≥70、家長頁 5 個分頁在窄螢幕的排版。
2. 真 Sheets 端到端:建資料試算表、跑 setupDiag、做一次檢定看 events/profiles 寫入與每日觸發器(目前只在 fake-gas 驗過)。
3. 補做「弱點題不夠時 AI 現出同標籤題」,以及決定要不要把加權套進既有練習排程。
4. 技術債:`diag_tagBatch` 在 withLock 內呼叫 AI(佔鎖數十秒,應先放鎖再呼叫);`diag_report` 為 firstTs 多讀一次 events 表;composeRound 的老朋友名額應獨立於弱點配額。
5. 判斷門檻(0.6、1.5、1.8、minN 4 等)都是研究報告的假設值,累積自家資料後回頭調 `DIAG_CFG`。
6. 補做異質審核(本輪 5 張全自審),可用 `git diff dece9d3..HEAD`。
