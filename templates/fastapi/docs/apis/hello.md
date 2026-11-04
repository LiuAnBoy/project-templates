[apis](./README.md) · [docs](../README.md)

# hello

共用規則：[conventions.md](./conventions.md)。這條路由公開，沒有認證。

| 方法  | 路徑            | 說明                 |
| ----- | --------------- | -------------------- |
| `GET` | `/api/v1/hello` | 回傳固定的問候訊息。 |

## GET /api/v1/hello

回傳固定的問候訊息。

參數：無。

實作：Router 呼叫 `service.get_hello()`，把 `HelloData(message="hello world!!")` 交給 `success(...)` 包成封套，並以 `response_model=Envelope[HelloData]` 宣告回應。

回應 200：

```json
{ "success": true, "payload": { "data": { "message": "hello world!!" } } }
```

可能的失敗：這條路由沒有自己的失敗。同一個 client 超過速率限制回 429（`too many requests`，見 [conventions.md](./conventions.md#速率限制)），不存在的路徑回 404（`not found`），未預期的錯誤回 500（`internal error`），完整清單見 [conventions.md](./conventions.md#失敗表)。
