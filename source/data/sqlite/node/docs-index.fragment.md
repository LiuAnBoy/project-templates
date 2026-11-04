## 資料庫指令

| 指令                    | 用途                                       |
| ----------------------- | ------------------------------------------ |
| `pnpm db:generate`      | 依 schema 產生 migration，寫進 `drizzle/`  |
| `pnpm db:migrate`       | 套用尚未記錄的 migration，並建立資料庫檔案 |
| `pnpm db:status`        | 列出尚未套用的 migration，不寫入任何東西   |
| `pnpm test:integration` | 以資料庫自己的暫存檔案執行資料庫測試       |
