## Node conventions

- Dates go through `date` in `src/common/date.ts`, the only file that imports dayjs.
- Services throw `AppError` with a code from the failure table in `src/common/errors/failures.ts`; the code is never serialised. A new failure is a new table entry plus a row in the failure table of `docs/apis/conventions.md`.
- Wire format (`docs/rules/api-and-errors.md`): every wire key is snake_case while code stays camelCase, mapped field by field at the boundary with no generic key rewriter; ids are UUIDs, strings on the wire; instants are ISO 8601 strings; paths are plural kebab-case; `page_size` defaults to 20 and is capped at 100; failure messages are English.
- Imports use the `.js` extension (ESM). Tests live in the owning folder's `tests/`.
- Comments and docstrings are English; JSDoc (`/** ... */`) on functions, classes and modules, with `@param`, `@returns`, `@throws` as applicable.

## Commands

`pnpm dev`, `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm format:check` (`pnpm format` rewrites), `pnpm typecheck`, `pnpm test` (single run). A change is done when lint, format:check, typecheck, test and build pass.
