# 家庭題庫練習（GitHub Pages 版）

這是植物小學堂的獨立開發版本，和目前 claude.ai 上的網頁版互不影響。

- 前端：`index.html`，放在 GitHub Pages，任何人打開網址就能練習，不需要 Claude 帳號
- 後端：`apps-script/Code.gs`，綁在一份 Google 試算表上，負責：
  - 驗證「家庭邀請碼」、控管每天的 AI 次數
  - 代替網頁呼叫 Claude API（API 金鑰只存在後端，網頁看不到）
  - 把各家庭的題庫存在試算表
  - 記錄每次 AI 呼叫的 token 數與估計費用

---

## 一、要準備的東西

| # | 項目 | 用途 | 備註 |
|---|---|---|---|
| 1 | GitHub 帳號 | 放網站（GitHub Pages） | 免費方案需要公開的 repo；程式裡沒有金鑰，公開沒問題 |
| 2 | Google 帳號 | 建試算表和 Apps Script | 建議用你自己的帳號，資料都在你的雲端硬碟 |
| 3 | Anthropic Console 帳號 | 申請 Claude API 金鑰 | 網址：platform.claude.com；和 Claude Max 訂閱分開計費 |
| 4 | 信用卡 | 在 Console 儲值 | 建議先儲值 5～10 美元，**先不要開自動儲值** |
| 5 | 家庭邀請碼清單 | 給每個家庭一組 | 自己訂，例如 `FAMILY-A001`；建議用不容易猜到的組合，邀請碼等於密碼 |
| 6 | 每個家庭的每日 AI 上限 | 控制費用 | 建議先設 10 次 |

---

## 二、設定步驟

### 步驟 1：申請 Claude API 金鑰

1. 到 platform.claude.com 註冊或登入。
2. Settings → Billing → Buy credits，儲值 5～10 美元。自動儲值先保持關閉。
3. Settings → API Keys → Create Key，複製金鑰（`sk-ant-` 開頭）。**金鑰只會顯示一次**，先貼到安全的地方。

### 步驟 2：建立 Google 試算表與 Apps Script

1. 在 Google 雲端硬碟新增一份試算表，名稱例如「家庭題庫後端」。
2. 選單「擴充功能 → Apps Script」。
3. 把 `apps-script/Code.gs` 的內容整個貼上，取代原本的程式，儲存。
4. 上方函式選單選 `setup`，按「執行」。第一次會要求授權，依畫面允許。
   - 執行完試算表會多出四個工作表：家庭、題庫、題目、用量。
   - 「家庭」工作表會有一列測試用的 `TEST-0000`。
5. 左側「專案設定（齒輪）」→ 最下面「指令碼屬性」→ 新增：
   - 屬性：`ANTHROPIC_API_KEY`
   - 值：步驟 1 複製的金鑰
6. 右上「部署 → 新增部署作業」：
   - 類型：網頁應用程式
   - 執行身分：我
   - 誰可以存取：所有人
   - 按「部署」，複製「網頁應用程式網址」（`https://script.google.com/macros/s/…/exec`）。
7. （建議）左側「觸發條件」→ 新增：函式 `cleanupCounters`、時間驅動、每天一次，用來清掉前幾天的次數計數。

### 步驟 3：設定家庭邀請碼

在「家庭」工作表每個家庭一列：

| 邀請碼 | 家庭名稱 | 每日 AI 上限 | 啟用 | 備註 |
|---|---|---|---|---|
| FAMILY-A001 | 甲家 | 10 | TRUE | |
| FAMILY-B002 | 乙家 | 10 | TRUE | |

- 要暫停某個家庭：把「啟用」改成 FALSE。
- 測試完可以刪掉 `TEST-0000`。

### 步驟 4：把後端網址填進網頁

打開 `index.html`，找到這一行（在 `<script>` 裡，搜尋 `CONFIG`）：

```js
const CONFIG={API_URL:''};
```

改成步驟 2 複製的網址：

```js
const CONFIG={API_URL:'https://script.google.com/macros/s/xxxx/exec'};
```

### 步驟 5：發布到 GitHub Pages

1. 在 GitHub 建一個新的 repo，例如 `family-quiz`，設為 Public。
2. 上傳 `index.html` 到 repo 根目錄。
3. Settings → Pages → Build and deployment：
   - Source：Deploy from a branch
   - Branch：`main`、資料夾 `/ (root)` → Save
4. 等一兩分鐘，網址會是 `https://你的帳號.github.io/family-quiz/`。

### 步驟 6：測試

1. 打開網址，右上角「🧪 自訂題庫」→「⚙️ 家庭設定」→ 輸入 `TEST-0000` → 驗證。
2. 建立一個題庫 → 上傳資料 → 貼一段文字或放一張講義照片 → 開始分析。
3. 回到試算表確認：
   - 「題庫」有一列資料
   - 「題目」可以看到每一題
   - 「用量」記錄了這次的 token 數和估計美元
4. 到 Console 的 Usage 頁面，確認實際扣款和「用量」工作表差不多。

---

## 三、之後修改程式

- **改 `index.html`**：重新上傳到 GitHub，幾分鐘後生效。
- **改 `Code.gs`**：Apps Script 裡「部署 → 管理部署作業 → 編輯（鉛筆）→ 版本：新版本 → 部署」。這樣網址不變，不用改 `index.html`。

---

## 四、模型與費用設定（`Code.gs` 開頭）

| 常數 | 預設 | 說明 |
|---|---|---|
| `MODELS.default` | `claude-sonnet-5-5` | 照片、字幕分析 |
| `MODELS.quick` | `claude-haiku-4-5-20251001` | 用已有觀念產生更多題目 |
| `PRICE` | Sonnet 2／10、Haiku 1／5 | 每百萬 token 美元，只用來估算「用量」工作表，請依官方價格調整 |
| `MAX_IMAGES` | 5 | 每次最多幾張照片（網頁會自動分批） |

---

## 五、安全與限制

- API 金鑰只存在 Apps Script 的指令碼屬性，網頁原始碼裡沒有。
- 邀請碼等於密碼：拿到邀請碼的人可以讀寫該家庭的題庫、使用 AI 次數。外流時把「啟用」改成 FALSE，再發新的。
- 「題目」工作表是方便查看用的，在這裡修改不會回寫到網站；以「題庫」工作表的 JSON 為準。
- 植物小學堂內建題目寫在 `index.html` 裡；在植物小學堂「用 AI 產生新題目」收進的題目，目前仍只存在該裝置。
- 練習、間隔複習、朗讀都不使用 AI，不會產生費用。
