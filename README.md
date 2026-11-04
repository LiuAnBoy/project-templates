# project-templates

前端與後端的起始範本，加上一個一行指令就能建立的 monorepo。每個範本都是 `templates/` 底下一個完整、能單獨執行的目錄，用一條 `curl | tar` 就能取得；UI 元件庫（Ant Design、MUI、HeroUI）是 `overlays/` 底下的目錄，疊在 Web 範本上。

這個 repo 必須是公開的：`codeload.github.com` 與 `raw.githubusercontent.com` 都不會在沒有 token 的情況下提供私人 repo，下面的指令也就無法使用。主幹是 `master`，指令都依賴這個名稱。

## 範本

| 範本        | 內容                                                              |
| ----------- | ----------------------------------------------------------------- |
| `next`      | Next.js 16（App Router）、React 19，沒有 UI 元件庫，一個首頁      |
| `vite`      | Vite 8、React 19、React Router，沒有 UI 元件庫，一個首頁          |
| `nest`      | NestJS 11（Fastify adapter），`GET /api/v1/hello` 與 `GET /api/health` |
| `fastify`   | Fastify 5，同樣的路由                                             |
| `fastapi`   | FastAPI（uv、Python 3.12 以上），同樣的路由                       |
| `workspace` | pnpm workspace 的根：`contract` 套件（前後端共用的 zod schema）與根文件 |

每個範本都附 `AGENTS.md`、`CLAUDE.md`（一行 `@AGENTS.md`）與 `docs/`：規則（`docs/rules/`）與 `AGENTS.md` 以英文撰寫，其餘文件以繁體中文撰寫。Node 範本另附 `.nvmrc`。

Web 範本的首頁顯示 `Welcome`，並已備好錯誤頁與 404、通知 hook `useNotification`（`success`、`error`、`warning`、`info`）、測試用的 `renderWithProviders` 與 `matchMedia` stub；Next.js 另有設定頁面 metadata 的 `pageMetadata`。

後端的路由都在 `/api/v1/` 底下，只有健康檢查例外：

- `GET /api/v1/hello` 回傳 `{"success":true,"payload":{"data":{"message":"hello world!!"}}}`。
- `GET /api/health` 回傳 `{"status":"ok"}`，不套回應封套，也不受速率限制，給容器與部署腳本確認服務還活著。

後端預設開啟速率限制：每個來源每 60 秒 300 次，超過回 429。用環境變數 `RATE_LIMIT_MAX`、`RATE_LIMIT_WINDOW_SECONDS` 調整。放在反向代理或 Next.js 後面時要設定 `TRUST_PROXY`，否則所有訪客會共用同一個額度；做法在後端的 `docs/rules/api-and-errors.md`。範本沒有資料庫、認證、Redis 等其他東西。

## UI overlay

| Overlay                                          | 元件庫                |
| ------------------------------------------------ | --------------------- |
| `next-antd`、`vite-antd`                         | Ant Design 6          |
| `next-mui`、`vite-mui`                           | MUI 9                 |
| `next-heroui`、`vite-heroui`                     | HeroUI 3（Tailwind 4）|

Overlay 在**建立專案時**套用一次，不是安裝到已在開發的專案上。它只含元件庫需要覆蓋的檔案、完整的 `package.json` 與 `pnpm-lock.yaml`（基底與元件庫一起鎖定），所以解開後就是設定完成、相依樹已驗證的專案。沒有安裝程式，也沒有合併，只有覆蓋。

套用一個 overlay 會放進專案的東西：

