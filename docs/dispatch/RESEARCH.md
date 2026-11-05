# 家庭題庫：家長權限與徽章兌換獎勵：研究報告

Nov 5, 2026 · @Wei-Che Li

## 結論

- **做什麼：** 第一版做玩家、家長 PIN、獎勵項目＋每週上限、申請→保留→核准／拒絕、我的申請，全部以雲端為準；Face ID 留到第二階段。
- **怎麼做：** 現有題庫 JSON 頂層欄位直接當「玩家 p1」，不搬舊資料；徽章收入改記在只新增的「徽章入帳」表；家長憑證放 Script Properties；兌換在 LockService 鎖內重算餘額與本週次數，用 requestId 防重送。
- **最大風險：** `saveBank` 現在整包覆蓋題庫、`bsLoad` 本機較新就回寫雲端，沒改成「依玩家合併」會把別的玩家紀錄蓋掉。
- **第二大風險：** 小孩裝置本來就有邀請碼，所有家長操作都要後端驗 PIN 或家長裝置憑證。
- 研究深度照「高」（出錯代價你沒回答）；社群雷達已跑完 13 則，見第 3 節與來源清單。

## 第一版功能清單

想法原文列的功能全部必做；另加 4 項配套（防重送、徽章入帳帳本、家長頁自動上鎖、告知文字）。

| 功能 | 分類 | 理由 |
| --- | --- | --- |
| 玩家：切換、新增、改名、刪除、選圖示；徽章、作答、兌換依玩家分開 | 必做 | 原文（20:52 補充） |
| 家長 PIN（4～6 位，建議預設 6 位），後端只存雜湊、連錯鎖定 | 必做 | 原文；4 位數常被孩子偷看（雷達） |
| 獎勵項目新增／修改／停用＋每週上限 | 必做 | 原文 |
| 小孩端獎勵兌換頁：每項枚數、本週剩幾次，不夠或額滿灰掉寫原因 | 必做 | 原文（20:53） |
| 申請→徽章保留→家長核准才扣／拒絕退回（可寫原因） | 必做 | 原文；開源 Pointsy、S'moresUp 同做法 |
| 小孩端「我的申請」 | 必做 | 原文 |
| 家長頁待核准清單（玩家、獎項、枚數、他目前徽章數）＋「有 N 筆待核准」標記 | 必做 | 原文；只做頁面標記，不寄信 |
| 以雲端為準：後端重算餘額與額度、requestId 防重送 | 必做 | 原文；S'moresUp 曾有「點數不夠也能兌換」bug |
| 徽章入帳表（只新增） | 必做 | 現有 earned 會被截到 500 筆、刪題庫會消失，不能當餘額依據 |
| 家長頁回到背景或閒置 3 分鐘自動上鎖 | 必做（小） | StarKids 做法 |
| 家長頁告知文字（存什麼、存哪、怎麼刪） | 必做（小） | 規劃階段個資建議 |
| Face ID／手機密碼（WebAuthn）＋PIN 備用 | 晚點（第二階段） | 你自己定的第二階段 |
| 預設獎項範本（一鍵加入） | 晚點 | 手動新增就夠用；範本內容見第 5 節 |
| 家長撤銷已核准、手動加減徽章 | 晚點 | 帳本變複雜；臨床指南不建議扣已給的點 |
| 存點目標、兌換時段限制 | 晚點 | 大獎標高價、用說明文字約定時段即可 |
| 匯出兌換紀錄 | 晚點 | 永久刪除玩家時一併清掉即可 |
| 扣點懲罰、現金錢包、聊天 | 不做 | 違反臨床建議、不在範圍 |

## 做法

### Q1 玩家：資料怎麼分、既有資料怎麼處理

建議不搬資料：現有的頂層欄位就是玩家 p1，其他玩家另存，舊前端寫的自然算 p1。

