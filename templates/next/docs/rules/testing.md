# Testing and checks

Tests guard a module's contract and the risky paths, not every branch.

## Checks before calling a change done

Run in this order, using the scripts of `package.json`:

1. `pnpm lint`
2. `pnpm format:check` (run `pnpm format` first to fix)
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm test:e2e` when a route or a user journey changed

Do not run a production build while developing. Typecheck and lint cover application code; `pnpm build` belongs to the release pipeline. While working, run only the tests of the modules you touched (`pnpm exec vitest run src/modules/<feature>`); run the whole suite once when the work is finished.

## Unit and component tests: Vitest with Testing Library

- Vitest with `jsdom` and `@testing-library/react`. The config sets `environment: 'jsdom'`, resolves the `@` alias from `tsconfig.json`, and loads `src/test/setup.ts`, which registers the `jest-dom` matchers and cleans up after each test.
- Tests live in a `tests/` folder next to the code they cover: `src/shared/http/tests/http.test.ts`, `src/modules/home/tests/HomePage.test.tsx`. Name a file for its subject and a test for the behaviour. Do not put tests beside the source file.
- Test what a user sees: render, interact by role or label, assert on text. Do not assert on component internals or snapshot whole trees. Add `@testing-library/user-event` when a test needs real interaction.
- A component that uses React Query renders inside a `QueryClientProvider` with a fresh client per test and `retry: false`.
- Mock at the api-function boundary (`vi.mock` of the module's `api`). Never mock `axios` in feature tests.
- The wrapper has its own tests, `src/shared/http/tests/http.test.ts`. They replace the transport by setting `httpClient.defaults.adapter`, and guard envelope unwrapping, the list helper, `HttpError` from a failure body, `NetworkError`, `TimeoutError`, cancellation passthrough, the 401 handler and the token provider. Keep them green when the wrapper changes.
- Worth a test: a query-key factory (shape stability), a mutation's invalidation, form validation, and any logic that moves money or deletes data. Not worth one: presentational markup, library behaviour, what the type checker proves.

## End to end: Playwright

- `pnpm test:e2e` runs `playwright test`. The config starts the app itself on its own port (see `playwright.config.ts`), so nothing needs to be running, and it reuses a server already on that port only outside CI.
- Specs live in `tests/e2e/`, one per user journey. Select by role, label or text; avoid CSS selectors.
- Seed data through the API or a test database, never through another spec's leftovers; each spec is independent.
- Credentials for e2e come from environment variables of the test stack; examples in specs use fake accounts such as `user@example.com`.
- `playwright-report/` and `test-results/` are gitignored. The first run on a machine needs `pnpm exec playwright install chromium`.

## Shared component docs

A new shared component gets, in the same change:

1. A doc page in `docs/components/` (props, usage example, states, accessibility notes).
2. An entry in `docs/components/README.md`: name, one-line purpose, link to the page.

A change to a shared component's props updates its page. Reviewing a shared component without its page and index entry is incomplete.
