## UI: HeroUI

Stack addition: HeroUI 3 on Tailwind CSS 4 (through `postcss.config.mjs`).

- `src/shared/providers/UiProvider.tsx` mounts the toast host once; HeroUI needs no other provider. `src/shared/styles/theme.ts`, the one source of design values, maps the palette onto HeroUI's CSS variables.
- All user feedback goes through `useNotification()` from `src/shared/hooks/useNotification.ts` (exactly `success`, `error`, `warning`, `info`). Nothing else calls HeroUI's `toast` (`error` maps to `toast.danger`).
- Forms: add `react-hook-form`, `@hookform/resolvers` and `zod` with the first form (`docs/rules/ui.md`).
- The full rules are in `docs/rules/ui.md`.