**現況（main d4a78f6）：** 家庭表依邀請碼比對（`findFamily` Code.gs:207）；自建題庫的作答 `rec`/`days`/`summary` 與徽章 `badge` 存在題庫 JSON，`saveBank`→`putBank`（Code.gs:329/338）整包覆蓋；書架、植物徽章在「徽章」表（`badgeSync` Code.gs:927）；植物（`g3plants-rec`）與書架（`lib-rec:<id>`）作答只在裝置上；`api()` 只送 `{action, code}`（index.html:1449）。

做法：

1. 新增「玩家」表：邀請碼、玩家ID、暱稱、圖示、排序、狀態（啟用／停用）、建立／更新／停用時間。暱稱欄提示「不要填真名」。
2. `doPost` 開頭取 `pid = req.playerId || 'p1'`，檢查玩家屬於這個邀請碼且啟用；新增 `playerList`、`playerSave`、`playerDisable`、`playerPurge`。`playerList` 發現沒有 p1 就在鎖內補一列（冪等）。
3. 題庫 JSON：頂層仍是 p1，其他玩家放 `players: {p2: {rec, days, summary, badge, updatedAt}}`。`saveBank` 改成依玩家合併：沒帶 `players` 的（舊前端）保留雲端原本的；有帶就逐位合併（earned 取聯集、rec/days 取 updatedAt 較新者）。
4. 「徽章」表加「玩家ID」欄，空白＝p1。
5. localStorage：新增 `player`、`players-cache`；p1 以外的玩家加前綴（`p2:badges`、`p2:progress-…`、`p2:lib-rec:…`、`p2:g3plants-rec`）。
6. 刪除玩家：預設「停用」（保留、可還原，待核准申請改「取消」）；家長另有「永久刪除」（再確認一次，清題庫 `players[pid]`、徽章列、入帳列、兌換列、本機 `pid:` 鍵）。p1 不能刪，只能改名或清空。

替代：另開「作答紀錄」表（邀請碼＋題庫ID＋玩家ID 一列），不受題庫 90 萬字上限限制，但讀寫要大改。風險：舊手機快取沒更新會一直寫 p1；玩家多時題庫 JSON 可能靠近 `MAX_BANK_CHARS`（未驗證）。

### Q2 家長身分驗證

PIN 存 `HMAC-SHA256(salt+PIN, pepper)` 就夠，真正的防線是 pepper 與雜湊分開存＋連錯 5 次鎖 15 分鐘。

1. 全放 Script Properties（試算表協作者看得到表格）：`pin:<code>`={salt,h}、`pinfail:<code>`={n,until}、`pdev:<code>`=家長裝置清單（最多 3 支）、`PEPPER`（32 位元組亂數）。鎖定計數不放 Cache（超過 1000 筆會被淘汰），讀寫包 LockService。
2. 多輪迭代幫助不大：6 位數只有 10⁶ 種，node 實測 1000 輪 HMAC 約 10ms，全外洩時仍可秒破。
3. Session：兩個 `getUuid()` 串接，Cache 存 `ps:<SHA256(token)>`，TTL 30 分鐘；前端只放記憶體，`visibilitychange` 變 hidden 或閒置 3 分鐘就清掉。
4. 第一次設 PIN：要有管理者給的一次性設定碼，避免小孩搶先設（見第 6 節）。忘記 PIN：`adminResetPin`（ADMIN\_TOKEN）或手動刪 Script Properties 的 `pin:<code>`。
5. 後端 action：`parentStatus`、`parentSetPin`、`parentLogin`、`parentLogout`，第二階段再加 `parentBindDevice`、`parentDeviceLogin`、`parentDevices`、`parentRevokeDevice`。任何 log 不寫入 PIN 或 token。
6. 第二階段 Face ID：家長手機用 PIN 綁定後拿到「家長裝置憑證」（後端只存雜湊、可撤銷）；`navigator.credentials.get`（`userVerification:'required'`，rpId 省略即 kyo182p.github.io）成功才送憑證。一定留「改用 PIN」。在沙盒 iframe（Claude 成品）裡偵測到就只顯示 PIN。
7. 給家長看的一句話：「Face ID 只決定這支手機裡的家長鑰匙能不能拿出來；手機借孩子前先鎖螢幕，遺失就到家長頁撤銷。」

