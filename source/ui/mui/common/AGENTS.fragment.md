## UI: MUI

Stack addition: MUI 9 with `@mui/icons-material`, emotion, notistack, `react-hook-form` and zod (and `@mui/material-nextjs` under Next.js, mounted in `app/layout.tsx`).

- `src/shared/providers/UiProvider.tsx` mounts `ThemeProvider`, `CssBaseline` and notistack's `SnackbarProvider`; the `theme` it passes is built from the palette in `src/shared/styles/theme.ts`, the one source of design values.
- All user feedback goes through `useNotification()` from `src/shared/hooks/useNotification.ts` (exactly `success`, `error`, `warning`, `info`). Nothing else calls notistack's `enqueueSnackbar`.
- Forms: `react-hook-form` with `Controller` around `TextField` and a zod resolver.
- The full rules are in `docs/rules/ui.md`.
