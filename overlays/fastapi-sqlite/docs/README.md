# FastAPI 後端文件

這份文件記錄目前存在的東西。開發規則（給 agent 與工程師）在 [`rules/`](rules/architecture.md)，以英文撰寫；其餘頁面以繁體中文撰寫。

## 技術棧

FastAPI、Python 3.12 以上、pydantic 2、pydantic-settings、loguru、pytest、ruff、uv。沒有認證、佇列、信件、檔案儲存，也沒有 OpenAPI 文件。資料儲存在建立專案時選定，通則見 [`rules/data.md`](rules/data.md)；程序依賴的東西都集中在 `src/infra/` 的 `create_infra`。

## 請求如何流過

1. `RequestContextMiddleware` 產生或沿用安全的 `x-request-id`，並在回應結束時寫 access log：只記錄路由樣式（例如 `/api/v1/hello`），不記錄實際網址、標頭或本文。
2. `RateLimitMiddleware` 依來源位址計數，同一個 client 超過上限就回 429（失敗封套）；不存在的路徑也計入。限流的 storage 連不上時回 503（失敗封套）。
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
| `make test`         | pytest，不需要任何外部服務                |

## 環境變數

啟動時只讀一次並驗證，位置在 `src/core/config.py`；程序依賴的服務所需的連線設定宣告在 `src/infra/settings.py`，沒有預設值、必填，缺少時拒絕啟動並指出變數名稱（不印出值）。`.env.example` 只放假的範例值，測試也以它的值執行。

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
- `health`（`src/health/`）：`GET /api/health`，只有 `router.py`；在 `/api/v1` 之外，回封套之外的 `{"status":"ok"}`，不受速率限制。它執行 `create_infra` 提供的依賴檢查，任一失敗或逾時回 503 `{"status":"unavailable"}`。
- `infra`（`src/infra/`）：`create_infra(config)` 回傳依賴檢查、可選的速率限制共用 storage 與 close 函式；伺服器開始監聽之前，lifespan 先執行所有依賴檢查，失敗就讓 uvicorn 以非零代碼結束並指出檢查名稱。

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
| [`rules/data.md`](rules/data.md)                     | 資料的命名、交易與依賴檢查          |
| [`rules/patterns.md`](rules/patterns.md)             | 常見問題的既定做法                  |
| [`rules/extending.md`](rules/extending.md)           | 擴充方式：port、工廠函式與 registry |
| [`rules/docs-to-update.md`](rules/docs-to-update.md) | 變更時要更新哪些文件                |

## Docker

專案附有 `Dockerfile`、`docker-compose.yml` 與 `.dockerignore`；啟動前先把 `.env.example` 複製成 `.env`，並替 `COMPOSE_PROJECT_NAME` 填一個在這台機器上不重複的名稱。映像與容器的規則見 `rules/docker.md`。

| 頁面                                 | 內容                                |
| ------------------------------------ | ----------------------------------- |
| [`rules/docker.md`](rules/docker.md) | 映像、compose、機密與非 root 的規則 |

## SQLite

資料庫檔案的路徑由 `.env` 的 `DATABASE_URL` 指定（相對於伺服器啟動時的目錄），必填，缺少時拒絕啟動並指出變數名稱。檔案必須已經存在：只有 migration 會建立它，路徑錯誤時啟動失敗，不會悄悄建出空資料庫。資料庫檔案放在 `data/`，該資料夾自帶 `.gitignore`，檔案不會被提交。

| 頁面                                 | 內容                     |
| ------------------------------------ | ------------------------ |
| [`rules/sqlite.md`](rules/sqlite.md) | SQLite、migration 與交易 |

## 資料庫指令

| 指令                    | 用途                                                     |
| ----------------------- | -------------------------------------------------------- |
| `make db-generate`      | 依 model 產生 migration，寫進 `alembic/versions/`        |
| `make db-migrate`       | 套用尚未記錄的 migration，並建立資料庫檔案               |
| `make db-status`        | 列出尚未套用的 migration，不寫入任何東西                 |
| `make test-integration` | 以資料庫自己的暫存檔案執行資料庫測試                     |
