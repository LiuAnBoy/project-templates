# Fastify 後端文件

這份文件記錄目前存在的東西。開發規則（給 agent 與工程師）在 [`rules/`](rules/architecture.md)，以英文撰寫；其餘頁面以繁體中文撰寫。

## 技術棧

Fastify 5、TypeScript 6、zod 4（fastify-type-provider-zod）、pino、dayjs（只在 `src/common/date.ts` 使用）、Vitest、ESLint 10 與 Prettier、pnpm。沒有認證、佇列、信件、檔案儲存，也沒有 OpenAPI 文件。資料儲存在建立專案時選定，通則見 [`rules/data.md`](rules/data.md)；程序依賴的東西都集中在 `src/infra/` 的 `createInfra`。

## 請求如何流過

1. Fastify 接收請求：產生或沿用安全的 `x-request-id`，解析 JSON 本文（空本文視為 `{}`，格式錯誤回表中的 400），加上 helmet 標頭。
2. `@fastify/rate-limit` 依來源位址計數，同一個 client 超過上限就回 429（失敗封套）；不存在的路徑也計入。
3. pino 寫 access log：只記錄路由樣式（例如 `/api/v1/hello`），不記錄實際網址、標頭或本文。
4. 路由以 zod schema 驗證輸入，並以 `successEnvelope(...)` 宣告回應 schema。
5. 路由只解析輸入、呼叫 service、回傳 `success(...)`。
6. 任何錯誤都由 `setErrorHandler` 依失敗表回覆；不存在的路由由 `setNotFoundHandler` 以同樣的格式回 404。客戶端看不到框架或內部的訊息。

## 指令

| 指令                | 用途                                      |
| ------------------- | ----------------------------------------- |
| `pnpm install`      | 安裝相依套件                              |
| `pnpm dev`          | 開發模式（tsx 監看檔案變動）              |
| `pnpm build`        | 編譯到 `dist/`                            |
| `pnpm start`        | 執行編譯後的伺服器，預設埠 8000           |
| `pnpm lint`         | ESLint                                    |
| `pnpm format:check` | Prettier 檢查（`pnpm format` 會直接改檔） |
| `pnpm typecheck`    | TypeScript 型別檢查                       |
| `pnpm test`         | Vitest 單次執行，不需要任何外部服務       |

## 環境變數

啟動時只讀一次並驗證，位置在 `src/config.ts`；程序依賴的服務所需的連線設定宣告在 `src/infra/infra-env.ts`，沒有預設值、必填，缺少時拒絕啟動並指出變數名稱（不印出值）。`.env.example` 只放假的範例值，測試也以它的值執行。

| 變數                        | 預設值        | 說明                                                                         |
| --------------------------- | ------------- | ---------------------------------------------------------------------------- |
| `NODE_ENV`                  | `development` | `development`、`test` 或 `production`                                        |
| `HOST`                      | `0.0.0.0`     | 監聽的位址                                                                   |
| `PORT`                      | `8000`        | 監聽的埠                                                                     |
| `LOG_LEVEL`                 | `info`        | 日誌等級                                                                     |
| `RATE_LIMIT_MAX`            | `300`         | 每個 client 在一個時間窗內的請求上限                                         |
| `RATE_LIMIT_WINDOW_SECONDS` | `60`          | 速率限制的時間窗，單位為秒                                                   |
| `TRUST_PROXY`               | 空            | 前面有反向代理時，填代理的位址或網段（逗號分隔）；空表示以連線的來源位址計算 |

## 目前的模組

- `hello`（`src/hello/`）：`GET /api/v1/hello`，`routes.ts`、`service.ts`、`schemas.ts` 各一個檔案。
- `health`（`src/health/`）：`GET /api/health`，只有 `routes.ts`；在 `/api/v1` 之外，回封套之外的 `{"status":"ok"}`，不受速率限制。它執行 `buildServer` 傳入的依賴檢查，任一失敗或逾時回 503 `{"status":"unavailable"}`。
- `infra`（`src/infra/`）：`createInfra(config)` 回傳依賴檢查、可選的速率限制共用 store 與 close 函式；伺服器開始監聽之前，`main.ts` 先執行所有依賴檢查，失敗就以非零代碼結束並指出檢查名稱。

## 擴充方式

新增後端能力時必須依照這個方式開發：先定義 port（介面），以 `createXxx(deps)` 工廠函式實作，再在唯一的接線處加一行，不修改框架與既有程式碼。`hello` 是範本：service 只依賴 `Greeter` port。細節見 [`rules/extending.md`](rules/extending.md)。

## 文件索引

| 頁面                                                 | 內容                                |
| ---------------------------------------------------- | ----------------------------------- |
| [`apis/README.md`](apis/README.md)                   | 路由索引、回應形狀、封套之外的路由  |
| [`apis/conventions.md`](apis/conventions.md)         | API 設計準則（寫 API 前先讀）       |
| [`apis/hello.md`](apis/hello.md)                     | `GET /api/v1/hello`                 |
| [`database.md`](database.md)                         | 資料庫現況                          |
| [`rules/architecture.md`](rules/architecture.md)     | 結構與慣例                          |
| [`rules/api-and-errors.md`](rules/api-and-errors.md) | 回應格式、錯誤、認證                |
| [`rules/data.md`](rules/data.md)                     | 資料的命名、交易與依賴檢查          |
| [`rules/patterns.md`](rules/patterns.md)             | 常見問題的既定做法                  |
| [`rules/extending.md`](rules/extending.md)           | 擴充方式：port、工廠函式與 registry |
| [`rules/docs-to-update.md`](rules/docs-to-update.md) | 變更時要更新哪些文件                |

## SQLite

資料庫檔案的路徑由 `.env` 的 `DATABASE_URL` 指定（相對於伺服器啟動時的目錄），必填，缺少時拒絕啟動並指出變數名稱。檔案必須已經存在：只有 migration 會建立它，路徑錯誤時啟動失敗，不會悄悄建出空資料庫。資料庫檔案放在 `data/`，該資料夾自帶 `.gitignore`，檔案不會被提交。

| 頁面                                 | 內容                     |
| ------------------------------------ | ------------------------ |
| [`rules/sqlite.md`](rules/sqlite.md) | SQLite、migration 與交易 |

## 資料庫指令

| 指令                    | 用途                                       |
| ----------------------- | ------------------------------------------ |
| `pnpm db:generate`      | 依 schema 產生 migration，寫進 `drizzle/`  |
| `pnpm db:migrate`       | 套用尚未記錄的 migration，並建立資料庫檔案 |
| `pnpm db:status`        | 列出尚未套用的 migration，不寫入任何東西   |
| `pnpm test:integration` | 以資料庫自己的暫存檔案執行資料庫測試       |

## Redis

連線設定在 `.env`：伺服器只讀 `REDIS_URL`（必填，缺少時拒絕啟動並指出變數名稱）；`REDIS_PORT` 供 `docker-compose.dev.yml` 啟動開發用的 Redis，換到共用的伺服器時只改 `.env`。啟動時 Redis 連不上，伺服器不會啟動，只指出依賴的名稱，不印出網址；啟動之後 Redis 失聯，健康檢查與速率限制回 503，行程不會結束。

| 頁面                               | 內容                       |
| ---------------------------------- | -------------------------- |
| [`rules/redis.md`](rules/redis.md) | Redis 的鍵、快取、鎖與佇列 |
