# UI

This template ships no UI library and no styling framework. The only stylesheet is `src/shared/styles/global.css`, loaded once by the root layout or the entry point; component styles that outgrow it sit beside their component.

## What exists

- Markup is plain React elements.
- There is no notification hook, no `UiProvider` and no theme file. A component that must tell the user something renders the message itself.

## Adding a UI library

Choose one library for the whole app, then in the same change:

1. Add its provider in `src/shared/providers/` and compose it in `AppProviders.tsx`, outside `QueryProvider`.
2. Add the notification hook described below.
3. Put theme values in `src/shared/styles/theme.ts`, not repeated per component.
4. Rewrite this page to name the library and its rules, and update `docs/styles.md` and `docs/components/README.md` to match.

## The notification rule

Once a library is in, user feedback goes through one hook, `src/shared/hooks/useNotification.ts`, that wraps the library's message or toast API and returns the same four methods whatever the library:

```ts
export interface Notification {
  success(message: string): void;
  error(message: string): void;
  warning(message: string): void;
  info(message: string): void;
}
```

- Components call `useNotification()`. Nothing outside that file calls the library's message API. Why: wording, placement and duration change in one place, and a library swap touches one file.
- The hook is called from event handlers and mutation callbacks, never from query hooks (see `data-layer.md`).
- A message the user must act on later is a dialog, not a notification, because notifications dismiss themselves.
- Memoise the returned object when the library's hook returns unstable functions, since components use it as an effect dependency.
- The hook needs its library's provider mounted above it. Tests that render a component using the hook render it inside that provider.
- The new hook gets its page `docs/components/useNotification.md` and an entry in `docs/components/README.md` in the same change.

## Forms

Without a library, use plain elements with a zod schema per form. With a library, use its form components and keep field validation in the schema, with the server's `message` shown through the notification hook.
