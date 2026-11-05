## PostgreSQL

連線設定在 `.env`：在本機執行的伺服器只讀 `DATABASE_URL`（必填，缺少時拒絕啟動並指出變數名稱）。容器裡的 `server` 與 `migrate` 不讀它，網址由 compose 依 `POSTGRES_USER`、`POSTGRES_PASSWORD`（必須是 URL 安全字元）、`POSTGRES_DATABASE` 與服務名稱組成。`POSTGRES_PORT` 是專案自己的 PostgreSQL 服務在本機迴路上的埠。要改用已在某個 docker 網路上執行的共用伺服器，只改 `.env` 的四行：`COMPOSE_FILE`、`POSTGRES_DOCKER_NETWORK`、`DATABASE_URL` 與 `POSTGRES_DATABASE`。

| 頁面                                     | 內容                         |
| ---------------------------------------- | ---------------------------- |
| [`rules/postgres.md`](rules/postgres.md) | PostgreSQL、migration 與交易 |
