# Workspace

This is the root of a pnpm workspace that holds the web app (`web/`), optionally a second one (`dashboard/`), and a FastAPI server (`server/`). The server is a Python project managed by uv and is not a pnpm package. There is no shared contract package: the server's pydantic schemas are the truth of each route, and the web keeps matching types in its `modules/<feature>/types/`. Each part has its own `AGENTS.md` and `docs/`, and that file governs the work inside it. Read this file, then the pages that the table below names for your task, before the first edit.

## Always-rules

- A route's wire shape is defined once, by the server's schemas (`server/src/<module>/schemas.py`). When it changes, change the web's types and api functions in the same change.
- Every wire key is snake_case. The web keeps items in their wire shape.
- Root `docs/` holds product rules and records. Implementation rules and records live in the part that owns the code (`web/docs/`, `dashboard/docs/`, `server/docs/`); never copy them up here.
- Never commit `.env` or any secret.

## Task to doc

| Task                                            | Read                                             |
| ----------------------------------------------- | ------------------------------------------------ |
| Which docs live where, root commands, the layout | `docs/README.md`                                 |
| Work inside `web/`, `dashboard/` or `server/`   | that part's `AGENTS.md`, then the pages it names |

## Commands

| Where   | Command                                              | Purpose                                              |
| ------- | ---------------------------------------------------- | ---------------------------------------------------- |
| Root    | `pnpm install`                                       | Install the web apps                                 |
| Root    | `pnpm dev`                                           | Start every web app that has a `dev` script          |
| Root    | `pnpm lint`, `pnpm typecheck`, `pnpm test`           | Run that script in every web app that defines it     |
| Root    | `pnpm format:check` (`pnpm format` rewrites)         | Prettier in every web app                            |
| Root    | `pnpm build`                                         | Build every web app                                  |
| Server  | `cd server && uv sync`                               | Install the server's dependencies                    |
| Server  | `make -C server dev`                                 | Start the server with reload on port 8000            |
| Server  | `make -C server lint`, `test`, `format-check`        | The server's checks                                  |

A change is done when the checks pass in every part it touches.

## Docker

These rules apply when the root holds a `docker-compose.yml`, which `monorepo.sh` writes unless it is run with `--no-docker`. The rules for one image are in the part's `docs/rules/docker.md`.

- The root `docker-compose.yml` runs the whole project: one service per web part (`web`, `dashboard`), the `server`, and the store services and one-shot `migrate` the server's data choice brings. The web parts build from the workspace root with the `Dockerfile` in their own directory; the FastAPI server builds from `server/` with its own `Dockerfile` and `.dockerignore`.
- Start it with `cp .env.example .env`, `pnpm install` once (the web images install from the lockfile it writes), then `docker compose up -d --build --wait`. The root `.env` is what compose reads and the `env_file` of `server` and `migrate`; `server/.env` serves a server run on the host.
- `COMPOSE_PROJECT_NAME` and `EDGE_SUBNET` are filled with values derived from the project name; change them when a name or subnet is taken on the machine.
- The web parts and the server share the `edge` network, and the stores stay off it. `server` publishes no port and is reached through a web part. `TRUST_PROXY` equals `EDGE_SUBNET`, so the server believes the visitor address a web part forwards and nothing else; keep the two equal. Web ports bind to loopback, and opening one wider needs a reverse proxy in front.
- A web part reads no `env_file`: its values come from build arguments and `environment`, never from the root `.env`.
- When the store is PostgreSQL, `docker-compose.postgres-cluster.yml` at the root switches to a shared server by four `.env` lines, as the comments of `.env.example` say.

## Documents and language

- `AGENTS.md` files and everything under a `docs/rules/` folder are English and contain no CJK characters.
- Every other page under a `docs/` folder is Traditional Chinese and records only what exists.
- A new root page gets an index entry in `docs/README.md` in the same change.
