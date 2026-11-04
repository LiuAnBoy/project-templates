# Project templates

This repository holds standalone starter templates for web frontends (Next.js, Vite) and backends (NestJS on Fastify, Fastify, FastAPI), plus a monorepo workspace. Each template is a complete directory under `templates/` that runs alone, so one `curl | tar` can fetch it.

## Layout

- `source/`: the layers that templates and overlays are built from. Layers are shared files plus an optional `package.fragment.json` that contributes to the generated `package.json`. Web layers: `web/common`, `web/<next|vite>`, `ui/plain` (the documents of a base without a UI library), and per UI library `ui/<antd|mui|heroui>/common` plus an optional `ui/<lib>/<next|vite>` for files that must differ in one framework.
- `templates/`: generated standalone templates, committed. `next` and `vite` are the web bases; they have no UI library and carry a passthrough `shared/providers/UiProvider.tsx` that an overlay replaces.
- `overlays/`: generated UI overlays, committed, one per framework and library (`next-antd`, `next-mui`, `next-heroui`, `vite-antd`, `vite-mui`, `vite-heroui`). An overlay holds only the files of its own layers plus a full `package.json` (the base and the library merged, named after the base) and its `pnpm-lock.yaml`. It is extracted over a fresh base once, when a project is created: there is no installer and no merge, only overwriting.
- `scripts/`: the tooling below.
- `todos/`: local work notes, gitignored.

Never edit `templates/` or `overlays/` by hand; a hand edit is overwritten by the next render and `render.mjs --check` fails on it.

## Flow for any change

1. Edit `source/` (or `scripts/recipes.mjs` when the layers of a template or overlay change).
2. `node scripts/render.mjs [--only a,b]` regenerates `templates/` and `overlays/`. It copies layers in order, deep-merges the `package.fragment.json` files into a generated `package.json`, never copies a fragment, keeps an existing `pnpm-lock.yaml` or `uv.lock`, and removes stale files. A layer may hold `AGENTS.fragment.md`: the renderer joins the fragments of a template's layers in order, one blank line apart, into the generated `AGENTS.md` and never copies a fragment (a layer's own `AGENTS.md` is still copied when no layer has a fragment). Each fragment is a block with its own `## ` heading, no heading repeats across layers, and the joined result must read as one document. An overlay's `AGENTS.md` is the whole file: its base's fragments without `source/ui/plain`, then its own. A template's `package.json` is named after the template. An overlay copies only its own layers, but its `package.json` merges the fragments of its base template's layers and its own, and is named after the base so the project can extend it as its own.
3. `bash scripts/lock.sh <name>...` regenerates the lockfile whenever dependencies changed. Direct dependencies are pinned to exact versions. For an overlay it copies the base to a temp directory, extracts the overlay over it, locks base and library together there, and stores the result in `overlays/<name>/pnpm-lock.yaml`.
4. Verify (below). A change is done only when every check passes.

`node scripts/render.mjs --check` renders every template and overlay to a temp directory and compares with `templates/` and `overlays/` (lockfiles excluded); it fails and lists each missing, extra or changed file. `--only` takes template and overlay names alike.

## Verification

Run these from the repository root. Each of the first three accepts template names, or directory paths (anything containing a slash or naming an existing directory is checked where it stands, so an extracted archive or a composed monorepo works).

- `bash scripts/check-template.sh <name>...` copies the target to a temp directory, installs from the lockfile, and runs the quality scripts.
- `bash scripts/live-check.sh <name>...` starts the target and asserts its behaviour.
- `node scripts/check-docs.mjs <name>...` checks documents and required paths.
- `bash scripts/make-archive.sh <out.tar.gz>` writes a codeload-shaped archive (top folder `project-templates-master/`) of the files from `git ls-files -co --exclude-standard`, so uncommitted work is included and ignored files are not.
- `bash scripts/check-overlays.sh <overlay>...` builds that archive, extracts the base into an empty directory with `tar -xz --strip=2 project-templates-master/templates/<base>`, enters it, extracts the overlay over it with `tar -xz --strip=3 project-templates-master/overlays/<overlay>`, and runs the three checks above against the result. It is the only check of an overlay, because an overlay is not a project until it is applied.
- `node scripts/test-render.mjs` and `node scripts/test-check-docs.mjs` test the tooling itself with fixtures.

### Build exception

The usual rule of not running a build does not apply here. Every Node template is built during verification, because a template has no deploy pipeline that would catch a broken build.

### Script contract every template must meet

- Node templates define the scripts `lint`, `format:check`, `typecheck`, `test` (single run, never watch mode) and `build`. `check-template.sh` fails when one is missing; the allowlist at the top of the script is empty.
- Web templates, with or without an overlay, also define `test:e2e`, a Playwright run that starts the app itself.
- Every UI overlay provides `shared/providers/UiProvider.tsx`, `shared/hooks/useNotification.ts` with exactly the methods `success`, `error`, `warning` and `info` and a test that guards them, `shared/styles/theme.ts`, a Home page rendered through the library's own component, a Playwright spec that asserts a computed style only that library's stylesheet produces, and the documents `docs/rules/ui.md`, `docs/styles.md`, `docs/components/README.md` and `docs/components/useNotification.md`. An overlay overwrites a base file only where the library needs it, so the base stays the shared truth.
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
