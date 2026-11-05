## Docker

專案附有 `Dockerfile`、`docker-compose.yml` 與 `.dockerignore`；啟動前先把 `.env.example` 複製成 `.env`，並替 `COMPOSE_PROJECT_NAME` 填一個在這台機器上不重複的名稱。映像與容器的規則見 `rules/docker.md`。

| 頁面                                 | 內容                                |
| ------------------------------------ | ----------------------------------- |
| [`rules/docker.md`](rules/docker.md) | 映像、compose、機密與非 root 的規則 |