風險：WebKit bug 241126（加到主畫面後第二次 get() 失敗）仍是 NEW、只記錄在 iOS 15.5；Apple 論壇 2026-02 另有主畫面 passkey 重複跳出的回報，現行 iOS 是否仍發生未驗證，要真機測。kyo182p.github.io 底下所有 repo 共用 origin，任一 repo 有 XSS 就能偷裝置憑證。若要後端真驗簽，需把 P-256 函式庫打包進 Apps Script（約 1～2 天，BigInt 支援未驗證），先不做。

### Q3 兌換帳本：不重複兌換、不算錯餘額

每筆申請一列、狀態欄記狀態，另有只新增的紀錄表；餘額不快取，每次在鎖內重算。

1. 工作表：
   - 「獎勵」：獎勵ID、家庭、名稱、價格、每週上限、啟用、更新時間。
   - 「兌換」：ID、requestId（唯一）、家庭、玩家、獎勵ID、名稱快照、價格快照、週鍵、狀態（待核准／核准／拒絕／取消）、拒絕原因、申請時間、決定時間、版本。
   - 「兌換紀錄」（只新增）：時間、兌換ID、舊狀態→新狀態、操作者。
   - 「徽章入帳」（只新增）：家庭、玩家、徽章鍵、at、入帳時間，唯一鍵＝玩家＋徽章鍵＋at。`badgeSync` 與 `saveBank` 合併時順便寫入新 at；更正寫負數調整列。上線第一次同步時把現有 earned 補進來。
2. 可用徽章＝入帳數＋調整 − Σ 價格快照（核准＋待核准）。本週已用＝同週鍵、核准＋待核准的筆數。
3. 週鍵：台北時間該週週一的日期（例如 `2026-11-02`），自己算，不用 `YYYY-ww` 格式（週起算日依語系而定，未驗證）。以「申請時間」算週：週日申請、週一核准不吃新一週額度。測試要涵蓋週日 23:59:59 與週一 00:00。
4. `redeemRequest {playerId, rewardId, requestId}`：鎖內先查 requestId（有就回傳原筆）→檢查啟用、餘額、本週次數 → appendRow＋紀錄 → `flush()` → 釋放鎖。
5. `redeemDecide {session, id, decision, reason}`：鎖內重讀，狀態不是待核准就回 `conflict`（同決定則回 ok）；核准前再算一次餘額。兩位家長同時按，後到的看到 conflict。
6. 其他：`rewardList`、`rewardSave`（要 session）、`redeemCancel`（只能取消自己的待核准）、`myRedeems`、`redeemList`（要 session）。
7. 鎖：`getScriptLock()` ＋ `waitLock(10000)`，拿不到回 `busy` 讓前端重試；鎖內不呼叫 UrlFetch。前端 requestId 用 `crypto.randomUUID()`，重送沿用，按鈕在回應前停用。

防竄改（徽章是前端回報）：建議「伺服器入帳＋限速」：每位玩家每天入帳上限、at 不得晚於伺服器時間，異常標記給家長看（約半天工，擋亂灌、擋不住慢慢偽造）。伺服器出題驗答案與現有離線出題設計衝突，不做。數量：一個家庭兩個小孩一年兌換約 200～500 列、入帳約 1,000～5,000 列（推論）。

### Q4 測試與部署（不碰真試算表）

