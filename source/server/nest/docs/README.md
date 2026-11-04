# NestJS 後端文件

這份文件記錄目前存在的東西。開發規則（給 agent 與工程師）在 [`rules/`](rules/architecture.md)，以英文撰寫；其餘頁面以繁體中文撰寫。

## 技術棧

NestJS 11（Fastify adapter）、TypeScript 6、zod 4（nestjs-zod）、nestjs-pino、Vitest、ESLint 10 與 Prettier、pnpm。沒有資料庫、認證、Redis、佇列、信件、檔案儲存、健康檢查路由，也沒有 OpenAPI 文件。

## 請求如何流過

1. Fastify 接收請求：產生或沿用安全的 `x-request-id`，解析 JSON 本文（空本文視為 `{}`，格式錯誤回表中的 400），加上 helmet 標頭。
2. pino 寫 access log：只記錄路由樣式（例如 `/api/v1/hello`），不記錄實際網址、標頭或本文。
3. 全域 `ZodValidationPipe` 以 zod 驗證輸入。
4. Controller 只處理 HTTP，呼叫 service，回傳純資料。
5. 全域 `ResponseEnvelopeInterceptor` 把回傳值包成 envelope；沒有回傳值時 `data` 為 `{}`。
6. 任何錯誤都由全域 `AllExceptionsFilter` 依失敗表回覆，客戶端看不到框架或內部的訊息。

## 指令

| 指令                | 用途                                      |
| ------------------- | ----------------------------------------- |
| `pnpm install`      | 安裝相依套件                              |
| `pnpm dev`          | 開發模式（監看檔案變動）                  |
| `pnpm build`        | 編譯到 `dist/`                            |
| `pnpm start`        | 執行編譯後的伺服器，預設埠 8000           |
| `pnpm lint`         | ESLint                                    |
| `pnpm format:check` | Prettier 檢查（`pnpm format` 會直接改檔） |
| `pnpm typecheck`    | TypeScript 型別檢查                       |
| `pnpm test`         | Vitest 單次執行                           |

## 環境變數

啟動時只讀一次並驗證，位置在 `src/config/env.ts`。沒有 `.env` 也能啟動；`.env.example` 只放假的範例值。

| 變數        | 預設值        | 說明                                  |
| ----------- | ------------- | ------------------------------------- |
| `NODE_ENV`  | `development` | `development`、`test` 或 `production` |
| `HOST`      | `0.0.0.0`     | 監聽的位址                            |
| `PORT`      | `8000`        | 監聽的埠                              |
| `LOG_LEVEL` | `info`        | 日誌等級                              |

## 目前的模組

`hello`（`src/modules/hello/`）：`GET /api/v1/hello`，controller、service、DTO 各一個檔案。

## 擴充方式

新增後端能力時必須依照這個方式開發：先定義 port（介面），以 `createXxx(deps)` 工廠函式實作，再在唯一的接線處加一行，不修改框架與既有程式碼。`hello` 是範本：service 只依賴 `Greeter` port。細節見 [`rules/extending.md`](rules/extending.md)。

## 文件索引

| 頁面                                                 | 內容                                |
| ---------------------------------------------------- | ----------------------------------- |
| [`api/README.md`](api/README.md)                     | 回應格式、端點索引、錯誤訊息        |
| [`api/hello.md`](api/hello.md)                       | `GET /api/v1/hello`                 |
| [`database.md`](database.md)                         | 資料庫現況                          |
| [`rules/architecture.md`](rules/architecture.md)     | 結構與慣例                          |
| [`rules/api-and-errors.md`](rules/api-and-errors.md) | 回應格式、錯誤、認證                |
| [`rules/postgres.md`](rules/postgres.md)             | PostgreSQL、migration 與交易        |
| [`rules/redis.md`](rules/redis.md)                   | Redis 的鍵、快取、鎖與佇列          |
| [`rules/patterns.md`](rules/patterns.md)             | 常見問題的既定做法                  |
| [`rules/extending.md`](rules/extending.md)           | 擴充方式：port、工廠函式與 registry |
| [`rules/docs-to-update.md`](rules/docs-to-update.md) | 變更時要更新哪些文件                |
