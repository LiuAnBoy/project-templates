# HTTP 封裝（http）

`src/shared/http/http.ts` 是專案唯一使用 `axios` 的檔案。所有 API 呼叫都從這裡走，拿到的是解開 envelope 後的資料。規則見 [../rules/data-layer.md](../rules/data-layer.md)。

## API 回應格式

- 成功：`{"success": true, "payload": {"data": ...}}`。清單另外帶 `page`、`page_size`、`total_count`。寫入可能只回 `{"success": true}`，這時呼叫結果是 `undefined`。
- 失敗：`{"success": false, "payload": {"message": "..."}}`，HTTP status 表示失敗種類。

## 方法

路徑相對於 API 基底（`/api/v1`）。基底由 `src/shared/http/base-url.ts` 決定，每個請求都重新取得；細節見 [../rules/architecture.md](../rules/architecture.md)。只傳路徑，不要傳完整網址：絕對或 `//` 開頭的路徑會接在基底後面，不會被跟隨，以免 token 送到其他主機。

| 方法                                                       | 用途                                         | 回傳                                    |
| ---------------------------------------------------------- | -------------------------------------------- | --------------------------------------- |
| `http.get<T>(path, query?, options?)`                      | 取一個物件                                   | `payload.data`                          |
| `http.list<T>(path, query?, options?)`                     | 取一頁清單                                   | `{ items, page, pageSize, totalCount }` |
| `http.getAllPages<T>(path, query?, options?)`              | 一次讀完整份清單（每頁 100 筆，最多 200 頁） | `T[]`                                   |
| `http.getText(path, query?, options?)`                     | 取純文字                                     | `string`                                |
| `http.post<T>` / `put` / `patch` `(path, body?, options?)` | 送 JSON 物件或 `FormData`                    | `payload.data`                          |
| `http.delete<T>(path, options?)`                           | 刪除                                         | `payload.data`                          |

- `query` 裡值為 `undefined` 或 `null` 的欄位不會送出。
- `options` 是 `{ signal?, timeoutMs? }`：`signal` 用來取消請求，`timeoutMs` 覆蓋預設的 15 秒逾時。

```ts
import { http } from '@/shared/http/http';

const hello = await http.get<{ message: string }>('/hello');
const page = await http.list<Product>('/products', { page: 1, q: keyword });
```

## 錯誤

| 型別                                  | 何時丟出                                     | 內容                                                   |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `HttpError`                           | 伺服器回了非 2xx，或 2xx 但格式不是 envelope | `status`、`message`、`requestId`、`retryAfter`、`body` |
| `NetworkError`                        | 完全沒有回應                                 | `cause`                                                |
| `TimeoutError`（繼承 `NetworkError`） | 逾時沒有回應                                 | `cause`                                                |

- 取消請求（`signal` 被中止）時，原樣丟出 axios 的 `CanceledError`，用 axios 的 `isCancel` 判斷，不要當成失敗顯示。
- `getErrorMessage(error, fallback?)` 回傳該顯示給使用者的文字：`HttpError` 用伺服器的 `message`，連線問題用固定文字，其他用 fallback。

## Token 與 401

`shared/` 不能 import `modules/`，所以由功能模組在啟動時註冊：

- `setAuthTokenProvider(provider)`：provider 回傳 bearer token（或其 Promise），每個請求都會帶 `Authorization: Bearer <token>`。
- `setUnauthorizedHandler(handler)`：API 回 401 時，在請求 reject 之前執行，例如導向登入頁。

兩者都可傳 `null` 清除。此範本沒有認證，所以目前沒有任何地方註冊它們。

## 測試

[`../../src/shared/http/tests/http.test.ts`](../../src/shared/http/tests/http.test.ts) 以替換 `httpClient.defaults.adapter` 的方式測試封裝本身。