1. 假後端：Node 用 `vm.runInContext` 載入 Code.gs，注入記憶體版 `SpreadsheetApp`、`LockService`、`Utilities`（crypto）、`PropertiesService`、`CacheService`、可控制的時鐘，模擬 `doPost({postData:{contents}})`。
2. 必測情境：舊前端不帶 playerId 存檔不蓋掉 p2；同 requestId 只產生一列；兩位家長同時核准只變一次；任何交錯順序餘額 ≥ 0、次數 ≤ 上限；週界；永久刪除無殘留。反證：拿掉鎖或冪等檢查時測試必須失敗。
3. 前端：Playwright 攔截 fetch 導向假後端，用兩個不同 localStorage 模擬小孩平板與家長手機。
4. 部署步驟（你自己做）：① 先複製整份試算表備份 ② 貼上新 Code.gs、執行一次 `setup` 補新表 ③ 「部署 → 管理部署作業」編輯現有部署、版本選「新版本」，網址不變（不要用「新增部署作業」）④ 先部署後端再合併前端 PR；舊前端不帶 playerId 一律當 p1，可照常用。

## 素材與資料來源

不需要新的第三方素材或資料：圖示沿用現有網站的 emoji／字型，後端只用 Google Apps Script 內建服務。

| 名稱 | 網址 | 授權 | 能否商用 | 要不要署名 | 查詢日 |
| --- | --- | --- | --- | --- | --- |
| Apps Script Utilities／Lock／Cache／Properties | [官方文件](https://developers.google.com/apps-script/reference/utilities/utilities) | Google 服務條款 | 自用，不涉及 | 不用 | 2026-11-05 |
| Web Authentication API（第二階段） | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API) | 瀏覽器內建 | 不涉及 | 不用 | 2026-11-05 |

若第二階段要後端驗簽，才需要引入 @noble/curves（MIT，需保留授權聲明），目前不做。

## 內容清單：預設獎項範本

依現有題庫估算（index.html 第 949–952 行：第一次就答對才揭格，`BADGE_TARGET=15`），小三一天約拿 1～2 枚、一週 7～10 枚；照「留約 1/3 可存」，一週可花約 5～6 枚。第一版只當家長頁「新增獎項」的說明參考，一鍵加入留到之後。

| 獎項 | 枚數 | 每週上限 | 理由 |
| --- | --- | --- | --- |
| 睡前多讀一本故事 | 1 | 3 | 便宜、跟學習有關 |
| 和爸媽玩桌遊 30 分鐘 | 2 | 3 | 不用螢幕的親子時間 |
| 選一天晚餐配菜或甜點 | 2 | 2 | 當天就能兑現 |
| 晚睡 15 分鐘 | 2 | 2 | 設上限才不影響作息 |
| 看 30 分鐘卡通 | 3 | 3 | 你舉的例子；螢幕當獎勵有研究指會讓螢幕時間變多，所以設上限 |
| 小零食或飲料一份 | 3 | 2 | 中等價位 |
| 玩 30 分鐘平板遊戲 | 4 | 2 | 比卡通更易上癮，訂高一點 |
| 選週末去的公園或圖書館 | 4 | 1 | 體驗型 |
| 選週末全家活動 | 5 | 1 | 約一週可花額度 |
| 貼紙或小文具 | 6 | 1 | 實體小物 |
| 邀朋友來家裡玩 | 10 | 1 | 存約 1.5 週 |
| 大獎：書或小玩具（家長自訂金額） | 20 | 1 | 存點目標的替代，約 3 週 |

## 待你決定

都不擋設計階段；沒回答就照建議做。

