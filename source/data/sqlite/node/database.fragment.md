# 資料庫

SQLite，以 Drizzle 存取。Schema 寫在 `src/db/schema/`，migration 由 `pnpm db:generate` 產生並放在 `drizzle/`，以 `pnpm db:migrate` 套用；`pnpm db:status` 列出尚未套用的 migration。連線設定、命名與交易規則見 [`rules/sqlite.md`](rules/sqlite.md) 與 [`rules/data.md`](rules/data.md)。

在 Docker 裡，`migrate` 服務先以同一個映像執行 `node scripts/db/migrate.mjs`，在具名 volume `sqlite-data` 建立資料庫檔案，成功後 `server` 才啟動；migration 失敗時 `server` 不會啟動，`docker compose up` 回傳非零。

## 資料表

目前沒有資料表。新增資料表時，在這一頁記錄它的欄位與用途，並與 schema 與 migration 在同一次變更中完成。
