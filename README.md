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
- `shared/styles/theme.ts`：整站唯一的樣式來源（顏色、字型、圓角；要共用的間距也放這裡），元件庫的 theme 從這裡取值。
- 以該元件庫自己的元件渲染的首頁 `Welcome`，以及一個 Playwright 測試，斷言只有該元件庫的樣式表才會產生的計算樣式。
- Next.js 所需的設定（例如樣式註冊的 layout）與 HeroUI 的 PostCSS 設定。
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
curl -fsSL https://raw.githubusercontent.com/LiuAnBoy/project-templates/master/monorepo.sh | bash -s -- <project> <next|vite> <plain|antd|mui|heroui> <nest|fastify|fastapi> [--dashboard <next|vite> <plain|antd|mui|heroui>] [--data <postgres|sqlite|mysql|redis|postgres,redis|sqlite,redis|mysql,redis>] [--no-docker]
```

結果是 `<project>/`，內含 `web/`、`server/`、`docs/`，選 Node 後端時還有 `contract/`；加上 `--dashboard` 會多一個 `dashboard/`，建法與 `web/` 相同；加上 `--data` 會把該資料 overlay 疊在 `server/` 上（見「資料庫」）。`plain` 表示不套用 overlay。專案同時備好 Docker：根目錄有 `docker-compose.yml`、`.dockerignore` 與 `.env.example`，每個部分有自己的 `Dockerfile`（見「Docker」）；加上 `--no-docker` 就一個都不放。

- 指令先驗證所有參數，才開始寫入，不合法一律以結束碼 2 拒絕；專案名稱只能用字母、數字、`.`、`_`、`-`，且以字母或數字開頭。目標已存在就拒絕，不會寫入任何東西。`--data` 必須有值，`--dashboard`、`--data`、`--no-docker` 各最多出現一次。
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

選 `fastapi` 時，另外執行 `(cd server && uv sync)`，並在另一個終端機執行 `make -C server dev`。有 `--data` 時，`pnpm dev` 之前先照印出的步驟複製 `.env`、啟動服務、套用 migration。要用容器跑整個專案，`pnpm install` 寫出鎖定檔之後執行 `cp .env.example .env && docker compose up -d --build --wait`。

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

資料庫在**建立專案時**選一次，以 overlay 疊上去，做法與 UI overlay 相同。Overlay 名稱是 `<後端>-<資料庫>`、`<後端>-<資料庫>-redis` 或 `<後端>-redis`，後端是 `nest`、`fastify` 或 `fastapi`，資料庫是 `postgres` 或 `sqlite`；`mysql` 只有 `nest` 與 `fastify`。共十九個。在已取得的後端範本裡執行：

```sh
curl https://codeload.github.com/LiuAnBoy/project-templates/tar.gz/master | tar -xz --strip=3 project-templates-master/overlays/<overlay>
```

Overlay 帶來資料庫的程式碼與規則頁、連線設定（`.env.example`）、需要服務時的 `docker-compose.dev.yml`，以及完整的 `package.json` 與鎖定檔（Node），或 `pyproject.toml` 與 `uv.lock`（FastAPI）。有資料庫時，`Dockerfile`、`docker-compose.yml` 與 `.dockerignore` 也隨之更新：compose 多一個一次性的 `migrate` 服務，PostgreSQL 的 overlay 另有 `docker-compose.postgres-cluster.yml`（見下方）。

專案的啟動順序是：先安裝套件，再把 `.env.example` 複製成 `.env` 並填好 `COMPOSE_PROJECT_NAME`，啟動服務，套用 migration，最後才啟動伺服器。伺服器缺少設定或服務時會拒絕啟動；啟動檢查只確認資料庫連得上（`select 1`），不檢查資料表，所以還沒套用 migration 的伺服器照樣啟動、健康檢查回 200，查詢卻會失敗（SQLite 例外：檔案由 migration 建立，缺檔時拒絕啟動），因此 migration 要在啟動前先做：

```sh
cp .env.example .env                                     # 接著填 COMPOSE_PROJECT_NAME，留空時 compose 會拒絕啟動
docker compose -f docker-compose.dev.yml up -d --wait   # PostgreSQL、MySQL 或 Redis 需要；SQLite 沒有這一步
pnpm db:migrate                                          # FastAPI：make db-migrate；只有 Redis 時沒有這一步
pnpm dev                                                 # FastAPI：make dev
```

用 `monorepo.sh --data <選擇>` 時，這些步驟會在建立完成後印出來，compose 指令已帶上專案名稱（`-p`），多個專案在同一台機器上不會共用容器與資料卷。`--data` 只接受 `postgres`、`sqlite`、`mysql`、`redis`、`postgres,redis`、`sqlite,redis`、`mysql,redis`，選 `fastapi` 時不接受含 `mysql` 的兩個。建議這樣選：

| 選擇 | 什麼時候用 |
| ---- | ---------- |
| `postgres` | 開發與正式都由專案自己的 compose 啟動一個全新的 PostgreSQL；之後只改 `.env` 的四行就能改連已經存在的共用伺服器 |
| `sqlite` | 只有一個執行個體、不想多一個資料庫服務 |
| `mysql` | 客戶的環境指定 MySQL，或要接已經存在的 MySQL 資料庫 |
| `redis` | 只需要快取、鎖或佇列；沒有資料庫 |
| `postgres,redis`、`sqlite,redis`、`mysql,redis` | 資料庫加上 Redis；速率限制也改用 Redis 計數，讓多個執行個體共用同一個上限 |

整個專案放進容器時（`docker compose up -d --build --wait`），`migrate` 先用伺服器的映像執行 migration，成功後 `server` 才啟動；`migrate` 失敗時 `server` 不會啟動，`up` 回傳非零。容器裡的資料庫網址由 compose 依服務名稱組成，`.env` 的 `DATABASE_URL` 只供在本機執行的伺服器使用，所以 `POSTGRES_PASSWORD` 與 `MYSQL_PASSWORD` 必須是 URL 安全字元（英數字與 `-`、`.`、`_`、`~`）。SQLite 的檔案放在具名 volume `sqlite-data`，由 `migrate` 建立。Redis 一律是專案自己的 compose 裡的服務。

要改連已經在某個 docker 網路上執行的 PostgreSQL，先以 `docker compose down` 停止專案，再改 `.env` 的四行，不改任何程式或 compose 檔：

- `COMPOSE_FILE`：改成 `docker-compose.yml:docker-compose.postgres-cluster.yml`。
- `POSTGRES_DOCKER_NETWORK`：填該伺服器所在的 docker 網路名稱。
- `DATABASE_URL`：填該伺服器的連線網址。
- `POSTGRES_DATABASE`：填該伺服器上已存在的資料庫名稱（單純的名稱，不是網址）。

`docker-compose.postgres-cluster.yml` 不含任何網路名稱：它移除本機的 `postgres` 服務，把 `server` 與 `migrate` 接上那個外部網路，並改讀 `.env` 的 `DATABASE_URL`。`POSTGRES_PASSWORD` 仍要保留一個值，改回原本的四行就會回到本機的 PostgreSQL。

MySQL 預設映像是 `mysql:9`，`mysql:8.4` 也跑過同一套真實服務檢查。要接已經有資料表的 MySQL，用 `pnpm db:pull` 從資料庫產生 schema：舊表維持原樣，不硬套 UUID 與 snake_case，新表才照規則；步驟與注意事項（DDL 會自動 commit、MyISAM 沒有交易、大表 `ALTER` 會鎖表、退路是 `mysqldump`）寫在 overlay 的 `docs/rules/mysql.md`。

FastAPI 的資料庫程式碼和 MySQL（Nest、Fastify）的資料庫程式碼都有整合測試，但都沒有正式環境的使用紀錄。

## Docker

每個範本（`next`、`vite`、`nest`、`fastify`、`fastapi`，`workspace` 除外）各附三個檔案：`Dockerfile`、`docker-compose.yml` 與 `.dockerignore`。映像分兩個階段建置：第一階段依鎖定檔安裝並建置，執行階段只複製建置結果（後端另加正式環境的相依套件），以非 root 的固定 uid 執行（Vite 的 nginx 映像是 101，其餘是 1000），不含 `.env`、測試與原始碼。

### 單獨範本

啟動前先把 `.env.example` 複製成 `.env`，並替 `COMPOSE_PROJECT_NAME` 填一個在這台機器上不重複的名稱：

```sh
cp .env.example .env     # 先編輯 COMPOSE_PROJECT_NAME
docker compose up -d --build --wait
```

- `COMPOSE_PROJECT_NAME` 是容器、網路與資料卷的名稱。留空時 compose 會失敗並指出這個變數，`docker-compose.dev.yml` 也一樣；兩個專案因此不會共用容器或資料卷，`docker compose down -v` 也不會碰到別的專案。
- 容器裡的伺服器固定聽 8000；`.env` 的 `PORT` 是本機 `127.0.0.1` 上對應的埠。祕密只透過 `env_file` 與 `environment` 在執行時傳入，不會進入映像。
- 有資料庫的專案多一個一次性的 `migrate` 服務，用伺服器的映像先套用 migration，`server` 等它成功才啟動；`server` 與 `migrate` 讀 `.env` 時，`TEST_*` 網址與 MySQL 的 root 密碼會被清空，因為程式用不到。PostgreSQL 的密碼不清空：專案自己的 PostgreSQL 只有一個管理員帳號，程式就用它連線，網址裡本來就有。改連共用 PostgreSQL 的四行設定見 [資料 overlay](#資料-overlay)。
- Web 範本的服務叫 `web`，不讀 `env_file`，因為對外的容器不該拿到後端的資料庫帳密。它的值只來自 `.env` 的 `DOCKER_API_HOST`（API 的位置）與 `WEB_PORT`（本機 `127.0.0.1` 上的埠，預設 3000）。Next.js 把 `DOCKER_API_HOST` 當建置參數與執行時的 `API_HOST`；Vite 的 nginx 在容器啟動時才讀它，只轉發 `/api/v1/`，換 API 位置不必重新建置，但 nginx 啟動時必須解析得到這個主機，否則容器起不來。
- `DOCKER_API_HOST` 預設 `http://host.docker.internal:8000`。Docker Desktop 把這個名稱轉到本機，所以能連到發佈在本機 `127.0.0.1` 的後端。Linux 上 `extra_hosts` 把它對應到 `host-gateway`，那是 bridge 位址，而後端只發佈在 `127.0.0.1`，預設值因此連不到本專案的後端。做法是讓 web 與後端加入同一個外部網路，`DOCKER_API_HOST` 填後端的服務名稱（`http://<服務名稱>:8000`）。主機的實際位址只連得到真的聽在那個位址上的後端，只發佈在 `127.0.0.1` 的後端不行。這是依 Docker 發佈埠的機制推得，沒有在 Linux 上實測。
- 不使用 Docker 的專案刪掉這三個檔案即可；Vite 專案另外刪掉只有映像用得到的 `nginx/`，PostgreSQL 專案另外刪掉 `docker-compose.postgres-cluster.yml`。`AGENTS.md` 的 Docker 區塊與 `docs/rules/docker.md` 寫成「有這些檔案時」的規則，刪除之後仍然成立。

