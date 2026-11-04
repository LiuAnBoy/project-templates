# API

所有路由前綴為 `/api/v1`，預設埠 8000。目前沒有認證，每一條路由都是公開的。

## 回應格式

成功：

```json
{ "success": true, "payload": { "data": { "message": "hello world!!" } } }
```

列表一律分頁，分頁欄位與 `data` 同層，使用 snake_case：

```json
{
  "success": true,
  "payload": { "data": [], "page": 1, "page_size": 20, "total_count": 0 }
}
```

失敗只帶訊息，狀態碼才表示失敗的種類：

```json
{ "success": false, "payload": { "message": "not found" } }
```

每個回應都帶 `x-request-id` 標頭。

## 端點索引

| 方法 | 路徑            | 認證 | 說明                            |
| ---- | --------------- | ---- | ------------------------------- |
| GET  | `/api/v1/hello` | 公開 | [hello](hello.md)，回傳問候訊息 |

## 錯誤訊息

訊息是固定文字，來自失敗表（`src/common/errors/failures.ts`）。

| 狀態碼 | 訊息                                           | 說明                                             |
| ------ | ---------------------------------------------- | ------------------------------------------------ |
| 400    | `invalid request`                              | 請求格式錯誤或驗證失敗                           |
| 400    | `invalid value for '{name}'`                   | 指定欄位的值無效（名稱取自伺服器定義的封閉集合） |
| 401    | `authentication required`                      | 缺少或無效的憑證                                 |
| 403    | `not allowed`                                  | 被拒絕                                           |
| 404    | `not found`                                    | 找不到資源（路由不存在也是這則）                 |
| 409    | `the request conflicts with the current state` | 狀態衝突                                         |
| 409    | `the resource is busy`                         | 資源忙碌中                                       |
| 413    | `the request body is too large`                | 請求本文過大                                     |
| 415    | `unsupported media type`                       | 不支援的內容類型                                 |
| 422    | `the request cannot be processed`              | 格式正確但規則不允許                             |
| 429    | `too many requests`                            | 超過速率限制                                     |
| 503    | `service unavailable`                          | 相依服務暫時無法使用                             |
| 500    | `internal error`                               | 其他未預期的錯誤                                 |
