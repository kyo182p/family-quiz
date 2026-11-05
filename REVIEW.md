# REVIEW T-006 第 1 輪

自審(環境沒有 GEMINI_API_KEY,依派工指示不走異質審核)

- 〔實測〕`node --test` 93/93 通過,Orchestrator 親自重跑;index.html diff 全文讀過。
- 上一輪兩個問題已修:只更新本機原有題庫、開站不帶 withBalance。
- 確認:requestId 在底板存活期間沿用、busy 自動重試用同一個 id;離線時沒有枚數也沒有申請鈕;使用者文字都經 esc;前端不自己算 reason。
- 建議(不打回):任何錯誤都顯示「連不到雲端」,server_error 時文字不完全精確;小孩端不需要區分,保留。
- 無新問題。