### monorepo 的 Docker

`monorepo.sh` 建立的專案在根目錄有 `docker-compose.yml`、`.dockerignore` 與 `.env.example`；每個前端有自己的 `Dockerfile`，Node 後端的在 `server/`，FastAPI 後端的 `Dockerfile` 與 `.dockerignore` 也在 `server/`，因為它的 context 是 `server/`。其餘的建置 context 都是 workspace 根目錄。根目錄的檔案和單獨範本用同一套 block 組出來，所以 `migrate`、儲存服務與 PostgreSQL 的共用伺服器切換（`docker-compose.postgres-cluster.yml` 移到根目錄）都和資料 overlay 一致。

```sh
pnpm install                                   # 寫出映像依據的鎖定檔
cp .env.example .env && docker compose up -d --build --wait
```

- 根目錄 `.env.example` 已填好 `COMPOSE_PROJECT_NAME`（專案名稱）與 `EDGE_SUBNET`（由名稱算出的 `10.x.y.0/24`）；名稱或網段在本機被占用時改它們。各部分的 `.env.example` 不再有 Docker 的行，`server/.env.example` 仍供在主機上執行的後端使用。
- 前端與後端在 `edge` 網路上，儲存服務不在。`server` 不發佈埠，只經由前端到達；前端的埠（`WEB_PORT` 預設 3000，`DASHBOARD_PORT` 預設 3001）只綁 `127.0.0.1`。`TRUST_PROXY` 與 `EDGE_SUBNET` 相同，後端只相信 `edge` 上前端轉來的訪客位址，別處的容器偽造標頭也不會得到自己的限流桶；兩個專案的網段相撞時，`up` 會以 `Pool overlaps` 失敗，改 `.env` 即可。要把前端的埠開到 loopback 以外，前面必須有反向代理。
- 前端不讀 `env_file`；後端與 `migrate` 讀根目錄的 `.env`。
- 加 `--no-docker` 時，這些檔案、各部分的三個 Docker 檔案與 Vite 的 `nginx/` 都不放，`docker-compose.dev.yml` 保留。

