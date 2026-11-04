# Project templates

This repository holds standalone starter templates for web frontends (Next.js, Vite) and backends (NestJS on Fastify, Fastify, FastAPI), plus a monorepo workspace and `monorepo.sh`, the one command that composes them into a project. Each template is a complete directory under `templates/` that runs alone, so one `curl | tar` can fetch it. `README.md` (Traditional Chinese) explains usage to the people who start projects.

## Layout

- `source/`: the layers that templates and overlays are built from. Layers are shared files plus an optional `package.fragment.json` that contributes to the generated `package.json`. Web layers: `web/common`, `web/<next|vite>`, `ui/plain` (what a base without a UI library needs: its `UiProvider`, `useNotification` and documents), and per UI library `ui/<antd|mui|heroui>/common` plus an optional `ui/<lib>/<next|vite>` for files that must differ in one framework. Server layers: `server/common` (all three backends), `server/node` (the two Node backends) and `server/<nest|fastify|fastapi>`. Workspace layers: `workspace` (the root with the `contract` package) and `workspace-no-contract` (the root for a server that has no contract package).
- `templates/`: generated standalone templates, committed. `next` and `vite` are the web bases; they have no UI library, and their `shared/providers/UiProvider.tsx` and `shared/hooks/useNotification.ts` are small dependency-free versions that an overlay replaces. `nest`, `fastify` and `fastapi` are the backends; `workspace` is the monorepo root.
- `overlays/`: generated overlays, committed. The six UI overlays (`next-antd`, `next-mui`, `next-heroui`, `vite-antd`, `vite-mui`, `vite-heroui`) hold only the files of their own layers plus a full `package.json` (the base and the library merged, named after the base) and their `pnpm-lock.yaml`. Each is extracted over a fresh base once, when a project is created: there is no installer and no merge, only overwriting. `workspace-no-contract` is the seventh overlay: the root of a monorepo whose server is FastAPI. It replaces the root manifest, the workspace file, `AGENTS.md` and `docs/README.md` of `workspace` so they state only what exists, and it is applied only by `monorepo.sh`; keeping it under `overlays/` keeps it out of a standalone `workspace` fetch.
- `scripts/`: the tooling below.
- `monorepo.sh`: the composer (see "monorepo.sh").
- `README.md`: usage for the people who start projects, in Traditional Chinese.
- `VERSIONS.md`: the generated record of every direct dependency, its pinned version, the templates using it and the date verification last passed.
- `todos/`: local work notes, gitignored.

Never edit `templates/`, `overlays/` or `VERSIONS.md` by hand; a hand edit is overwritten by the next render or generation, and `render.mjs --check` fails on it.

## Flow for any change

1. Edit `source/` (or `scripts/recipes.mjs` when the layers of a template or overlay change).
2. `node scripts/render.mjs [--only a,b]` regenerates `templates/` and `overlays/`. It copies layers in order, deep-merges the `package.fragment.json` files into a generated `package.json`, never copies a fragment, keeps an existing `pnpm-lock.yaml` or `uv.lock`, and removes stale files. A layer may hold `AGENTS.fragment.md`: the renderer joins the fragments of a template's layers in order, one blank line apart, into the generated `AGENTS.md` and never copies a fragment (a layer's own `AGENTS.md` is still copied when no layer has a fragment). Each fragment is a block with its own `## ` heading, no heading repeats across layers, and the joined result must read as one document. A UI overlay's `AGENTS.md` is the whole file: its base's fragments without `source/ui/plain`, then its own. A template's `package.json` is named after the template. An overlay copies only its own layers, but its `package.json` merges the fragments of its base template's layers and its own, and is named after the base so the project can extend it as its own. An overlay entry in `recipes.mjs` that replaces its base's manifest and documents outright (`workspace-no-contract`) names `fragmentLayers` and `agentsLayers` itself, and then only those layers contribute.
3. `bash scripts/lock.sh <name>...` regenerates the lockfile whenever dependencies changed. Direct dependencies are pinned to exact versions. For a UI overlay it copies the base to a temp directory, extracts the overlay over it, locks base and library together there, and stores the result in `overlays/<name>/pnpm-lock.yaml`. `workspace-no-contract` has no dependencies and no lockfile.
4. Verify (below). A change is done only when every check passes.

