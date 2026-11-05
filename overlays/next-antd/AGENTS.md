# Web app

The rules in `docs/rules/` govern all new code here. Read this file, then the pages that the table below names for your task, before the first edit. Where a page and your habit disagree, the page wins.

## Always-rules

- Three layers: `src/app/` (routing and the root), `src/modules/<feature>/` and `src/shared/`. Imports run one way and `shared/` never imports `modules/`.
- All HTTP goes through `http` from `src/shared/http/http.ts`. Never raw `fetch`, and never `axios` imported anywhere else.
- Server state is React Query over module api functions. Hooks do no UI side effects.
- Every wire key is snake_case; api functions and types keep items in the wire shape (`docs/rules/data-layer.md`).
- Dates go only through the `date` object of `src/shared/utils/date.ts`, the one file that imports `dayjs`.
- Every site-wide colour, font, radius and spacing value comes from `src/shared/styles/theme.ts`; no hex or font literal in modules or shared components.
- Use the `@/*` import alias, strict TypeScript, JSDoc on exported functions, English comments.
- Tests live in a `tests/` folder next to the code they cover, never beside the source file.
- A new shared component gets its page in `docs/components/` and an index entry in the same change.
- This template ships no authentication and every route is public. Add the steps in `docs/rules/architecture.md` ("Authentication is not included") before any non-public route ships.
- Never commit `.env` or any secret.

## Task to doc

| Task                                                                       | Read                                 |
| -------------------------------------------------------------------------- | ------------------------------------ |
| New folder, moving code between layers, a route, a provider, the API proxy | `docs/rules/architecture.md`         |
| API call, query hook, query keys, errors, token, forms                     | `docs/rules/data-layer.md`           |
| Tests, e2e, checks before calling done, shared-component pages             | `docs/rules/testing.md`              |
| UI library, notifications, styles                                          | `docs/rules/ui.md`, `docs/styles.md` |
| What shared pieces exist and how to use them                               | `docs/components/README.md`          |
| Project overview, commands, index of all docs                              | `docs/README.md`                     |

## Documents and language

- `AGENTS.md` and everything under `docs/rules/` are English and contain no CJK characters.
- Every other page under `docs/` (`README.md`, `styles.md`, `components/`) is Traditional Chinese and records only what exists in the code.
- A new doc page follows the language of its folder: rules in English, records in Traditional Chinese.

## Adding a feature

1. Read the pages above for the task.
2. Create `src/modules/<feature>/` on the shape of `src/modules/home/`: `components/`, `hooks/`, `api/`, `types/`, `tests/` and `index.ts`, creating each folder when its first file is written.
3. Write the api functions and the key factory over `http`, then the query and mutation hooks (`docs/rules/data-layer.md`).
4. Add the route the way the Routing section below describes.
5. Add tests in the module's `tests/` folder (`docs/rules/testing.md`); add a Playwright spec when the feature is a user journey.
6. Record what shipped in the Traditional Chinese docs: the index in `docs/README.md`, and a page plus index entry in `docs/components/` for each new shared piece.
7. Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` (and `pnpm test:e2e` for a journey).

## Stack and commands

Stack: Next.js 16 (App Router), React 19, TanStack React Query 5, axios, TypeScript 6, Vitest + Playwright, ESLint 10 + Prettier, pnpm.

- `pnpm dev` starts the app on port 3000 and forwards `/api/v1` to the API on port 8000 (`API_HOST` overrides it).
- `pnpm lint`, `pnpm format:check` (fix with `pnpm format`), `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`.
- `pnpm build` and `pnpm start` are for the release pipeline. Do not run a production build while developing.

## Routing

`src/app/` holds thin routes. A route file reads params and renders one module component; add a feature's route as a thin file there.

## Docker

These rules apply when the project has a `Dockerfile`, a `docker-compose.yml` and a `.dockerignore`; a project that declined them has none of the three. The full rules are in `docs/rules/docker.md`.

- No secret enters an image. A server's runtime values come from `.env` through `env_file` and from `environment`; a web service reads no `env_file`, only build arguments and `environment`. The only build arguments allowed are `API_HOST` and `PART`, and `.dockerignore` keeps `.env`, `node_modules` and `todos` out of the build context.
- The image runs as a numeric non-root uid and never root: 1000, or 101 in the nginx image of a Vite project. It holds only the built output and, for a server, its production dependencies.
- `COMPOSE_PROJECT_NAME` in `.env` must be set. It names the compose project, so two projects on one machine never share a container or a volume.
- A server answers `GET /api/health` inside its container; its compose healthcheck reads that route through the image's own runtime, and a failing dependency check marks the container unhealthy. A web service's healthcheck reads `/`, never the API, so an API outage does not mark it unhealthy.
- Published ports bind to `127.0.0.1`; a proxy in front of the project is the way to open one wider.

## UI: Ant Design

Stack addition: Ant Design 6 with `@ant-design/icons` (and `@ant-design/nextjs-registry` under Next.js, mounted in `app/layout.tsx`).

- `src/shared/providers/UiProvider.tsx` mounts `ConfigProvider` (zhTW) around antd `App`; the `appTheme` it passes is built from the palette in `src/shared/styles/theme.ts`, the one source of design values.
- All user feedback goes through `useNotification()` from `src/shared/hooks/useNotification.ts` (exactly `success`, `error`, `warning`, `info`). Nothing else calls antd's `message` or `notification`.
- Forms: antd `Form` and `Form.Item` with `name` and `rules`.
- The full rules are in `docs/rules/ui.md`.
