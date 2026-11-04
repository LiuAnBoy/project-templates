# 資料庫

SQLite，以 SQLAlchemy 2 存取（驅動是 `aiosqlite`）。Model 寫在 `src/db/models/`，migration 由 `make db-generate` 以 Alembic 產生並放在 `alembic/versions/`，以 `make db-migrate` 套用；`make db-status` 列出尚未套用的 migration。連線設定、命名與交易規則見 [`rules/sqlite.md`](rules/sqlite.md) 與 [`rules/data.md`](rules/data.md)。

這份 FastAPI 的資料庫程式碼有整合測試，但沒有正式環境的使用紀錄。

## 資料表

目前沒有資料表。新增資料表時，在這一頁記錄它的欄位與用途，並與 model 與 migration 在同一次變更中完成。
