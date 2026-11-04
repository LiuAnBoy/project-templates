[apis](./README.md) · [docs](../README.md)

# hello

共用規則：[conventions.md](./conventions.md)。這是目前唯一的路由，公開，沒有認證。

| 方法  | 路徑            | 說明                 |
| ----- | --------------- | -------------------- |
| `GET` | `/api/v1/hello` | 回傳固定的問候訊息。 |

## GET /api/v1/hello

回傳固定的問候訊息。

參數：無。

實作：路由呼叫 `getHello()`，把 `{ message: "hello world!!" }` 交給 `success(...)` 包成封套，並以 `successEnvelope(...)` 宣告回應 schema。

回應 200：

```json
{ "success": true, "payload": { "data": { "message": "hello world!!" } } }
```

可能的失敗：這條路由沒有自己的失敗。不存在的路徑回 404（`not found`），未預期的錯誤回 500（`internal error`），完整清單見 [conventions.md](./conventions.md#失敗表)。
