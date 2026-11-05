# Workspace

This is the root of a pnpm workspace. It holds the `contract` package (the wire schemas shared by the web and the server) and the root documents. A web app and a server sit beside it as `web/`, `dashboard/` and `server/` once they are created; each of them has its own `AGENTS.md` and `docs/`, and that file governs the work inside it. Read this file, then the pages that the table below names for your task, before the first edit.

## Always-rules

- The wire shape of a route lives once, as a zod schema in `contract/src/`. The server validates with it and the web parses with it; neither side declares its own copy. The shipped `hello` route is the one exception: a standalone server has no contract package, so `server/` keeps its own `hello` schema. A new route in a composed project declares its shape in `contract/`, never beside its handler.
- `contract` holds schemas and the types inferred from them, and nothing else: no business computation, no framework code, no database access.
- Every wire key is snake_case. In the server, code stays camelCase and converts at the boundary; the web keeps items in their wire shape.
- `contract` builds to `dist/` and is consumed as built JavaScript. After changing it, run `pnpm --filter @app/contract run build` (`pnpm install` does this too) before running the web or the server against it.
- Root `docs/` holds product rules and records. Implementation rules and records live in the part that owns the code (`web/docs/`, `dashboard/docs/`, `server/docs/`); never copy them up here.
- Never commit `.env` or any secret.

## Task to doc

| Task                                                | Read                                                            |
| --------------------------------------------------- | --------------------------------------------------------------- |
| Which docs live where, root commands, the layout    | `docs/README.md`                                                |
| A new or changed route shape, a schema both sides use | `docs/contract.md`, then `contract/src/hello.ts` as the model |
| Work inside `web/`, `dashboard/` or `server/`       | that part's `AGENTS.md`, then the pages it names                |

## Commands

Run from the root.

| Command                                           | Purpose                                                |
| ------------------------------------------------- | ------------------------------------------------------ |
| `pnpm install`                                    | Install every package and build `contract`              |
| `pnpm dev`                                        | Start every package that has a `dev` script, in parallel |
| `pnpm lint`, `pnpm typecheck`, `pnpm test`        | Run that script in every package that defines it        |
| `pnpm format:check` (`pnpm format` rewrites)      | Prettier in every package                               |
| `pnpm build`                                      | Build every package that defines `build`                |

A change is done when lint, typecheck and tests pass in every package it touches.

## Docker

These rules apply when the root holds a `docker-compose.yml`, which `monorepo.sh` writes unless it is run with `--no-docker`; the `workspace` template fetched alone has none. The rules for one image are in the part's `docs/rules/docker.md`.

- The root `docker-compose.yml` runs the whole project: one service per web part (`web`, `dashboard`), the `server`, and the store services and one-shot `migrate` the server's data choice brings. Every build uses the workspace root as its context and the `Dockerfile` in the part's own directory, except a FastAPI server, whose context is `server/`.
- Start it with `cp .env.example .env`, `pnpm install` once (the images install from the lockfile it writes), then `docker compose up -d --build --wait`. The root `.env` is what compose reads and the `env_file` of `server` and `migrate`; `server/.env` serves a server run on the host.
- `COMPOSE_PROJECT_NAME` and `EDGE_SUBNET` are filled with values derived from the project name; change them when a name or subnet is taken on the machine.
- The web parts and the server share the `edge` network, and the stores stay off it. `server` publishes no port and is reached through a web part. `TRUST_PROXY` equals `EDGE_SUBNET`, so the server believes the visitor address a web part forwards and nothing else; keep the two equal. Web ports bind to loopback, and opening one wider needs a reverse proxy in front.
- A web part reads no `env_file`: its values come from build arguments and `environment`, never from the root `.env`.
- When the store is PostgreSQL, `docker-compose.postgres-cluster.yml` at the root switches to a shared server by four `.env` lines, as the comments of `.env.example` say.

## Documents and language

- `AGENTS.md` files and everything under a `docs/rules/` folder are English and contain no CJK characters.
- Every other page under a `docs/` folder is Traditional Chinese and records only what exists.
- A new root page gets an index entry in `docs/README.md` in the same change.
