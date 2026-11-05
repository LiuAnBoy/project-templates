# UI

This project uses MUI 9 (`@mui/material`) with emotion and notistack, chosen when the project was created. Use MUI's own components for every piece of UI; do not add a second component library or a styling framework.

## What exists

- `src/shared/providers/UiProvider.tsx` mounts `ThemeProvider` (theme from `src/shared/styles/theme.ts`), `CssBaseline` and notistack's `SnackbarProvider`. `AppProviders.tsx` composes it outside `QueryProvider`.
- `src/shared/styles/theme.ts` exports the palette, `cssVariables` and `theme`, created with `createTheme` from the palette.
- `src/shared/hooks/useNotification.ts` is the notification hook.
- Under Next.js, `src/app/layout.tsx` wraps the tree in `AppRouterCacheProvider` from `@mui/material-nextjs/v16-appRouter`, which collects the emotion styles of the first screen into the server-rendered HTML. Keep it outermost in the body. Its version suffix must match the Next.js major.

## Rules

- Every site-wide colour, font, radius and spacing value comes from `src/shared/styles/theme.ts`, the one source of the whole site's style. It exports `palette`, `radius`, `fontFamily` and `cssVariables`, then the `theme` built from them, which `UiProvider` passes to `ThemeProvider`. `ThemeVariables` publishes `cssVariables` on the root and `global.css` reads them. No hex colour or font literal appears in `modules/` or in shared components, and there is no top-level `src/styles/`.
- Colours, typography and shape come from the theme (`color="primary"`, `theme.palette`, `theme.typography`). Do not repeat colour literals in `sx` across files; `sx` and `styled` are for one-off layout.
- Components that use MUI hooks or state are client components under Next.js (`'use client'` at the top of the file).
- Add `@mui/icons-material` with the first icon; import by path (`.../Add`), never from the root.

## The notification rule

User feedback goes through `useNotification()` from `src/shared/hooks/useNotification.ts`, which returns exactly four methods:

```ts
export interface Notification {
  success(message: string): void;
  error(message: string): void;
  warning(message: string): void;
  info(message: string): void;
}
```

- Components call `useNotification()`. Nothing outside that file calls notistack's `enqueueSnackbar`. Why: wording, placement and duration change in one place, and a library swap touches one file.
- The hook is called from event handlers and mutation callbacks, never from query hooks (see `data-layer.md`).
- A message the user must act on later is a dialog, not a notification, because notifications dismiss themselves.
- The hook needs `SnackbarProvider` above it, which `UiProvider` mounts. A test that renders a component using the hook renders it inside `UiProvider`.
- The returned object is memoised, so it is safe as an effect dependency.

## Forms

Add `react-hook-form`, `@hookform/resolvers` and `zod` with the first form. Use `react-hook-form` with a zod schema through `zodResolver` from `@hookform/resolvers/zod`. Wrap each `TextField` in `Controller` and feed `error` and `helperText` from the field state. Keep field validation in the schema and show the server's `message` through the notification hook with `getErrorMessage`.
