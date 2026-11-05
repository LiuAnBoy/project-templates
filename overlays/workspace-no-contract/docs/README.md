# 根目錄文件索引

這個目錄是 pnpm workspace 的根，裡面有前端（`web/`，可再加一個 `dashboard/`）與 FastAPI 後端（`server/`）。`docs/` 只放產品規則與紀錄；程式怎麼寫的實作文件，放在擁有該程式碼的部分。本頁記錄目前實際存在的內容。

## 文件分工

| 位置              | 內容                                                        |
| ----------------- | ----------------------------------------------------------- |
| 根目錄 `docs/`    | 產品規則、前後端共用的約定                                  |
| `web/docs/`       | 前端實作：架構、資料層、測試、元件、樣式                    |
| `dashboard/docs/` | 後台前端實作，結構與 `web/docs/` 相同（有建立後台時才存在） |
| `server/docs/`    | 後端實作：API 設計、錯誤、資料庫、架構                      |

規則類的頁面（`docs/rules/`）以英文撰寫，給 agent 讀；其餘頁面以繁體中文撰寫。

## 沒有 contract 套件

FastAPI 後端是 Python 專案，用不到 TypeScript 的 `contract` 套件。每個路由的 wire 形狀由後端的 pydantic schema（`server/src/<module>/schemas.py`）定義，前端在 `modules/<feature>/types/` 維護對應的型別；改了其中一邊，同一個變更內要改另一邊。

## 指令

| 位置   | 指令                                       | 用途                                    |
| ------ | ------------------------------------------ | --------------------------------------- |
| 根目錄 | `pnpm install`                             | 安裝前端                                |
| 根目錄 | `pnpm dev`                                 | 同時啟動有 `dev` 指令的前端             |
| 根目錄 | `pnpm lint`、`pnpm typecheck`、`pnpm test` | 在每個有該指令的前端執行                |
| 後端   | `cd server && uv sync`                     | 安裝後端相依套件                        |
| 後端   | `make -C server dev`                       | 啟動後端（含 reload），埠 8000          |
| 後端   | `make -C server lint`、`test`              | 後端的檢查                              |

## Docker

用 `monorepo.sh` 建立的專案（沒有加 `--no-docker`）根目錄有 `docker-compose.yml`、`.dockerignore` 與 `.env.example`；前端各有自己的 `Dockerfile`，後端的 `Dockerfile` 與 `.dockerignore` 在 `server/`。

- 根目錄的 `docker-compose.yml` 啟動整個專案：每個前端各一個服務（`web`、`dashboard`）、後端 `server`，以及所選資料庫帶來的儲存服務與一次性的 `migrate`。前端的 context 是 workspace 根目錄，後端的是 `server/`。
- 啟動：`cp .env.example .env`，先執行一次 `pnpm install`（前端映像依它寫出的鎖定檔安裝），再 `docker compose up -d --build --wait`。
- 前端與後端在 `edge` 網路上，儲存服務不在。`server` 不發佈埠，只經由前端到達；前端的埠只綁 `127.0.0.1`。`TRUST_PROXY` 與 `EDGE_SUBNET` 相同，後端因此只相信前端轉來的訪客位址，兩者要保持一致。
- `COMPOSE_PROJECT_NAME` 與 `EDGE_SUBNET` 已依專案名稱填好；名稱或網段在本機被占用時再改。

## 文件索引

根目錄目前沒有其他頁面。前端與後端的文件從各自的 `docs/README.md` 進入。
