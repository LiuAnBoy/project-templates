# UI

This project uses Ant Design 6 (`antd`) with `@ant-design/icons`, chosen when the project was created. Use antd's own components for every piece of UI; do not add a second component library or a styling framework.

## What exists

- `src/shared/providers/UiProvider.tsx` mounts `ConfigProvider` (Traditional Chinese locale `zh_TW`, theme `appTheme`) around antd's `App`. `AppProviders.tsx` composes it outside `QueryProvider`.
- `src/shared/styles/theme.ts` exports the palette, `cssVariables` and `appTheme`, the antd theme tokens built from the palette.
- `src/shared/hooks/useNotification.ts` is the notification hook.
- Under Next.js, `src/app/layout.tsx` wraps the tree in `AntdRegistry` (`@ant-design/nextjs-registry`), which puts the first-screen styles into the server-rendered HTML. Keep it outermost in the body.

## Rules

- Every site-wide colour, font, radius and spacing value comes from `src/shared/styles/theme.ts`, the one source of the whole site's style. It exports `palette`, `radius`, `fontFamily` and `cssVariables`, then `appTheme` built from them, which `UiProvider` passes to `ConfigProvider`. `ThemeVariables` publishes `cssVariables` on the root and `global.css` reads them. No hex colour or font literal appears in `modules/` or in shared components, and there is no top-level `src/styles/`.
- Design values are antd tokens in `appTheme`. Do not override antd classes with global CSS and do not repeat colour literals per component.
- Components that use antd hooks or state are client components under Next.js (`'use client'` at the top of the file).
- Modals and confirm dialogs come from `App.useApp().modal`, never from static `Modal.confirm`, because static calls cannot see the theme or locale.
- Icons come from `@ant-design/icons`, imported by name.

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

- Components call `useNotification()`. Nothing outside that file calls antd's `message` or `notification`. Why: wording, placement and duration change in one place, and a library swap touches one file.
- The hook is called from event handlers and mutation callbacks, never from query hooks (see `data-layer.md`).
- A message the user must act on later is a dialog, not a notification, because notifications dismiss themselves.
- The hook reads `App.useApp()`, so it needs `UiProvider` above it. A test that renders a component using the hook renders it inside `UiProvider`; antd also needs `window.matchMedia`, which jsdom lacks, so such a test defines a stub as `useNotification.test.tsx` does.
- The returned object is memoised, so it is safe as an effect dependency.

## Forms

Use antd's `Form` and `Form.Item` with `name` and `rules`; keep `Form.useForm()` in the component and call the mutation from the submit handler. Show the server's `message` through the notification hook with `getErrorMessage`.
