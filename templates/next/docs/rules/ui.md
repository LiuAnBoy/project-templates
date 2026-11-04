# UI

This template ships no UI library and no styling framework. The only stylesheet is `src/shared/styles/global.css`, loaded once by the root layout or the entry point; component styles that outgrow it sit beside their component.

## What exists

- Markup is plain React elements.
- `src/shared/providers/UiProvider.tsx` is the one slot a UI library fills, composed by `AppProviders`. In this template it provides `useNotification` and renders the messages itself.
- `src/shared/hooks/useNotification.ts` is the one way to notify the user (see "The notification rule").
- `src/shared/styles/theme.ts` is the one source of every site-wide colour, font and radius. `src/shared/providers/ThemeVariables.tsx`, composed by `AppProviders`, publishes it as CSS custom properties on the root, and `global.css` reads them.
- `src/shared/components/ErrorState.tsx` is the one full-page failure screen, used by the error and not-found pages of the framework. It styles itself from `theme.ts` and shows fixed text only.

## The theme rule

Every site-wide colour, font, radius and spacing value comes from `src/shared/styles/theme.ts`. No hex colour or font literal appears in `modules/` or in shared components; read the CSS variable (`var(--theme-primary)`) instead. A component that must render where the stylesheet and the providers may be missing (`ErrorState` on the Next.js `global-error` page) imports `palette`, `radius` or `fontFamily` from `theme.ts` and uses them in inline styles; it still holds no literal. A new value is added to `theme.ts` and to its `cssVariables`, not written where it is used. There is no top-level `src/styles/`.

## Choosing a UI library

A UI library is chosen when the project is created, as an overlay: the project template repository holds one overlay per framework and library (`next-antd`, `next-mui`, `next-heroui`, `vite-antd`, `vite-mui`, `vite-heroui`). Extracting it over a fresh copy of this template and running `pnpm install` replaces the files it needs, including `UiProvider.tsx` and `useNotification.ts`, and brings the library's theme, documents and tests. An overlay is never applied to a project already in development.

For a project that is already past creation, or a library with no overlay, add the library by hand, choosing one library for the whole app, in one change:

1. Put the library's provider in `UiProvider.tsx`, with the children inside it. `AppProviders.tsx` already composes it outside `QueryProvider`.
2. Rewrite `useNotification.ts` over the library's message or toast API, keeping the four methods below, and drop the notification region this template's `UiProvider` renders.
3. Keep `theme.ts` as the one source: keep its `palette`, `radius` and `fontFamily`, and build the library's own theme config from them in the same file. `ErrorState` imports those three.
4. Rewrite this page to name the library and its rules, and update `docs/styles.md`, `docs/components/useNotification.md` and `docs/components/README.md` to match.

## The notification rule

User feedback goes through one hook, `src/shared/hooks/useNotification.ts`, that returns the same four methods whatever the UI library:

```ts
export interface Notification {
  success(message: string): void;
  error(message: string): void;
  warning(message: string): void;
  info(message: string): void;
}
```

- Components call `useNotification()`. Nothing outside that file and `UiProvider.tsx` renders a message or calls a library's message API. Why: wording, placement and duration change in one place, and a library swap touches one file.
- Without a library the `UiProvider` renders each message in an `aria-live` region at the top right and removes it after four seconds. It adds no dependency.
- The hook is called from event handlers and mutation callbacks, never from query hooks (see `data-layer.md`).
- A message the user must act on later is a dialog, not a notification, because notifications dismiss themselves.
- Keep the returned object stable between renders, since components use it as an effect dependency.
- The hook needs the `UiProvider` mounted above it and throws without one. Tests that render a component using the hook use `renderWithProviders` (see `testing.md`).
- The hook has its page `docs/components/useNotification.md` and an entry in `docs/components/README.md`.

## Forms

Without a library, use plain elements with a zod schema per form. With a library, use its form components and keep field validation in the schema, with the server's `message` shown through the notification hook.
