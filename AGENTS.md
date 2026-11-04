# Project templates

This repository holds standalone starter templates for web frontends (Next.js, Vite) and backends (NestJS on Fastify, Fastify, FastAPI), plus a monorepo workspace. Each template is a complete directory under `templates/` that runs alone, so one `curl | tar` can fetch it.

## Layout

- `source/`: the layers that templates are built from. Layers are shared files plus an optional `package.fragment.json` that contributes to the generated `package.json`.
- `templates/`: generated output, committed. Never edit it by hand; a hand edit is overwritten by the next render and `render.mjs --check` fails on it.
- `scripts/`: the tooling below.
- `todos/`: local work notes, gitignored.

## Flow for any change

1. Edit `source/` (or `scripts/recipes.mjs` when a template's layers change).
2. `node scripts/render.mjs [--only a,b]` regenerates `templates/`. It copies layers in order, deep-merges the `package.fragment.json` files into a generated `package.json` named after the template, never copies a fragment, keeps an existing `pnpm-lock.yaml` or `uv.lock`, and removes stale files.
3. `bash scripts/lock.sh <name>...` regenerates the lockfile whenever dependencies changed. Direct dependencies are pinned to exact versions.
4. Verify (below). A change is done only when every check passes.

`node scripts/render.mjs --check` renders to a temp directory and compares with `templates/` (lockfiles excluded); it fails and lists each missing, extra or changed file.

## Verification

Run these from the repository root. Each accepts template names, or directory paths (anything containing a slash or naming an existing directory is checked where it stands, so an extracted archive or a composed monorepo works).

- `bash scripts/check-template.sh <name>...` copies the target to a temp directory, installs from the lockfile, and runs the quality scripts.
- `bash scripts/live-check.sh <name>...` starts the target and asserts its behaviour.
- `node scripts/check-docs.mjs <name>...` checks documents and required paths.
- `node scripts/test-render.mjs` and `node scripts/test-check-docs.mjs` test the tooling itself with fixtures.

### Build exception

The usual rule of not running a build does not apply here. Every Node template is built during verification, because a template has no deploy pipeline that would catch a broken build.

### Script contract every template must meet

- Node templates define the scripts `lint`, `format:check`, `typecheck`, `test` (single run, never watch mode) and `build`. `check-template.sh` fails when one is missing; the allowlist at the top of the script is empty.
- Web templates also define `test:e2e`, a Playwright run that starts the app itself.
- Node servers also define `start`, which runs the built output, listens on port 8000 and boots with no `.env` and an empty environment.
- The `workspace` template builds its `contract` package to `dist`, exports it through an `exports` map, and exports `helloResponseSchema` (a zod schema); `live-check.sh` imports it from Node.
- FastAPI templates define the Makefile targets `lint`, `format-check`, `typecheck` (optional), `test` and `start`, using hyphenated names because a colon in a target name is not valid. They use `uv` and commit `uv.lock`.
- Every template has its own `.gitignore` that covers `.env`.

### Live behaviour of servers

`GET /api/v1/hello` answers exactly `{"success":true,"payload":{"data":{"message":"hello world!!"}}}`. An unknown route answers 404 with `success` false and a string `payload.message`. `live-check.sh` refuses to run when port 8000 is taken.

## Documents

- `AGENTS.md` files and everything under `docs/rules/` are English and contain no CJK characters.
- Every other page under `docs/` is Traditional Chinese.
- Relative links must resolve. `check-docs.mjs` enforces the language split, the links, the required paths per template type, and the `.env` ignore.
- Records state only what exists: indexes list what ships, nothing planned.

## Rules for contributors

- Node standard library only for `.mjs` scripts; bash 3.2 compatible for `.sh` scripts (macOS).
- Code comments and docstrings are English; JSDoc on functions.
- Nothing in the repository may name a private project, host or person. The repository is meant to be public.
- Commits follow Conventional Commits and are written in English.
