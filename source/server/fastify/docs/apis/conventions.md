[apis](./README.md) · [docs](../README.md)

# API 設計準則

這份文件是 `/api/v1` 下每一條路由遵守的設計。新增或修改任何 API 前先讀它；各路由群的文件（[README.md](./README.md) 的索引）只記路由本身，不重述這裡的共用規則。實作規則與認證在英文的 [../rules/api-and-errors.md](../rules/api-and-errors.md)，這裡不重述。

## 規則一覽

1. 路由回應的 JSON 一律是封套：布林 `success` 加上 `payload` 物件，頂層沒有別的東西。封套之外的路由只有 [README.md](./README.md#封套之外的路由) 列的那幾條。
2. 成功時 `payload.data` 是路由的資料；列表另在 `data` 旁帶 `page`、`page_size`、`total_count`，別無他物。
3. 失敗時 `payload` 只有 `message`，是失敗表裡的固定英文。沒有 code、沒有 details、沒有欄位對照。Client 以 HTTP status 加 message 辨識失敗。
4. 路由只用本框架的建構器組回應，用 service 丟的失敗表項目回報錯誤，從不自己組封套或丟自由文字（見下方「建構器與 wrapper」）。
5. 輸入（query、path、body）在邊緣以 schema 驗證，驗證失敗一律是 `invalid request`，問題清單不外送。
6. 列表路由吃 `page`、`page_size`，並回分頁封套。
7. 所有失敗都是失敗表的一列，每列的 message 全表唯一。
8. wire 上的 key（query、body、`data` 內）一律 snake_case；程式內部維持 camelCase，在邊界逐個欄位對應，不用通用的 key 改寫器。
9. id 是 UUID，在 wire 上是字串；時間是 ISO 8601 字串（含時區偏移），不是 Unix 整數；路徑是複數 kebab-case（`/api/v1/order-items`）。

## 封套

### 成功

```json
{ "success": true, "payload": { "data": { "message": "hello world!!" } } }
```

`data` 是路由的物件，或列表路由的陣列。沒有資料可回（例如刪除）時 `data` 是 `{}`，所以成功的回應一定有 `data`。HTTP status 是 200，新增資源是 201。

### 列表

```json
{
  "success": true,
  "payload": { "data": [], "page": 1, "page_size": 20, "total_count": 0 }
}
```

`data` 是該頁的陣列；`page`、`page_size` 是實際生效的值（`page_size` 被截斷時回報截斷後的值）；`total_count` 是符合條件的全部筆數。列表 payload 沒有別的欄位，列表一律分頁。

### 失敗

```json
{ "success": false, "payload": { "message": "not found" } }
```

失敗沒有 code 或欄位對照：同一個 status 下的失敗靠 message 區分。

### 標頭

每個回應（成功與失敗）都帶 `x-request-id`：呼叫者送來且符合 `[A-Za-z0-9._-]{8,128}` 的值，否則是新的 UUID。500 的 log 帶同一個 id，方便對照。

## 選擇 `data` 的形狀

- 單一資源放在它的名字底下：`{ "order": … }`，或直接是資源的物件；同一個專案內選一種並維持一致。
- 分頁列表只放陣列，本身就是 `data`。
- 刪除回 `{}`，或回 `{ "id": "…" }`；同一個專案內選一種。
- 時間欄位是 ISO 8601 字串，id 欄位是 UUID 字串。

## 狀態碼

| Status | 用在                                                                    |
| ------ | ----------------------------------------------------------------------- |
| 200    | 讀取、更新、刪除。                                                      |
| 201    | 新增資源。                                                              |
| 400    | 請求格式不對：body 不是合法 JSON、query、路徑參數或 body 欄位驗證失敗。 |
| 401    | 缺少或無效的憑證。                                                      |
| 403    | 身分明確但被拒絕。                                                      |
| 404    | 資源或路由不存在（也用在他人的資源，避免 id 被探測）。                  |
| 409    | 與現有資料的狀態衝突。                                                  |
| 413    | 請求本文過大。                                                          |
| 415    | 不支援的 content type。                                                 |
| 422    | 格式正確、但規則拒絕的請求。                                            |
| 429    | 超過速率限制。                                                          |
| 503    | 相依服務暫時無法使用，client 應重試。                                   |
| 500    | 未預期的錯誤，message 固定為 `internal error`。                         |

## 失敗表

失敗表（`src/common/errors/failures.ts`）是唯一的表：每一列把內部 code 對到 HTTP status 與一則固定英文 message。code 只給 log 與測試用，從不序列化。任兩列的 message 都不同，所以 status 加 message 就辨識得出失敗。下表複製自程式，兩邊要一起改。

message 只含固定文字，或伺服器自己定義的名稱；message 不含路徑、密鑰、SQL、堆疊或儲存的資料。框架或 guard 丟出的錯誤也一律換成其 status 的表項目，沒有對應項目時，4xx 用 `invalid request`，其餘用 `internal error`。

| Code                   | Status | Message                                        | 何時                                                                                                                |
| ---------------------- | ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `invalidRequest`       | 400    | `invalid request`                              | 請求格式不對或驗證失敗：body 不是合法 JSON、query 或路徑參數不符 schema。zod／pydantic 的問題清單只寫進 debug log。 |
| `invalidField`         | 400    | `invalid value for '{name}'`                   | 指定欄位的值無效；`{name}` 只會是伺服器自己定義的名稱，經 `[A-Za-z0-9_.-]{1,40}` 過濾，否則顯示 `?`。               |
| `unauthorized`         | 401    | `authentication required`                      | 缺少或無效的憑證（目前沒有路由使用）。                                                                              |
| `forbidden`            | 403    | `not allowed`                                  | 身分明確但被拒絕。                                                                                                  |
| `notFound`             | 404    | `not found`                                    | 找不到資源；路由不存在也是這一列。                                                                                  |
| `conflict`             | 409    | `the request conflicts with the current state` | 與現有資料的狀態衝突，例如唯一約束被違反。                                                                          |
| `busy`                 | 409    | `the resource is busy`                         | 資源正被占用，稍後重試。                                                                                            |
| `payloadTooLarge`      | 413    | `the request body is too large`                | 請求本文過大。                                                                                                      |
| `unsupportedMediaType` | 415    | `unsupported media type`                       | 不支援的 content type。                                                                                             |
| `unprocessable`        | 422    | `the request cannot be processed`              | 格式正確但規則不允許。                                                                                              |
| `tooManyRequests`      | 429    | `too many requests`                            | 超過速率限制。                                                                                                      |
| `unavailable`          | 503    | `service unavailable`                          | 相依服務（資料庫、Redis 等）連不上或逾時；client 應該重試。                                                         |
| `internal`             | 500    | `internal error`                               | 其他未預期的錯誤；細節只寫進伺服器 log。                                                                            |

## 速率限制

每條路由預設都有速率限制，不需要任何設定：每個 client 每 60 秒 300 次，所有路由（包含不存在的路徑）合計。超過時回 429 `too many requests`，用失敗封套，並帶 `Retry-After` 標頭（秒）。

調整方式是環境變數，寫在 `.env`（範例在 `.env.example`），啟動時驗證：

| 變數                        | 預設值 | 說明                                             |
| --------------------------- | ------ | ------------------------------------------------ |
| `RATE_LIMIT_MAX`            | `300`  | 每個 client 在一個時間窗內的請求上限，至少 1     |
| `RATE_LIMIT_WINDOW_SECONDS` | `60`   | 時間窗，單位為秒，至少 1                         |
| `TRUST_PROXY`               | 空     | 前面有反向代理時，填代理的位址或網段，以逗號分隔 |

- client 以連線的來源位址計算。`x-forwarded-for` 預設不採信，因為沒有代理時它是呼叫者自己填的字串，會讓人繞過限制；只有來自 `TRUST_PROXY` 所列位址的連線，才採信它。`true`、`*`、`0.0.0.0/0` 這類全盤信任與單純的數字會在啟動時被拒絕。
- 前面有反向代理或網頁伺服器時一定要設定 `TRUST_PROXY`，否則所有訪客共用代理的位址，一起被擋。Next 網頁伺服器的 server component 呼叫不帶訪客位址，部署時還要調高上限，細節在英文的 [../rules/api-and-errors.md](../rules/api-and-errors.md)。
- 計數存在單一程序的記憶體；跑第二個 instance 時要改用共用儲存（Redis overlay 提供）。
- 預設沒有任何路由豁免。路由要豁免（例如探針）時，在該路由的 `config` 設 `rateLimit: false`。

## Query

query 用路由 `schema.querystring` 的 zod schema 驗證；`z.coerce.number()` 把字串轉成數字。驗證失敗是 400 `invalid request`。query 的 key 一律是 snake_case。

## 分頁

列表路由的 query 包含：

| 參數        | 規則                                                                   |
| ----------- | ---------------------------------------------------------------------- |
| `page`      | 預設 1，最小 1。                                                       |
| `page_size` | 預設 20，最小 1；超過 100 時截為 100，並如實回報在回應的 `page_size`。 |

路由以 `paginated(items, page, pageSize, totalCount)` 回傳列表，query 用 `pageQuerySchema`。超過最後一頁不是錯誤：回 200，`data` 是 `[]`，`total_count` 仍是真正的總數。列表要有固定的排序，換頁才不會重複或漏掉筆數。

## Body

body 用路由 `schema.body` 的 zod schema 驗證，失敗一律是 `invalid request`。空的 JSON body 視為 `{}`，格式錯誤的 JSON 是 400 `invalid request`。body 的 key 是 snake_case。

## snake_case 與 camelCase

wire 上的 query key、body 欄位與 `data` 內每個 key 都是 snake_case。輸入：zod schema 讀 snake_case 的 key，`.transform` 產出 service 吃的 camelCase 型別。輸出：每個網域有明確的 mapper 函式，逐個 key 寫出。

資料庫的表與欄位也是 snake_case，規則見 [../rules/postgres.md](../rules/postgres.md)。

## 建構器與 wrapper

| 名稱                                                               | 用途                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `success(data?)`（`src/common/http/envelope.ts`）                  | 成功封套；沒有資料時 `data` 是 `{}`。                                                             |
| `paginated(data, page, pageSize, totalCount)`                      | 列表封套，分頁欄位與 `data` 同層，key 為 snake_case。                                             |
| `failure(message)`                                                 | 失敗封套；只有 `registerErrorHandling` 呼叫。                                                     |
| `successEnvelope(schema)`、`pagedEnvelope(itemSchema)`             | 宣告路由的 `response` schema，型別、序列化與驗證來自同一份 schema。                               |
| `pageQuerySchema`                                                  | 列表路由的 query：`page` 預設 1，`page_size` 預設 20、超過 100 截為 100。`MAX_PAGE_SIZE` 為 100。 |
| `registerErrorHandling(app)`（`src/common/http/error-handler.ts`） | 在根 instance 設定 error handler 與 not-found handler，是唯一組失敗封套的地方。                   |
| `AppError(code)`（`src/common/errors/failures.ts`）                | service 丟的失敗，`code` 是 `FAILURES` 的 key。                                                   |
| `bounded(work, ms, what)`（`src/common/concurrency/bounded.ts`）   | 相依服務呼叫的逾時；逾時變成 503。                                                                |
| `date`（`src/common/date.ts`）                                     | 日期格式化與解析，唯一 import dayjs 的檔案。                                                      |

## 新增或修改路由

1. 在網域的 `schemas.ts` 用 zod 宣告 `querystring`、`params`、`body` 與 `response`；key 是 snake_case，輸入用 `.transform` 轉成 service 吃的 camelCase。
2. 需要新的失敗時，在 `src/common/errors/failures.ts` 的 `FAILURES` 加一列（全表唯一的 message），同步補進上面的失敗表；`failure.test.ts` 檢查唯一性。
3. 輸出用逐個 key 寫出的 mapper 把 camelCase 轉成 snake_case，不用通用的 key 改寫器。
4. 路由只做三件事：以 schema 解析輸入、呼叫一個 service 函式、回傳 `success(...)` 或 `paginated(...)`；回應 schema 用 `successEnvelope(...)` 或 `pagedEnvelope(...)` 宣告。
5. service 丟 `AppError`；對相依服務的呼叫包 `bounded()`。
6. 在網域的 `tests/` 寫測試：成功回應的形狀、每個新失敗的 status 與 message、列表的分頁。
7. 在 [README.md](./README.md) 的索引與該路由群的文件補上路由、參數、真實範例與可能的失敗。
