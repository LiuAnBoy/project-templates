## MySQL

連線設定在 `.env`：在本機執行的伺服器只讀 `DATABASE_URL`（必填，缺少時拒絕啟動並指出變數名稱）。容器裡的 `server` 與 `migrate` 不讀它，網址由 compose 依 `MYSQL_USER`、`MYSQL_PASSWORD`（必須是 URL 安全字元）、`MYSQL_DATABASE` 與服務名稱組成；`MYSQL_ROOT_PASSWORD` 只給專案自己的 MySQL 服務建立資料庫與使用者，compose 在 `server` 與 `migrate` 裡把它清空。`MYSQL_PORT` 是專案自己的 MySQL 服務在本機迴路上的埠。

| 頁面                               | 內容                                         |
| ---------------------------------- | -------------------------------------------- |
| [`rules/mysql.md`](rules/mysql.md) | MySQL、migration、交易與既有資料庫的接手流程 |