| 問題 | 選項 | 建議 |
| --- | --- | --- |
| 第一次設定家長 PIN 怎麼防小孩搶先設 | 管理者（你）發一次性設定碼給每個家庭／誰先設就是誰 | 一次性設定碼（關友家庭也用，小孩的平板上已有邀請碼） |
| PIN 位數 | 固定 6 位／4～6 位均可 | 4～6 位均可，預設提示 6 位 |
| 刪除玩家 | 只停用／停用＋永久刪除／只永久刪除 | 預設停用＋家長可永久刪除 |
| 植物、書架的作答紀錄（現在只在裝置） | 依玩家分開但留在裝置／一起上雲端 | 第一版只依玩家分開、留在裝置；徽章本來就上雲端，兌換不受影響 |
| 徽章防竄改程度 | 維持現狀／伺服器入帳＋每日上限／伺服器出題驗答案 | 伺服器入帳＋每日上限，異常標記給家長 |
| 家長頁入口 | 網址參數（例如 `?parent`）／獨立頁面 | 同一個 index.html 加 `#parent`，家長把它加到手機主畫面 |

## 來源清單

讀取日期 2026-11-05。程式碼依據：[kyo182p/family-quiz main d4a78f6](https://github.com/kyo182p/family-quiz) 的 Code.gs、index.html、README。社群看法見雷達議題「家庭題庫：家長權限與徽章兌換獎勵」（13 則）。

- [Apps Script Utilities](https://developers.google.com/apps-script/reference/utilities/utilities)
- [Apps Script 配額](https://developers.google.com/apps-script/guides/services/quotas)
- [LockService](https://developers.google.com/apps-script/reference/lock/lock-service)、[Lock](https://developers.google.com/apps-script/reference/lock/lock)
- [CacheService Cache](https://developers.google.com/apps-script/reference/cache/cache)
- [Apps Script 部署](https://developers.google.com/apps-script/concepts/deployments)、[Web App](https://developers.google.com/apps-script/guides/web)、[manifest timeZone](https://developers.google.com/apps-script/manifest)
- [Sheet.copyTo](https://developers.google.com/apps-script/reference/spreadsheet/sheet)
- [MDN Web Authentication API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API)、[isUserVerifyingPlatformAuthenticatorAvailable](https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredential/isUserVerifyingPlatformAuthenticatorAvailable_static)
- [W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)、[passkeys.dev 裝置支援](https://passkeys.dev/device-support/)、[web.dev WebAuthn in iframe](https://web.dev/articles/webauthn-within-iframe)
- WebKit bug [241126](https://bugs.webkit.org/show_bug.cgi?id=241126)、[257176](https://bugs.webkit.org/show_bug.cgi?id=257176)、[251817](https://bugs.webkit.org/show_bug.cgi?id=251817)、[237350](https://bugs.webkit.org/show_bug.cgi?id=237350)；[Apple 開發者論壇 815784](https://developer.apple.com/forums/thread/815784)
- [S'moresUp 獎勵核准設定](https://smoresup.zendesk.com/hc/en-us/articles/28437531614487-The-Rewards-That-My-Family-Claims-Need-My-Approval-How-Do-I-Set-It-Up)、[S'moresUp 存點目標](https://smoresup.zendesk.com/hc/en-us/articles/28468062368663-How-Does-My-Kid-Save-Towards-a-Goal)
- [Common Sense Media：Joon](https://www.commonsensemedia.org/app-reviews/joon-kids-chore-list-chart)、[Joon 評論](https://appshunter.io/ios/app/1482225056/reviews)、[OurHome 家長評測](https://www.littledayout.com/parent-review-ourhome-app-for-home-organisation-and-behaviour-management/)、[ClassDojo 兌換說明](https://help.classdojo.com/hc/articles/14784730551053-Plus-Use-Rewards-to-Redeem-Home-Points)
- 雷達來源（本次未重讀）：[Pointsy](https://github.com/Highfivery/Pointsy)、[StarKids](https://apps.apple.com/tw/app/starkids/id6759061354)、[Cincinnati Children's 點數指南](https://www.cincinnatichildrens.org/)、[UW CBT+ 居家代幣指南](https://uwhatc.uw.edu/PDF/TF-%20CBT/pages/combined/CBT+-Home-Token-Economy-Guide.pdf)、[ScienceDaily 螢幕獎勵研究](https://www.sciencedaily.com/releases/2019/01/190109114811.htm)
