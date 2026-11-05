## SQLite

資料庫檔案的路徑由 `.env` 的 `DATABASE_URL` 指定（相對於伺服器啟動時的目錄），必填，缺少時拒絕啟動並指出變數名稱。檔案必須已經存在：只有 migration 會建立它，路徑錯誤時啟動失敗，不會悄悄建出空資料庫。資料庫檔案放在 `data/`，該資料夾自帶 `.gitignore`，檔案不會被提交。在 Docker 裡，檔案放在具名 volume `sqlite-data`（掛在 `/app/data`），由 `migrate` 以 uid 1000 建立，`server` 之後讀取同一個檔案。

| 頁面                                 | 內容                     |
| ------------------------------------ | ------------------------ |
| [`rules/sqlite.md`](rules/sqlite.md) | SQLite、migration 與交易 |