### 驗證映像

維護範本時，`bash scripts/check-docker.sh fastify next vite` 加上 `bash scripts/check-overlays.sh --docker nest-postgres-redis nest-sqlite fastapi-postgres-redis fastapi-sqlite` 會建置映像、在容器裡驗證，並檢查映像沒有祕密、不是以 root 執行；有資料庫的專案還會驗證 `migrate`、儲存服務停止時的啟動失敗，以及改連共用 PostgreSQL 的四行設定。`check-docker.sh` 也接受組好的 monorepo 目錄，並驗證 `server` 不發佈埠、兩個偽造訪客各有自己的限流桶、`edge` 之外的容器不被相信。它用 28000、23000、23001、25432、23306、26379 等移動過的埠，不占用其他檢查的埠。沒有 Docker 時結束碼是 3，表示未完成，不是通過。


## 修改範本

`templates/` 與 `overlays/` 是產生出來的，並且提交進 repo；不要手改，手改會在下次 render 被覆蓋，`render.mjs --check` 也會失敗。

1. 修改 `source/`（各層的檔案與 `package.fragment.json`、`AGENTS.fragment.md`），或在 `scripts/recipes.mjs` 調整各範本由哪些層組成。monorepo 根目錄的 Docker 檔案來自 `source/docker/monorepo`，不列在任何 recipe，由 `monorepo.sh` 呼叫 `scripts/docker-blocks.mjs` 組出。
2. `node scripts/render.mjs`（可用 `--only a,b`）重新產生。
3. 相依套件變動時：`bash scripts/lock.sh <name>...` 重新產生鎖定檔（`--data` 加上所有資料 overlay）。
4. `bash scripts/verify.sh`：建立封存檔，驗證每個 overlay 與範本（安裝、lint、型別、測試、建置、實際啟動、文件、`.env` 被忽略），資料 overlay 還會用 Docker 啟動真正的 PostgreSQL、MySQL 與 Redis（占用 15432、13306 與 16379 埠）驗證，用 `monorepo.sh` 組出五種組合並實際連線，確認 `monorepo.sh` 會拒絕不合法的輸入（重複的 `--no-docker` 也是），再檢查一個 `--no-docker` 的組合沒有任何 Docker 檔案。最後建置並驗證映像：`scripts/recipes.mjs` 的 `DOCKER_LIVE` 每個目標，加上三個 monorepo 組合（`next plain nest --dashboard vite plain --data postgres,redis`、`vite plain fastapi --data sqlite`、`next plain fastify --data sqlite`）；這一步只用 23000、23001、28000、25432、23306、26379 這些移動過的埠。全部通過才算完成，並更新 `VERSIONS.md` 的驗證日期；沒有 Docker 時結束碼是 3，表示未完成，不是通過，也不會更新驗證日期。

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
