# 樣式

此專案使用 MUI 9，樣式由 emotion 產生，沒有 Tailwind 之類的樣式框架。

## 目前的樣式

- `src/shared/styles/theme.ts` 是全站樣式的唯一來源：先是 `palette`（primary、background、surface、text、textSecondary、border）、`radius`、`fontFamily` 與 `cssVariables`，再由它們用 `createTheme` 組出 `theme`。要改設計值就改這裡，元件用 `color="primary"`、`theme.palette` 之類的方式取用，不要在各檔案重複寫色碼。
- `src/shared/providers/ThemeVariables.tsx` 把 `cssVariables` 以 `:root` 規則放進頁面，`global.css` 讀這些變數；沒有最上層的 `src/styles/`。
- `src/shared/providers/UiProvider.tsx` 用 `ThemeProvider` 套用 `theme`，加上 `CssBaseline` 重設樣式，並掛上通知用的 `SnackbarProvider`（同時最多 3 則、4 秒後消失、顯示在右上角）。
- `src/shared/styles/global.css` 只有 `color-scheme`、`body` 的 margin、背景、文字顏色與字型（都讀變數），以及首頁置中用的 `.page`，在根 layout（Next.js 的 `app/layout.tsx`，或 Vite 的 `src/main.tsx`）載入一次。
- 在 Next.js，`app/layout.tsx` 用 `@mui/material-nextjs/v16-appRouter` 的 `AppRouterCacheProvider` 把首屏的 emotion 樣式放進伺服器輸出的 HTML。這一層要留著；移除後 hydration 會失敗。

## 驗證

`tests/e2e/home.spec.ts` 檢查首頁標題的顏色與字級是 `theme` 與 MUI 樣式產生的值，證明 provider 與樣式有載入。在 Next.js，`tests/e2e/ssr.spec.ts` 關閉 JavaScript 後，檢查 `<head>` 裡有 `AppRouterCacheProvider` 放進去的 emotion 樣式，證明伺服器輸出帶有樣式。
