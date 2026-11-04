# 資料庫

這個專案只安裝了 Redis：沒有資料庫，沒有資料表，也沒有 migration。資料表與欄位的命名、交易與 migration 的通則見 [`rules/data.md`](rules/data.md)。

## Redis

Redis 只放可以遺失的資料：快取、鎖、發布訂閱與佇列。資料庫（若有）仍是唯一的資料來源，所以 Redis 的鍵不必在這一頁逐一記錄。連線設定與鍵的命名規則見 [`rules/redis.md`](rules/redis.md)。

預設的速率限制也改用 Redis 計數，讓多個執行個體共用同一個上限；Redis 失聯時，限制器回 503，不會放行未計數的請求，也不會讓請求卡住。
