## Stack and commands

Stack: Next.js 16 (App Router), React 19, TanStack React Query 5, axios, TypeScript 6, Vitest + Playwright, ESLint 10 + Prettier, pnpm.

- `pnpm dev` starts the app on port 3000 and forwards `/api/v1` to the API on port 8000 (`API_HOST` overrides it).
- `pnpm lint`, `pnpm format:check` (fix with `pnpm format`), `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`.
- `pnpm build` and `pnpm start` are for the release pipeline. Do not run a production build while developing.

## Routing

`src/app/` holds thin routes. A route file reads params and renders one module component; add a feature's route as a thin file there.
