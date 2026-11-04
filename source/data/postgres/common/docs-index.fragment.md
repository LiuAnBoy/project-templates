## PostgreSQL

連線設定在 `.env`：伺服器只讀 `DATABASE_URL`（必填，缺少時拒絕啟動並指出變數名稱）；`POSTGRES_DATABASE`、`POSTGRES_USER`、`POSTGRES_PASSWORD` 與 `POSTGRES_PORT` 供 `docker-compose.dev.yml` 啟動開發用的 PostgreSQL，換到共用的伺服器時只改 `.env`。

| 頁面                                     | 內容                         |
| ---------------------------------------- | ---------------------------- |
| [`rules/postgres.md`](rules/postgres.md) | PostgreSQL、migration 與交易 |
