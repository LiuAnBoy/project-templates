# GET /api/v1/hello

回傳固定的問候訊息。這是目前唯一的路由。

- 認證：公開（目前沒有認證）。
- 參數：無。

## 回應

200：

```json
{ "success": true, "payload": { "data": { "message": "hello world!!" } } }
```

## 實作

Controller 呼叫 `HelloService.getHello()`，回傳 `{ message: "hello world!!" }`；`ResponseEnvelopeInterceptor` 再包成 envelope。

## 錯誤

這條路由沒有自己的錯誤。不存在的路徑回 404（`not found`），未預期的錯誤回 500（`internal error`），細節見 [錯誤訊息](README.md#錯誤訊息)。
