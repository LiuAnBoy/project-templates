# 樣式

此專案使用 HeroUI 3，建立在 Tailwind CSS 4 之上。HeroUI 3 的樣式是 CSS，不需要 Tailwind 設定檔或外掛。

## 目前的樣式

- `src/shared/styles/global.css` 先 `@import 'tailwindcss'` 再 `@import '@heroui/styles'`，順序不能對調。檔案其餘部分是 `color-scheme`、`body` 的 margin、背景、文字顏色與字型（都讀變數），以及首頁置中用的 `.page`。它在根 layout（Next.js 的 `app/layout.tsx`，或 Vite 的 `src/main.tsx`）載入一次。
- Tailwind 透過根目錄的 `postcss.config.mjs` 以 `@tailwindcss/postcss` 執行，Next.js 與 Vite 都一樣。
- `src/shared/styles/theme.ts` 是全站樣式的唯一來源：`palette`（primary、background、surface、text、textSecondary、border）、`radius`、`fontFamily`，以及 `cssVariables`。`cssVariables` 除了 `--theme-*` 之外，還把這些值對應到 HeroUI 的變數（`--accent`、`--background`、`--foreground`、`--surface`、`--muted`、`--border`、`--radius`）。要改設計值就改這裡，不要在 `global.css` 或元件裡重新宣告。
- `src/shared/providers/ThemeVariables.tsx` 把 `cssVariables` 以未分層的 `:root` 規則放進頁面，所以會蓋過 HeroUI 分層的預設值；`global.css` 讀 `--theme-*`。沒有最上層的 `src/styles/`。
- 同一個檔案也放 toast 的位置（`top end`）、同時顯示的數量（3）與停留時間（4000 毫秒）。
- 組 class 字串用 `src/shared/utils/cn.ts` 的 `cn`，它會合併衝突的 Tailwind class。

## 驗證

`tests/e2e/home.spec.ts` 檢查首頁標題的粗細（HeroUI 卡片樣式給的 500）、字級（Tailwind 的 `text-2xl` 給的 24px）與顏色（`--foreground`，由 `palette.text` 對應而來），移除 `@heroui/styles` 的匯入或 `postcss.config.mjs` 其中一項，測試就會失敗。
