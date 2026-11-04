# Architecture

One tree, three layers. The framework decides what `app/` holds; `modules/` and `shared/` are the same everywhere. This page states the layout of this template (Next.js, App Router) and the rules that keep it that way.

## The tree

```
src/
  app/                      thin routes: layout.tsx, page.tsx, route groups, loading and error files
  modules/<feature>/        one folder per feature
    components/             UI only this feature uses
    hooks/                  query and mutation hooks
    api/                    getXxxApi fetchers and the query-key factory
    types/                  types that are not already in a shared contract
    styles/                 styles only this feature uses
    tests/                  tests of this feature
    index.ts                the module's public surface
  shared/
    components/             reusable UI, indexed in docs/components/README.md
    hooks/                  hooks with no feature knowledge (useMediaQuery)
    http/                   the axios wrapper, its error types and tests
    providers/              AppProviders, QueryProvider, UiProvider (the UI library slot)
    styles/                 theme.ts (the one source of site-wide style values) and the global stylesheet
    utils/                  pure helpers
  test/setup.ts             Vitest setup
tests/e2e/                  Playwright specs
```

A folder exists only when it holds a file; the tree above is the target shape, and a folder is created when its first file is. Today `modules/home/` holds `components/`, `tests/` and `index.ts`, and `shared/` holds `http/`, `hooks/`, `providers/`, `styles/` and `utils/`.

Why: a feature is deleted or moved as one folder, and a reader finds a thing by asking which feature owns it.

## Import rules

- One way: `app/` imports `modules/` and `shared/`; `modules/` imports `shared/`; `shared/` imports neither `app/` nor `modules/`. Why: `shared/` stays reusable, and a cycle between features cannot form through it.
- A module imports another module only through its `index.ts`, never a deep path. Why: the other module can reorganise freely.
- When `shared/` needs behaviour that belongs to a module (the auth token, the reaction to a 401), the module registers it at startup through a setter on the shared piece (`setAuthTokenProvider`, `setUnauthorizedHandler`). The shared code never imports the module.
- Use the `@/*` alias (it points at `src/*`) for anything outside the current folder; use relative imports only inside one folder.

## What goes where

- A route file reads params, renders one module component and nothing else. Logic found in a route moves to the module.
- A component used by two features moves to `shared/components/`. A component used by one stays in its module even if it looks generic.
- Feature-specific constants and types live in the module. A type shared with the backend comes from the `@app/contract` package (monorepo) or generated API types, not a hand copy.
- A shared component takes data and callbacks as props and calls no module hook.

## Files and naming

- Components: `PascalCase.tsx`, one exported component per file. Hooks: `useXxx.ts`. Everything else: lowercase `camelCase.ts`.
- Strict TypeScript; no `any` in new code; JSDoc on exported functions and components.
- Tests live in a `tests/` folder beside the code they cover, never beside the source file (see `testing.md`).

## Next.js specifics

### Routes and components

- `app/page.tsx` is a server component that renders one module component. Metadata (`metadata` or `generateMetadata`) is exported from the page or the root layout.
- Route groups separate audiences, for example `(web)` and `(dashboard)`, each with its own `layout.tsx`. Why: a layout per audience carries its own chrome (header, navigation) without conditionals. A layout is chrome only; it never decides who may see a page.
- Default to server components. Add `'use client'` only to the file that needs state, effects, browser APIs or a client-only library, and keep that file small. Why: every client boundary ships its imports to the browser.
- Providers are client components composed in `shared/providers/AppProviders.tsx` and mounted once in `app/layout.tsx`. Add a provider to `AppProviders`, never beside it.
- React Query hooks from `modules/*/hooks` are client-only. A server component fetches through the same api function, because `shared/http/base-url.ts` resolves the base to an absolute URL on the server (`API_HOST`, default `http://localhost:8000`, plus `/api/v1`) and keeps it relative in the browser; or it passes initial data to a client component. Server-side calls do not carry the browser's token: pass what the call needs explicitly.
- A file that must never reach the browser imports `server-only`; tests alias that import to an empty module.

### The API proxy

The browser calls `/api/v1` on its own origin and `next.config.ts` forwards it to the API, so there is no CORS. In the browser the wrapper's base URL is the relative `/api/v1`. On the server (server components, route handlers) Node cannot resolve a relative URL, so `shared/http/base-url.ts` returns `API_HOST` plus `/api/v1`.

`API_HOST` (default `http://localhost:8000`) is therefore read twice: at build time by `next.config.ts`, which bakes the rewrite target into the build, and at runtime by `base-url.ts` for server-side calls. In a deployment set it in both places, before `pnpm build` and in the environment of `pnpm start`; set only at build time, the browser works while server-side calls go to localhost:8000.

### Ports

`pnpm dev` serves on port 3000. Playwright starts its own dev server on port 3100 so it never meets a server you already run.

### Styles and assets

- `shared/styles/global.css` is imported by `app/layout.tsx` and reads the CSS variables that `ThemeVariables` publishes from `theme.ts`.
- Every site-wide colour, font, radius and spacing value comes from `shared/styles/theme.ts`, the one source of the whole site's style. No hex colour or font literal appears in `modules/` or in shared components. A top-level `src/styles/` is not used; `shared/styles/` keeps the three layers. See `docs/styles.md`.
- Use `next/image` for content images and `next/font` for fonts.

### Environment

Copy `.env.example` to `.env` to change `API_HOST` (build time for the rewrite, runtime for server-side calls). `.env` is gitignored; never commit a real value or put a secret in a variable the browser can read (`NEXT_PUBLIC_` prefix).

### Generated files

`next-env.d.ts` and `.next/` are generated and gitignored. `pnpm typecheck` runs `next typegen` first, so a fresh clone typechecks without running the dev server.

## Serving a public site and a dashboard from one project

The default names are `web` for the public site and `dashboard` for the signed-in area. The template ships neither a second route nor a second layout; add them when the product needs them.

- Use route groups `app/(web)/` and `app/(dashboard)/`, each with its own `layout.tsx` that carries chrome only (header, navigation). Do not use other example names such as `(public)`.
- A layout never decides who may see a page. Access is checked in `proxy.ts` and again at the data access, as the steps in "Authentication is not included" say.
- Modules stay under `modules/<feature>/`; a route file of either group renders one module component.
- A separate `dashboard/` app beside `web/` is created with `monorepo.sh <project> <web> <ui> <server> --dashboard <next|vite> <plain|antd|mui|heroui>`. Choose it when the frameworks or the deployment differ, when the dashboard needs its own domain or an intranet, or when the public site must not carry the dashboard's UI weight. One app stays the default.

## Authentication is not included

This template ships no authentication: no session, no sign-in page, no route guard, and no `proxy.ts`. Every route and API call is public. Add it before the first non-public route ships:

1. Add an `auth` module that owns sign-in, session state and sign-out.
2. At startup, register `setAuthTokenProvider` (reads the session) and `setUnauthorizedHandler` (sends the user to sign-in) from a client component mounted in `AppProviders`.
3. Check the session in `proxy.ts` (the file Next.js 16 calls to intercept requests) and again at the data access, where the API call or query is made. A route group's `layout.tsx` handles chrome only: layouts do not re-render on every navigation, so a check there is not a guard.
4. Keep the token out of `localStorage` when a cookie session can do the job.
5. Update this page, `docs/README.md` and the rules that mention auth.
