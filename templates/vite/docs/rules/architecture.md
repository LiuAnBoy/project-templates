# Architecture

One tree, three layers. The framework decides what `app/` holds; `modules/` and `shared/` are the same everywhere. This page states the layout of this template (a Vite single-page app with React Router 8) and the rules that keep it that way.

## The tree

```
index.html
vite.config.ts              Vite, dev proxy and Vitest settings
src/
  main.tsx                  entry: global stylesheet, then App
  app/                      App.tsx (error boundary, providers and router), router.tsx (the only router file), ErrorBoundary.tsx, RouteError.tsx
  modules/<feature>/        one folder per feature
    components/             UI only this feature uses
    hooks/                  query and mutation hooks
    api/                    getXxxApi fetchers and the query-key factory
    types/                  types that are not already in a shared contract
    styles/                 styles only this feature uses
    tests/                  tests of this feature
    routes.tsx              the module's route array
    index.ts                the module's public surface
  shared/
    components/             reusable UI, indexed in docs/components/README.md
    hooks/                  hooks with no feature knowledge (useMediaQuery, useNotification)
    http/                   the axios wrapper, its error types and tests
    providers/              AppProviders, QueryProvider, UiProvider (the UI library slot)
    styles/                 theme.ts (the one source of site-wide style values) and the global stylesheet
    utils/                  pure helpers
  test/                     Vitest setup, renderWithProviders, matchMedia stub
tests/e2e/                  Playwright specs
```

A folder exists only when it holds a file; the tree above is the target shape, and a folder is created when its first file is. Today `modules/home/` holds `components/`, `tests/`, `routes.tsx` and `index.ts`, and `shared/` holds `components/`, `http/`, `hooks/`, `providers/`, `styles/` and `utils/`.

Why: a feature is deleted or moved as one folder, and a reader finds a thing by asking which feature owns it.

## Import rules

- One way: `app/` imports `modules/` and `shared/`; `modules/` imports `shared/`; `shared/` imports neither `app/` nor `modules/`. Why: `shared/` stays reusable, and a cycle between features cannot form through it.
- A module imports another module only through its `index.ts`, never a deep path. The router is the one exception: it imports each module's `routes.tsx`. Why: the other module can reorganise freely.
- When `shared/` needs behaviour that belongs to a module (the auth token, the reaction to a 401), the module registers it at startup through a setter on the shared piece (`setAuthTokenProvider`, `setUnauthorizedHandler`). The shared code never imports the module.
- Use the `@/*` alias (it points at `src/*`, declared once in `tsconfig.json` and read by Vite and Vitest) for anything outside the current folder; use relative imports only inside one folder.

## What goes where

- A route element renders one module component and nothing else. Logic found in a route moves to the module.
- A component used by two features moves to `shared/components/`. A component used by one stays in its module even if it looks generic.
- Feature-specific constants and types live in the module. A type shared with the backend comes from the `@app/contract` package where it exists (a monorepo with a Node server). Without that package, the project keeps those types in the module by hand and changes them with the API.
- A shared component takes data and callbacks as props and calls no module hook.

## Files and naming

- Components: `PascalCase.tsx`, one exported component per file. Hooks: `useXxx.ts`. Everything else: lowercase `camelCase.ts`.
- Strict TypeScript; no `any` in new code; JSDoc on exported functions and components.
- Tests live in a `tests/` folder beside the code they cover, never beside the source file (see `testing.md`).

## Vite specifics

### Routing

- `app/router.tsx` is the only router file. It spreads each module's `routes` array into the exported `routes`, which `createBrowserRouter` turns into the app's router, so adding a feature is one import and one spread, and the module owns its paths. React Router 8 is used in library mode: `createBrowserRouter` from `react-router`, `RouterProvider` from `react-router/dom`.
- Layouts and route guards are shared components under `shared/layouts/` once they exist; a guard reads session state and redirects, it calls no API.
- Lazy-load heavy routes with `React.lazy` where the bundle warrants it.

### Error and not-found pages

- `router.tsx` exports `routes`: one root route whose `errorElement` is `RouteError`, with the modules' routes and a final `*` route rendering `ErrorState` with `kind="not-found"` as its children. Add a module's routes before the catch-all.
- `RouteError` catches a route that throws while rendering or loading. React Router has no reset, so its retry reloads the page. `ErrorBoundary` wraps `AppProviders` and the router in `App.tsx` and catches what sits outside the routes; its retry renders the children again.
- Both log the error with `console.error` and render `ErrorState`. Neither shows the error's message or stack.

### Providers

`shared/providers/AppProviders.tsx` composes the global providers and `app/App.tsx` mounts it around the router, inside the `ErrorBoundary`. Add a provider to `AppProviders`, never beside it.

### The API proxy

The browser calls `/api/v1` on its own origin. `vite.config.ts` forwards `/api` to `API_HOST` (default `http://localhost:8000`) in both `vite` (dev) and `vite preview`, so there is no CORS. The wrapper's base URL (`shared/http/base-url.ts`) is always the relative `/api/v1`, and the bundle never reads `process`. A production build has no proxy: put a reverse proxy in front that forwards `/api` to the API, so no API host is compiled into the bundle.

### Ports

`pnpm dev` serves on port 5173 and `pnpm start` (preview) on 4173. Playwright starts its own dev server on port 5273 so it never meets a server you already run.

### Environment

Copy `.env.example` to `.env` to change `API_HOST`, which only the dev and preview proxy read. Values the browser needs are `VITE_`-prefixed variables and are public by nature; never put a secret in one. `.env` is gitignored.

### Styles

- `shared/styles/global.css` is imported by `src/main.tsx` and reads the CSS variables that `ThemeVariables` publishes from `theme.ts`.
- Every site-wide colour, font, radius and spacing value comes from `shared/styles/theme.ts`, the one source of the whole site's style. No hex colour or font literal appears in `modules/` or in shared components. A top-level `src/styles/` is not used; `shared/styles/` keeps the three layers. See `docs/styles.md`.

## Serving a public site and a dashboard from one project

The default names are `web` for the public site and `dashboard` for the signed-in area. The template ships neither a second route nor a second layout; add them when the product needs them.

- Nest the routes under two layout routes, `web` and `dashboard`, each rendering its own chrome and an `Outlet`. Each module exports its own route array, and `app/router.tsx` spreads the arrays under the right layout.
- Load the dashboard routes with `React.lazy` so the dashboard ships as its own chunk and the public pages do not download it.
- Dashboard code still reaches the browser, as any chunk does. A layout or a route guard only shapes the screen, so the API must enforce every permission.
- A separate `dashboard/` app beside `web/` is created with `monorepo.sh <project> <web> <ui> <server> --dashboard <next|vite> <plain|antd|mui|heroui>`. Choose it when the frameworks or the deployment differ, when the dashboard needs its own domain or an intranet, or when the public site must not carry the dashboard's UI weight. One app stays the default.

## Authentication is not included

This template ships no authentication: no session, no sign-in page and no route guard. Every route and API call is public. Add it before the first non-public route ships:

1. Add an `auth` module that owns sign-in, session state and sign-out.
2. Register `setAuthTokenProvider` (reads the session) and `setUnauthorizedHandler` (sends the user to sign-in) in `main.tsx` before the first render.
3. Add a route wrapper in `shared/layouts/` that redirects when there is no session, and nest the protected module routes under it in `app/router.tsx`.
4. Update this page, `docs/README.md` and the rules that mention auth.
