# 樣式

此範本沒有 UI 元件庫，也沒有 Tailwind 之類的樣式框架。

## 目前的樣式

- `src/shared/styles/theme.ts` 是全站樣式的唯一來源：`palette`（primary、background、surface、text、textSecondary、border，以及通知用的 success、warning、danger）、`radius`、`fontFamily`，以及把它們對應成 CSS 變數的 `cssVariables`。要改顏色、字型或圓角就改這裡，元件與模組裡不寫色碼或字型字面值。
- `src/shared/providers/ThemeVariables.tsx` 由 `AppProviders` 掛載，把 `cssVariables` 以 `:root` 規則放進頁面（伺服器輸出的 HTML 也有），這是唯一設定這些變數的地方。
- `src/shared/styles/global.css` 只讀變數：`body` 的背景、文字顏色與字型，以及首頁置中用的 `.page`。它在根 layout（Next.js 的 `app/layout.tsx`，或 Vite 的 `src/main.tsx`）載入一次。
- 沒有最上層的 `src/styles/`，樣式留在 `shared/styles/`，維持三層結構。
- 元件的樣式如果超過全域檔能容納的範圍，放在元件旁邊，或所屬模組的 `styles/`，顏色一律用 `var(--theme-*)`。
- 兩個例外直接從 `theme.ts` 匯入 `palette` 以 inline style 使用，因為它們必須在 stylesheet 之外也能顯示：[`ErrorState`](./components/ErrorState.md)（Next.js 的 `global-error` 沒有任何 provider 與 stylesheet），以及 `UiProvider` 渲染的通知區域。

## 驗證

`tests/e2e/home.spec.ts` 檢查 `--theme-primary` 的值等於 `theme.ts` 的 `palette.primary`，且頁面文字的顏色是 `palette.text`，證明主題確實套用到頁面。

## UI 元件庫

UI 元件庫在建立專案時以 overlay 選定，建立之後才加入的做法見 [rules/ui.md](./rules/ui.md)。加入元件庫的同一次變更中改寫本頁，記下該元件庫的 theme 位置與全域樣式的載入方式。
