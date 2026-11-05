## Docker

映像與容器的規則見 `rules/docker.md`。單獨使用的專案附有 `Dockerfile`、`docker-compose.yml` 與 `.dockerignore`；啟動前先把 `.env.example` 複製成 `.env`，並替 `COMPOSE_PROJECT_NAME` 填一個在這台機器上不重複的名稱。組成 monorepo 時由根目錄的檔案統一管理，選擇不使用 Docker 的專案則沒有這些檔案。

| 頁面                                 | 內容                                |
| ------------------------------------ | ----------------------------------- |
| [`rules/docker.md`](rules/docker.md) | 映像、compose、機密與非 root 的規則 |
