# FastAPI 後端文件

這份文件記錄目前存在的東西。開發規則（給 agent 與工程師）在 [`rules/`](rules/architecture.md)，以英文撰寫；其餘頁面以繁體中文撰寫。

## 技術棧

FastAPI、Python 3.12 以上、pydantic 2、pydantic-settings、loguru、pytest、ruff、uv。沒有資料庫、認證、Redis、佇列、信件、檔案儲存，也沒有 OpenAPI 文件。健康檢查只有一條不碰任何相依服務的 liveness 路由。

## 請求如何流過

1. `RequestContextMiddleware` 產生或沿用安全的 `x-request-id`，並在回應結束時寫 access log：只記錄路由樣式（例如 `/api/v1/hello`），不記錄實際網址、標頭或本文。
2. `RateLimitMiddleware` 依來源位址計數，同一個 client 超過上限就回 429（失敗封套）；不存在的路徑也計入。
3. FastAPI 以 pydantic 驗證輸入。
4. Router 只解析輸入、呼叫 service、回傳 `success(...)`；`response_model=Envelope[...]` 宣告回應格式。
5. 任何錯誤都由 `core/handlers.py` 的 exception handler 依失敗表回覆；不存在的路由與不允許的方法也是。客戶端看不到框架或內部的訊息。
6. 互動式文件與 OpenAPI 文件已關閉。

## 指令

| 指令                | 用途                                      |
| ------------------- | ----------------------------------------- |
| `uv sync`           | 安裝相依套件                              |
| `make dev`          | 開發模式（uvicorn 自動重載）              |
| `make start`        | 啟動伺服器，預設埠 8000                   |
| `make lint`         | ruff 檢查                                 |
| `make format-check` | ruff 格式檢查（`make format` 會直接改檔） |
| `make test`         | pytest                                    |

## 環境變數

啟動時只讀一次並驗證，位置在 `src/core/config.py`。沒有 `.env` 也能啟動；`.env.example` 只放假的範例值。

| 變數                        | 預設值    | 說明                                                                         |
| --------------------------- | --------- | ---------------------------------------------------------------------------- |
| `HOST`                      | `0.0.0.0` | 監聽的位址                                                                   |
| `PORT`                      | `8000`    | 監聽的埠                                                                     |
| `LOG_LEVEL`                 | `INFO`    | 日誌等級                                                                     |
| `RATE_LIMIT_MAX`            | `300`     | 每個 client 在一個時間窗內的請求上限                                         |
| `RATE_LIMIT_WINDOW_SECONDS` | `60`      | 速率限制的時間窗，單位為秒                                                   |
| `TRUST_PROXY`               | 空        | 前面有反向代理時，填代理的位址或網段（逗號分隔）；空表示以連線的來源位址計算 |

## 目前的模組

- `hello`（`src/hello/`）：`GET /api/v1/hello`，`router.py`、`service.py`、`schemas.py` 各一個檔案。
- `health`（`src/health/`）：`GET /api/health`，只有 `router.py`；在 `/api/v1` 之外，回封套之外的 `{"status":"ok"}`，不受速率限制。

## 擴充方式

新增後端能力時必須依照這個方式開發：先以 `typing.Protocol` 定義 port，以 `create_xxx(deps)` 工廠函式實作，再在唯一的接線處（`main.py` 與各模組的 `dependencies.py`）加一行，不修改框架與既有程式碼。`hello` 是範本：service 只依賴 `Greeter` port。細節見 [`rules/extending.md`](rules/extending.md)。

## 文件索引

| 頁面                                                 | 內容                                |
| ---------------------------------------------------- | ----------------------------------- |
| [`apis/README.md`](apis/README.md)                   | 路由索引、回應形狀、封套之外的路由  |
| [`apis/conventions.md`](apis/conventions.md)         | API 設計準則（寫 API 前先讀）       |
| [`apis/hello.md`](apis/hello.md)                     | `GET /api/v1/hello`                 |
| [`database.md`](database.md)                         | 資料庫現況                          |
| [`rules/architecture.md`](rules/architecture.md)     | 結構與慣例                          |
| [`rules/api-and-errors.md`](rules/api-and-errors.md) | 回應格式、錯誤、認證                |
| [`rules/postgres.md`](rules/postgres.md)             | PostgreSQL、migration 與交易        |
| [`rules/redis.md`](rules/redis.md)                   | Redis 的鍵、快取、鎖與佇列          |
| [`rules/patterns.md`](rules/patterns.md)             | 常見問題的既定做法                  |
| [`rules/extending.md`](rules/extending.md)           | 擴充方式：port、工廠函式與 registry |
| [`rules/docs-to-update.md`](rules/docs-to-update.md) | 變更時要更新哪些文件                |
