# Workspace

This is the root of a pnpm workspace. It holds the `contract` package (the wire schemas shared by the web and the server) and the root documents. A web app and a server sit beside it as `web/`, `dashboard/` and `server/` once they are created; each of them has its own `AGENTS.md` and `docs/`, and that file governs the work inside it. Read this file, then the pages that the table below names for your task, before the first edit.

## Always-rules

- The wire shape of a route lives once, as a zod schema in `contract/src/`. The server validates with it and the web parses with it; neither side declares its own copy.
- `contract` holds schemas and the types inferred from them, and nothing else: no business computation, no framework code, no database access.
- Every wire key is snake_case. Code stays camelCase and converts at the boundary.
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

## Documents and language

- `AGENTS.md` files and everything under a `docs/rules/` folder are English and contain no CJK characters.
- Every other page under a `docs/` folder is Traditional Chinese and records only what exists.
- A new root page gets an index entry in `docs/README.md` in the same change.
