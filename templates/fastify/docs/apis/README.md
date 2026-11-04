[docs](../README.md)

# HTTP API 參考

除了健康檢查，所有路由的前綴都是 `/api/v1`，預設埠 8000。目前沒有認證，每一條路由都是公開的；加入非公開路由的步驟見 [../rules/api-and-errors.md](../rules/api-and-errors.md)。

寫任何 API 程式之前先讀 [conventions.md](./conventions.md)，它是設計文件；各路由群的文件只記路由本身。

## 路由索引

| 路徑                | 是什麼                                           | 文件                     |
| ------------------- | ------------------------------------------------ | ------------------------ |
| `GET /api/v1/hello` | 回傳固定的問候訊息。                             | [hello.md](./hello.md)   |
| `GET /api/health`   | 健康檢查（liveness），在封套之外、不受速率限制。 | [health.md](./health.md) |

## 回應形狀

封套之內的回應只有三種形狀；[conventions.md](./conventions.md) 說明規則。

| 回應 | Body                                                                                          |
| ---- | --------------------------------------------------------------------------------------------- |
| 成功 | `{"success": true, "payload": {"data": <object>}}`                                            |
| 列表 | `{"success": true, "payload": {"data": [...], "page": 1, "page_size": 20, "total_count": 0}}` |
| 失敗 | `{"success": false, "payload": {"message": "<固定文字>"}}`                                    |

HTTP status 表示結果類別；status 加 message 辨識一個失敗，完整清單在 [conventions.md](./conventions.md#失敗表)。列表路由吃 `page`（預設 1）與 `page_size`（預設 20，最大 100）。每個回應都帶 `x-request-id` 標頭。每個 client 預設每 60 秒最多 300 次請求，超過回 429（`too many requests`）並帶 `Retry-After`，設定見 [conventions.md](./conventions.md#速率限制)。

## 封套之外的路由

| 路徑              | 回應                  | 說明                                                                        |
| ----------------- | --------------------- | --------------------------------------------------------------------------- |
| `GET /api/health` | 200 `{"status":"ok"}` | 健康檢查，不在 `/api/v1` 之下，回裸狀態，讓負載平衡器直接讀；不受速率限制。 |

日後如果加入檔案下載、串流或回裸狀態的 webhook，也在這裡列出路徑與回應，並在路由的程式註解註明。

## 檔案

| 檔案                               | 內容                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [conventions.md](./conventions.md) | 設計文件：封套、狀態碼、失敗表、query、分頁、body、snake_case 與 camelCase、建構器與 wrapper、新增路由的步驟。 |
| [hello.md](./hello.md)             | `GET /api/v1/hello`。                                                                                          |
| [health.md](./health.md)           | `GET /api/health`。                                                                                            |
