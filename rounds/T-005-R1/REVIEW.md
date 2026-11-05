# REVIEW T-005 第 1 輪

自審(環境沒有 GEMINI_API_KEY,依派工指示不走異質審核)

- 〔實測〕`npm run build` 成功;`node --test` 84/84 通過,Orchestrator 親自重跑;index.html diff 全文讀過。
- 〔實測〕刪除本機鍵的正則 `^p[a-z0-9]{1,12}:` 不會命中現有鍵:掃過 index.html 全部字串,唯一符合形狀的是 CSS `position:`,不是 localStorage 鍵。
- 成立,併入 T-006 修復(同區域):
  1. `BANKS.forEach(localPut)` 把所有雲端題庫寫進本機。別台裝置刪掉的題庫,這台下次開站會當成「本機有、雲端沒有」傳回去,讓刪除失效;也可能塞爆 localStorage。
  2. 開站 `refreshPlayers` 帶 `withBalance:true`,每次開站對每位玩家重算並觸發補入;應該只在打開玩家底板時才帶。
- 偏離仲裁:無偏離;補充選擇(快取不放餘額、被拒玩家不改以 p1 重送)合理,接受。
