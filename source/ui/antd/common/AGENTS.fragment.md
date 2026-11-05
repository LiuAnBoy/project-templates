## UI: Ant Design

Stack addition: Ant Design 6 (and `@ant-design/nextjs-registry` under Next.js, mounted in `app/layout.tsx`).

- `src/shared/providers/UiProvider.tsx` mounts `ConfigProvider` (zhTW) around antd `App`; the `appTheme` it passes is built from the palette in `src/shared/styles/theme.ts`, the one source of design values.
- All user feedback goes through `useNotification()` from `src/shared/hooks/useNotification.ts` (exactly `success`, `error`, `warning`, `info`). Nothing else calls antd's `message` or `notification`.
- Forms: antd `Form` and `Form.Item` with `name` and `rules`.
- The full rules are in `docs/rules/ui.md`.
