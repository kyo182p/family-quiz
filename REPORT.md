# T-002 第 2 輪執行回報

## 1. 修改檔案

- 〔記錄〕`Code.gs`：safeCell 對空字串、null、undefined 回傳空字串；還原 writeQuestionRows、removeQuestionRows 至 HEAD；badges 略過非法鍵；balance 在鎖內先檢查玩家、補入再查餘額。另依最後一條驗收，原樣回送且與雲端相同的玩家資料直接保留，避免徽章合併新增欄位。
- 〔記錄〕`test/fake-gas.js`：convert 保留單獨一個引號，其餘引號開頭字串仍去掉第一個引號。
- 〔記錄〕`test/backend.test.js`：新增 4 個回歸／對抗測試，涵蓋空值與逐格掃描、合法非法鍵混送、balance 首次補入與冪等、舊前端原樣回送 players。既有非法鍵測試改為略過；公式測試限於本單保留 safeCell 的儲存位置，不再要求已還原的題目表經 safeCell。
- 〔記錄〕`REPORT.md`：寫入本輪修改、驗收與問題記錄；前輪回報仍在 `rounds/T-002-R1/REPORT.md`。

## 2. 驗收標準與證據

### 2.1 全數測試通過

〔實測〕指令：`node --test`，exit code 0。35 個具名測試加 helper 檔案共 36 項。

```text
tests 36
suites 0
pass 36
fail 0
cancelled 0
skipped 0
todo 0
```

### 2.2 空字串與單獨引號

〔實測〕同一測試依序執行 setup、playerSave、saveBank、badges，確認正常入帳列異常欄嚴格等於空字串，餘額為 1；遍歷 env.sheets 每張表的每格值，沒有單獨引號。掃描完成後另直接寫入單獨引號，證明嚴格假環境確實保留它。safeCell 的空字串、null、undefined、0、false 也逐一驗證。

```text
✔ T002 R2: empty safeCell values stay empty and normal ledger anomalies read as empty
```

### 2.3 題目表兩函式與 HEAD 一致

〔實測〕執行 `git diff HEAD -- Code.gs`，題目表兩函式沒有變更區塊。另用 Node 讀取 `git show HEAD:Code.gs` 與工作區 Code.gs，正規化換行後，以函式名稱擷取至結束括號、assert.equal 比較完整函式文字；exit code 0，輸出：

```text
writeQuestionRows: identical to HEAD
removeQuestionRows: identical to HEAD
```

### 2.4 非法徽章鍵略過

〔實測〕同時傳入 valid 與 bad:key，確認 ok:true，回應及徽章 JSON 只有 valid；入帳表僅一列 valid，銀總數為 1。

```text
✔ T002 R2: invalid badge key is skipped while valid key is stored and credited
```

### 2.5 balance 首次補入且不重複

〔實測〕直接用 putBank 植入舊 p1 的兩枚銀徽章，徽章表植入一枚金徽章；確認尚無 ledgerinit 且入帳表空白，未先呼叫 badges/saveBank。第一次 balance 得到銀 2、金 1，第二次結果相同，入帳仍為 3 列，來源皆補入且異常欄為空字串。

```text
✔ T002 R2: first balance backfills cloud p1 bank and legacy badges exactly once
```

### 2.6 舊前端原樣回送 players

〔實測〕先存 p1 與 p2，從 listBanks 取回完整題庫；模擬既有 bsSave，只修改頂層 rec、days、summary、updatedAt，原樣回送 players 及 p1At。保存後完整 players 深度比較相同，p1 的三個新進度欄位全部採用。

```text
✔ T002 R2: legacy frontend echoes cloud players unchanged while saving new p1 answers
```

〔實測〕`git diff --check -- Code.gs test/fake-gas.js test/backend.test.js REPORT.md` 通過，exit code 0；Git 僅提示 REPORT.md 換行將轉為 CRLF，沒有空白格式錯誤。

## 3. 偏離事項

- 〔記錄〕為達成最後一條明確驗收，在具體步驟列出的修正之外，saveBank 增加一行相同玩家資料直接保留的判斷。首次新增測試實測失敗：未變動的 p2 badge 經 mergeBadgeRec 後多出 cells、ok、meta，無法滿足 p2 資料不變。修正後同一測試通過；未改資料合約或其他檔案。
- 〔記錄〕其餘無偏離；僅修改指定四檔，未新增相依、未連線真實服務、未啟動瀏覽器、未 commit 或 push。

## 4. 遇到的問題與未決事項

- 〔實測〕還原題目表函式後，舊測試用 +cmd 題名在題目表第 2 欄觸發假環境的公式紀錄。依工單明確要求保留 HEAD 寫法，調整測試範圍，題庫 JSON 與玩家文字的 safeCell 防護仍驗證通過。
- 〔記錄〕題目表的公式與純文字格式行為維持 HEAD，並未在本單擴大修改；真 Sheets 對單獨引號及相關文字格式的行為未實機驗證。假環境依工單採嚴格解讀，應用程式空值不再寫入單獨引號。
- 〔記錄〕所有六條本輪驗收均已通過，無阻塞事項。工作區原有的其他修改與未追蹤檔案保留。
