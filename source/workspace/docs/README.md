# 根目錄文件索引

這個目錄是 pnpm workspace 的根。`docs/` 只放產品規則與紀錄；程式怎麼寫的實作文件，放在擁有該程式碼的部分。本頁記錄目前實際存在的內容。

## 文件分工

| 位置           | 內容                                             |
| -------------- | ------------------------------------------------ |
| 根目錄 `docs/` | 產品規則、前後端共用的約定（例如 `contract`）    |
| `web/docs/`    | 前端實作：架構、資料層、測試、元件、樣式         |
| `dashboard/docs/` | 後台前端實作，結構與 `web/docs/` 相同（有建立後台時才存在） |
| `server/docs/` | 後端實作：API 設計、錯誤、資料庫、架構           |

規則類的頁面（`docs/rules/`）以英文撰寫，給 agent 讀；其餘頁面以繁體中文撰寫。

## 目錄

| 路徑        | 說明                                                                      |
| ----------- | ------------------------------------------------------------------------- |
| `contract/` | 前後端共用的 wire schema（zod），見 [contract.md](./contract.md)           |
| `web/`、`dashboard/`、`server/` | 前端、後台前端與後端，各自有 `AGENTS.md` 與 `docs/`；建立專案時才會出現 |

## 指令

在根目錄執行。

| 指令                                           | 用途                                       |
| ---------------------------------------------- | ------------------------------------------ |
| `pnpm install`                                 | 安裝所有套件，並建置 `contract`             |
| `pnpm dev`                                     | 同時啟動有 `dev` 指令的套件                 |
| `pnpm lint`、`pnpm typecheck`、`pnpm test`     | 在每個有該指令的套件執行                    |
| `pnpm format:check`                            | Prettier 檢查（`pnpm format` 會直接改檔）   |
| `pnpm build`                                   | 建置每個有 `build` 指令的套件               |

## Docker

用 `monorepo.sh` 建立的專案（沒有加 `--no-docker`）根目錄有 `docker-compose.yml`、`.dockerignore` 與 `.env.example`，每個部分各有自己的 `Dockerfile`；單獨取得的 `workspace` 範本沒有這些檔案。

- 根目錄的 `docker-compose.yml` 啟動整個專案：每個前端各一個服務（`web`、`dashboard`）、後端 `server`，以及所選資料庫帶來的儲存服務與一次性的 `migrate`。建置的 context 是 workspace 根目錄。
- 啟動：`cp .env.example .env`，先執行一次 `pnpm install`（映像依它寫出的鎖定檔安裝），再 `docker compose up -d --build --wait`。
- 前端與後端在 `edge` 網路上，儲存服務不在。`server` 不發佈埠，只經由前端到達；前端的埠只綁 `127.0.0.1`。`TRUST_PROXY` 與 `EDGE_SUBNET` 相同，後端因此只相信前端轉來的訪客位址，兩者要保持一致。
- `COMPOSE_PROJECT_NAME` 與 `EDGE_SUBNET` 已依專案名稱填好；名稱或網段在本機被占用時再改。

## 文件索引

- [contract.md](./contract.md)：`contract` 套件的用途、匯入方式、新增 schema 的步驟。
