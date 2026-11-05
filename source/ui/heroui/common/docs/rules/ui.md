# UI

This project uses HeroUI 3 (`@heroui/react`, `@heroui/styles`) on Tailwind CSS 4, chosen when the project was created. Use HeroUI's own components for every piece of UI; do not add a second component library.

## What exists

- `src/shared/styles/global.css` imports `tailwindcss` and then `@heroui/styles`, in that order, and is loaded once by the root layout (Next.js) or the entry point (Vite). Tailwind runs through `postcss.config.mjs` with `@tailwindcss/postcss`.
- `src/shared/providers/UiProvider.tsx` mounts the toast host, `Toast.Provider`, once. HeroUI 3 components need no context provider.
- `src/shared/styles/theme.ts` holds the palette, radius and font, their mapping onto HeroUI's variables, and the toast placement, number of visible toasts and toast duration.
- `src/shared/hooks/useNotification.ts` is the notification hook.

## Rules

- Every site-wide colour, font, radius and spacing value comes from `src/shared/styles/theme.ts`, the one source of the whole site's style. It exports `palette`, `radius`, `fontFamily` and `cssVariables`, then HeroUI's own variables (`--accent`, `--background`, `--foreground`, `--surface`, `--muted`, `--border`, `--radius`) set from them. `ThemeVariables` publishes `cssVariables` on the root and `global.css` reads them. No hex colour or font literal appears in `modules/` or in shared components, and there is no top-level `src/styles/`.
- Colours, radii and fonts are HeroUI's CSS variables, set from `theme.ts`; do not redeclare them in `global.css`. Do not restyle a HeroUI component per use and do not write colour literals in components.
- Style with Tailwind utility classes and HeroUI's tokens (`bg-surface`, `text-foreground`, `text-muted`). When a component first composes class strings, add `clsx` and `tailwind-merge` with one `cn` helper in `src/shared/utils/cn.ts`, and never concatenate strings.
- Components that use HeroUI are client components under Next.js (`'use client'` at the top of the file).
- Add `lucide-react` with the first icon, and import icons by name.
- HeroUI 3 is built on React Aria, so a press handler is `onPress`, not `onClick`.

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

- Components call `useNotification()`. Nothing outside that file calls HeroUI's `toast`. Why: wording, placement and duration change in one place, and a library swap touches one file.
- `error` maps to `toast.danger`, because `danger` is HeroUI's name for the error variant. A bare `toast(message)` shows the default variant, not `info`.
- The hook is called from event handlers and mutation callbacks, never from query hooks (see `data-layer.md`).
- A message the user must act on later is a dialog, not a notification, because notifications dismiss themselves.
- `toast` is a plain function, so the hook needs no provider to run; the host that shows toasts is mounted by `UiProvider`. A toast sent before the host mounts is shown once it does.

## Forms

Add `react-hook-form`, `@hookform/resolvers` and `zod` with the first form. Use HeroUI's form components with `react-hook-form` and a zod schema through `zodResolver` from `@hookform/resolvers/zod`. Pass the field's error text to the component's invalid state. Keep field validation in the schema and show the server's `message` through the notification hook with `getErrorMessage`.