`node scripts/render.mjs --check` renders every template and overlay to a temp directory and compares with `templates/` and `overlays/` (lockfiles excluded); it fails and lists each missing, extra or changed file. `--only` takes template and overlay names alike.

Updating dependency versions follows the same flow: `node scripts/outdated.mjs` reports direct dependencies in four groups (security advisories, majors, minors and patches, and updates blocked by a peer range, leaving out releases younger than 7 days unless they fix an advisory); edit the fragments, render, lock, verify.

## Verification

Run these from the repository root. Each of the first three accepts template names, or directory paths (anything containing a slash or naming an existing directory is checked where it stands, so an extracted archive or a composed monorepo works).

- `bash scripts/check-template.sh <name>...` copies the target to a temp directory, installs from the lockfile, and runs the quality scripts.
- `bash scripts/live-check.sh <name>...` starts the target and asserts its behaviour.
- `node scripts/check-docs.mjs <name>...` checks documents and required paths. A composed monorepo is checked part by part: `web/`, `dashboard/` when present, and `server/`, each as its own template type, plus the root documents, and `contract/` needs only its `package.json`.
- `bash scripts/make-archive.sh <out.tar.gz>` writes a codeload-shaped archive (top folder `project-templates-master/`) of the files from `git ls-files -co --exclude-standard`, so uncommitted work is included and ignored files are not.
- `bash scripts/check-overlays.sh <overlay>...` builds that archive (or reads the one named by `ARCHIVE`), extracts the base into an empty directory with `tar -xz --strip=2 project-templates-master/templates/<base>`, enters it, extracts the overlay over it with `tar -xz --strip=3 project-templates-master/overlays/<overlay>`, and runs the three checks above against the result. It is the only check of a UI overlay, because an overlay is not a project until it is applied.
- `node scripts/test-render.mjs` and `node scripts/test-check-docs.mjs` test the tooling itself with fixtures.
- `bash scripts/verify.sh` is the whole verification and the only gate of a finished change. It checks the syntax of every script, runs `render.mjs --check` and the two tooling tests, builds the archive, runs `check-overlays.sh` for the six UI overlays, extracts every template with the README's tar flags into an empty directory and runs the three checks there, then runs `git init` there and asserts `git check-ignore .env`. It then runs `monorepo.sh` against the archive for `next antd nest`, `vite plain fastapi` and `next plain nest --dashboard next antd`: install, `check-docs.mjs`, `pnpm typecheck`, then both sides started and `/api/v1/hello` curled through each web port with the whole envelope asserted. The first composition also gets a page and a Nest handler, written into the composed copy only, that import `@app/contract` at runtime. It proves `monorepo.sh` refuses unknown values, a bad name and an existing target without writing anything. Its last step, on a pass, is `node scripts/versions.mjs --stamp`, which regenerates `VERSIONS.md` and sets its verification date to today (`node scripts/versions.mjs --check` exits 1 when the file is stale). It needs network access, and port 8000 and each composition's web ports free.

### Build exception

The usual rule of not running a build does not apply here. Every Node template is built during verification, because a template has no deploy pipeline that would catch a broken build.

### Script contract every template must meet