- `shared/providers/UiProvider.tsx`：掛上該元件庫的 provider（取代基底的版本）。
- `shared/hooks/useNotification.ts`：同樣四個方法，改用該元件庫的通知（antd 用 `App.useApp`、MUI 用 notistack、HeroUI 用 `toast`），呼叫端不用改，附測試。
- `shared/styles/theme.ts`：整站唯一的樣式來源（顏色、字型、圓角、間距），元件庫的 theme 從這裡取值。
- 以該元件庫自己的元件渲染的首頁 `Welcome`，以及一個 Playwright 測試，斷言只有該元件庫的樣式表才會產生的計算樣式。
- Next.js 所需的設定（例如樣式註冊的 layout）、HeroUI 的 PostCSS 設定與 `cn` 工具。
- 文件：`docs/rules/ui.md`（該元件庫的使用規則）、`docs/styles.md`、`docs/components/README.md`、`docs/components/useNotification.md`，以及 overlay 版的 `AGENTS.md`。

## 三個一行指令

### 取得單一範本

```sh
curl https://codeload.github.com/LiuAnBoy/project-templates/tar.gz/master | tar -xz --strip=2 project-templates-master/templates/<name>
cd <name>
```

`<name>` 是 `next`、`vite`、`nest`、`fastify`、`fastapi` 或 `workspace`。

### 為 Web 專案加上 UI 元件庫

在上面取得的 Web 專案裡執行，接著安裝：

```sh
curl https://codeload.github.com/LiuAnBoy/project-templates/tar.gz/master | tar -xz --strip=3 project-templates-master/overlays/<next|vite>-<antd|mui|heroui>
pnpm install
```

### 一次建立 monorepo

```sh
curl -fsSL https://raw.githubusercontent.com/LiuAnBoy/project-templates/master/monorepo.sh | bash -s -- <project> <next|vite> <plain|antd|mui|heroui> <nest|fastify|fastapi> [--dashboard <next|vite> <plain|antd|mui|heroui>] [--data <postgres|sqlite|redis|postgres,redis|sqlite,redis>]
```

結果是 `<project>/`，內含 `web/`、`server/`、`docs/`，選 Node 後端時還有 `contract/`；加上 `--dashboard` 會多一個 `dashboard/`，建法與 `web/` 相同；加上 `--data` 會把該資料 overlay 疊在 `server/` 上（見「資料庫」）。`plain` 表示不套用 overlay。

- 指令先驗證所有參數，才開始寫入，不合法一律以結束碼 2 拒絕；專案名稱只能用字母、數字、`.`、`_`、`-`，且以字母或數字開頭。目標已存在就拒絕，不會寫入任何東西。`--data` 必須有值。
- 它在同一個目錄旁的暫存目錄組合，全部成功才移到位。它不安裝套件，也不執行 `git init`，只印出下一步。
- 每個部分保留自己的 `AGENTS.md`、`CLAUDE.md` 與 `docs/`。根目錄的 `docs/` 放產品規則，`web/docs/`、`server/docs/` 放實作文件。
- 選 Node 後端（`nest`、`fastify`）時，`contract/` 的套件名稱是 `@app/contract`，已接進 `web/`、`dashboard/` 與 `server/` 的 `package.json`；根目錄的 `pnpm install` 會建置它。選 `fastapi` 時沒有 `contract/`（Python 後端用不到），根目錄只管理前端，後端用 uv。
- `dashboard/` 的開發埠與 `web/` 錯開（Next.js 3001、Vite 5174），兩者可同時執行；所有前端都把 `/api/v1` 轉發到 8000 埠的後端（環境變數 `API_HOST` 可改目標）。
- 測試用：環境變數 `PROJECT_TEMPLATES_ARCHIVE` 指向本機的 codeload 格式封存檔（`bash scripts/make-archive.sh <out.tar.gz>` 產生），指令就不需要網路下載。

建立後：

```sh
cd <project>
pnpm install      # 安裝所有套件，並建置 contract
pnpm dev          # 同時啟動前端（與後台）和 Node 後端
```

選 `fastapi` 時，另外執行 `(cd server && uv sync)`，並在另一個終端機執行 `make -C server dev`。有 `--data` 時，`pnpm dev` 之前先照印出的步驟複製 `.env`、啟動服務、套用 migration。

