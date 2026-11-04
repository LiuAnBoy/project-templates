## Stack and commands

Stack: Vite 8 + React Router 8, React 19, TanStack React Query 5, axios, TypeScript 6, Vitest + Playwright, ESLint 10 + Prettier, pnpm.

- `pnpm dev` starts the app on port 5173 and forwards `/api` to the API on port 8000 (`API_HOST` overrides it).
- `pnpm lint`, `pnpm format:check` (fix with `pnpm format`), `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`.
- `pnpm build` and `pnpm start` (preview of the build) are for the release pipeline. Do not run a production build while developing.

## Routing

`src/app/` holds the router and the root component. A feature adds `src/modules/<feature>/routes.tsx` that exports the module's route array, each route rendering one module component, and spreads it into `src/app/router.tsx`.
