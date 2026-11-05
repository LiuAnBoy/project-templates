# 資料庫

PostgreSQL，以 Drizzle 存取。Schema 寫在 `src/db/schema/`，migration 由 `pnpm db:generate` 產生並放在 `drizzle/`，以 `pnpm db:migrate` 套用；`pnpm db:status` 列出尚未套用的 migration。連線設定、命名與交易規則見 [`rules/postgres.md`](rules/postgres.md) 與 [`rules/data.md`](rules/data.md)。

在 Docker 裡，`migrate` 服務先以同一個映像執行 `node scripts/db/migrate.mjs`，成功後 `server` 才啟動；migration 失敗時 `server` 不會啟動，`docker compose up` 回傳非零。

## 資料表

目前沒有資料表。新增資料表時，在這一頁記錄它的欄位與用途，並與 schema 與 migration 在同一次變更中完成。

## Redis

Redis 只放可以遺失的資料：快取、鎖、發布訂閱與佇列。資料庫（若有）仍是唯一的資料來源，所以 Redis 的鍵不必在這一頁逐一記錄。連線設定與鍵的命名規則見 [`rules/redis.md`](rules/redis.md)。

預設的速率限制也改用 Redis 計數，讓多個執行個體共用同一個上限；Redis 失聯時，限制器回 503，不會放行未計數的請求，也不會讓請求卡住。