## 重新命名與串接

- Web 範本的 `package.json` 名稱是 `next` 或 `vite`，單獨使用時改成自己的專案名稱；monorepo 裡 `monorepo.sh` 已把它們命名為 `web`、`dashboard`、`server`。
- 前端與後端之間：前端把 `/api/v1` 轉發到 `API_HOST`（預設 `http://localhost:8000`），瀏覽器從不發跨來源請求，後端不需要 CORS。
- 單獨使用 Node 範本、想共用型別時，用 `workspace` 範本當根，把各部分放進 `web/`、`server/`，並在它們的 `package.json` 加上 `"@app/contract": "workspace:*"`。`monorepo.sh` 自動完成這一切。
- 規則與慣例都在各範本的 `AGENTS.md` 與 `docs/`：結構、HTTP 封裝、錯誤格式、資料格式（wire key 一律 snake_case）、測試放在 `tests/`。

## 標準開發流程

1. 取得範本（或執行 `monorepo.sh`），`pnpm install`，`pnpm dev` 確認能跑。
2. 讀專案的 `AGENTS.md`，再讀它的任務對照表指到的文件。
3. 新增功能：Web 照 `src/modules/home/` 的形狀建立 `src/modules/<feature>/`（`components/`、`hooks/`、`api/`、`types/`、`tests/`、`index.ts`），經過 `shared/http/http.ts` 呼叫 API；後端照 `hello` 模組的形狀建立，透過 factory 與 port 擴充（見後端的 `docs/rules/extending.md`）。共用的 wire 形狀寫在 `contract/src/`。
4. 把新增的內容記進繁體中文文件：Web 的元件頁與索引、後端的 `docs/apis/` 與 `docs/database.md`。
5. 檢查：`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（FastAPI 用 `make lint`、`make format-check`、`make test`）。

## 資料庫

範本本身不附任何資料庫。通則寫在後端的 `docs/rules/data.md`：Node 專案的 schema 與 migration 使用 Drizzle，FastAPI 專案使用 SQLAlchemy 與 Alembic；資料表與欄位一律 snake_case，id 是 UUID，時間在 API 上一律是 ISO 8601 字串。程序依賴的東西（資料庫、快取）集中在後端的 `src/infra/`：伺服器開始監聽之前先檢查它們，失敗就以非零代碼結束並指出名稱（不印出值）；啟動之後資料庫或 Redis 失聯，請求回 503，行程不會結束；`GET /api/health` 也執行同樣的檢查，失敗時回 503 `{"status":"unavailable"}`。日誌不會出現綁定的值、主機、網址或路徑。

### 資料 overlay

資料庫在**建立專案時**選一次，以 overlay 疊上去，做法與 UI overlay 相同。Overlay 名稱是 `<後端>-<資料庫>`、`<後端>-<資料庫>-redis` 或 `<後端>-redis`，後端是 `nest`、`fastify` 或 `fastapi`，資料庫是 `postgres` 或 `sqlite`，共十五個。在已取得的後端範本裡執行：

```sh
curl https://codeload.github.com/LiuAnBoy/project-templates/tar.gz/master | tar -xz --strip=3 project-templates-master/overlays/<overlay>
```

Overlay 帶來資料庫的程式碼與規則頁、連線設定（`.env.example`）、需要服務時的 `docker-compose.dev.yml`，以及完整的 `package.json` 與鎖定檔（Node），或 `pyproject.toml` 與 `uv.lock`（FastAPI）。

專案的啟動順序是：先安裝套件，再把 `.env.example` 複製成 `.env`，啟動服務，套用 migration，最後才啟動伺服器。伺服器缺少設定或服務時會拒絕啟動；啟動檢查只確認資料庫連得上（`select 1`），不檢查資料表，所以還沒套用 migration 的伺服器照樣啟動、健康檢查回 200，查詢卻會失敗（SQLite 例外：檔案由 migration 建立，缺檔時拒絕啟動），因此 migration 要在啟動前先做：

```sh
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d --wait   # 只有 PostgreSQL 或 Redis 需要；SQLite 沒有這一步
pnpm db:migrate                                          # FastAPI：make db-migrate；只有 Redis 時沒有這一步
pnpm dev                                                 # FastAPI：make dev
```

用 `monorepo.sh --data <選擇>` 時，這些步驟會在建立完成後印出來，compose 指令已帶上專案名稱（`-p`），多個專案在同一台機器上不會共用容器與資料卷。`--data` 只接受 `postgres`、`sqlite`、`redis`、`postgres,redis`、`sqlite,redis`，建議這樣選：

| 選擇 | 什麼時候用 |
| ---- | ---------- |
| `postgres` | 專案自己有 PostgreSQL 服務，之後只改 `.env` 就能換到共用的伺服器 |
| `sqlite` | 只有一個執行個體、不想多一個資料庫服務 |
| `redis` | 只需要快取、鎖或佇列；沒有資料庫 |
| `postgres,redis`、`sqlite,redis` | 資料庫加上 Redis；速率限制也改用 Redis 計數，讓多個執行個體共用同一個上限 |

FastAPI 的資料庫程式碼有整合測試，但沒有正式環境的使用紀錄。

## 修改範本

`templates/` 與 `overlays/` 是產生出來的，並且提交進 repo；不要手改，手改會在下次 render 被覆蓋，`render.mjs --check` 也會失敗。

1. 修改 `source/`（各層的檔案與 `package.fragment.json`、`AGENTS.fragment.md`），或在 `scripts/recipes.mjs` 調整各範本由哪些層組成。
2. `node scripts/render.mjs`（可用 `--only a,b`）重新產生。
3. 相依套件變動時：`bash scripts/lock.sh <name>...` 重新產生鎖定檔（`--data` 加上所有資料 overlay）。
4. `bash scripts/verify.sh`：建立封存檔，驗證每個 overlay 與範本（安裝、lint、型別、測試、建置、實際啟動、文件、`.env` 被忽略），資料 overlay 還會用 Docker 啟動真正的 PostgreSQL 與 Redis（占用 15432 與 16379 埠）驗證，用 `monorepo.sh` 組出五種組合並實際連線，最後確認 `monorepo.sh` 會拒絕不合法的輸入。全部通過才算完成，並更新 `VERSIONS.md` 的驗證日期；沒有 Docker 時結束碼是 3，表示未完成，不是通過，也不會更新驗證日期。

各腳本的細節在 [`AGENTS.md`](AGENTS.md)。

## 套件版本與更新

[`VERSIONS.md`](VERSIONS.md) 記錄每個範本與 overlay 的直接相依套件、鎖定的版本、使用它的範本，以及最近一次驗證通過的日期；`node scripts/versions.mjs` 重新產生，`--check` 在內容過期時失敗。

更新流程：

1. `node scripts/outdated.mjs`：列出有安全公告的、大版本、小版本與修補版本的更新，以及被 peer 範圍擋住的更新（發佈不到 7 天的版本不列，除非它修的是安全公告）。
2. 修改 `source/` 裡的 `package.fragment.json`。
3. `node scripts/render.mjs`。
4. `bash scripts/lock.sh <name>...`。
5. `bash scripts/verify.sh`。

## 目錄

| 路徑         | 內容                                                             |
| ------------ | ---------------------------------------------------------------- |
| `templates/` | 產生出來的獨立範本（提交）                                       |
| `overlays/`  | 產生出來的 UI overlay 與資料 overlay（提交）                     |
| `source/`    | 範本與 overlay 的來源層                                          |
| `scripts/`   | render、鎖定、檢查、封存、驗證與版本的工具                       |
| `monorepo.sh`| 一行指令建立 monorepo                                            |