- Node templates define the scripts `lint`, `format:check`, `typecheck`, `test` (single run, never watch mode) and `build`, and carry `.nvmrc`. `check-template.sh` fails when a script is missing; the allowlist at the top of the script is empty.
- Web templates, with or without an overlay, also define `test:e2e`, a Playwright run that starts the app itself, and ship error and not-found pages through `shared/components/ErrorState.tsx`, `src/test/renderWithProviders.tsx` and `src/test/matchMedia.ts`.
- Every web project has `shared/hooks/useNotification.ts` with exactly the methods `success`, `error`, `warning` and `info` and a test that guards them. The plain base's version needs no dependency. A UI overlay replaces it with the library's own, at the same paths, so no plain file is left beside it.
- Every UI overlay provides `shared/providers/UiProvider.tsx`, that hook, `shared/styles/theme.ts`, a Home page rendered through the library's own component, a Playwright spec that asserts a computed style only that library's stylesheet produces, and the documents `docs/rules/ui.md`, `docs/styles.md`, `docs/components/README.md` and `docs/components/useNotification.md`. An overlay overwrites a base file only where the library needs it, so the base stays the shared truth.
- Node servers also define `start`, which runs the built output, listens on port 8000 and boots with no `.env` and an empty environment.
- The `workspace` template builds its `contract` package to `dist`, exports it through an `exports` map, and exports `helloResponseSchema` (a zod schema); `live-check.sh` imports it from Node. Its root defines `prepare` (builds `contract`) and `dev` (runs every package's `dev`, in parallel).
- FastAPI templates define the Makefile targets `lint`, `format-check`, `typecheck` (optional), `test` and `start`, using hyphenated names because a colon in a target name is not valid. They use `uv` and commit `uv.lock`.
- Every template has its own `.gitignore` that covers `.env`.

### Live behaviour of servers

Every route is under `/api/v1/` except the health route. `GET /api/v1/hello` answers exactly `{"success":true,"payload":{"data":{"message":"hello world!!"}}}`, and `GET /api/health` answers 200 with exactly `{"status":"ok"}`, outside the envelope. An unknown route answers 404 with `success` false and a string `payload.message`. `live-check.sh` refuses to run when port 8000 is taken.

Every server limits requests per client by default: 300 per 60 seconds, from `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_SECONDS`, keyed on the socket address unless `TRUST_PROXY` names the proxies in front. A request over the limit answers 429 in the failure envelope, and the health route is exempt.

## monorepo.sh

`monorepo.sh <project> <next|vite> <plain|antd|mui|heroui> <nest|fastify|fastapi> [--dashboard <next|vite> <plain|antd|mui|heroui>]` is the only composed form, and what it leaves on disk must be a project that runs immediately after `pnpm install`. Rules for the script:

- It is piped to bash, so everything is a function and the last line calls them: a truncated download runs nothing.
- It validates every argument before writing anything. The project name matches `^[A-Za-z0-9][A-Za-z0-9._-]*$`, so a path cannot escape, and an existing target is refused.
- It composes in a temporary directory beside the target and moves it into place only on success. It never installs and never runs `git init`; it prints the next steps.
- `PROJECT_TEMPLATES_ARCHIVE` points it at a local archive instead of downloading one; verification uses it.
- It extracts the `workspace` template at the root, each web base into `web/` (and `dashboard/`) with `--strip-components=3`, the chosen overlay over it unless the choice is `plain`, and the server into `server/`. It deletes every lockfile the Node parts brought and their nested `pnpm-workspace.yaml`, so the first install writes one lockfile for the composed tree; the root `pnpm-workspace.yaml` carries the union of the build-script allowlists. `fastapi` keeps its `uv.lock`.
- It renames the parts to `web`, `dashboard` and `server` in their `package.json`. With a Node server it adds `"@app/contract": "workspace:*"` to every part.
- A dashboard's ports are moved off the web app's so both run at once: 3000, 3100, 5173, 4173 and 5273 become 3001, 3101, 5174, 4174 and 5274 in its scripts, configs and documents, so its documents state the ports it really uses.
- With `fastapi` there is no contract package: it removes `contract/` and `docs/contract.md` and extracts the `workspace-no-contract` overlay over the root. The workspace file lists only the web apps, and the root documents say there is no contract.
- A composed part keeps its own `AGENTS.md` and `CLAUDE.md`; `CLAUDE.md` is always the one line `@AGENTS.md`. `contract/` has no `CLAUDE.md`.

## Documents

- `AGENTS.md` files and everything under `docs/rules/` are English and contain no CJK characters.
- Every other page under `docs/` is Traditional Chinese.
- Root `docs/` of a monorepo holds product rules; `web/docs/`, `dashboard/docs/` and `server/docs/` hold implementation rules and records. `docs/README.md` of the workspace states the split and indexes what ships.
- Relative links must resolve, and a root document links into a part only through code spans, because the standalone `workspace` fetch has no parts. `check-docs.mjs` enforces the language split, the links, the required paths per template type, and the `.env` ignore.
- Records state only what exists: indexes list what ships, nothing planned. A database rule may be written before a database ships, as a rule and never as a record: Node projects use Drizzle for schema and migrations, FastAPI projects use SQLAlchemy and Alembic.

## Rules for contributors

- Node standard library only for `.mjs` scripts; bash 3.2 compatible for `.sh` scripts (macOS).
- Code comments and docstrings are English; JSDoc on functions.
- Nothing in the repository may name a private project, host or person. The repository is meant to be public.
- Commits follow Conventional Commits and are written in English.
