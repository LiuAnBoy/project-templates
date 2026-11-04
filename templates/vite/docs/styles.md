# 樣式

此範本沒有 UI 元件庫，也沒有 Tailwind 之類的樣式框架。

## 目前的樣式

- `src/shared/styles/global.css` 是唯一的樣式檔，內容只有 `:root` 的字型與 `color-scheme`、`body` 的 margin，以及首頁置中用的 `.page`。
- 它在根 layout（Next.js 的 `app/layout.tsx`，或 Vite 的 `src/main.tsx`）載入一次。
- 元件的樣式如果超過全域檔能容納的範圍，放在元件旁邊，或所屬模組的 `styles/`。

## 加入 UI 元件庫之後

要引入元件庫時，依 [rules/ui.md](./rules/ui.md) 的步驟做，並在同一次變更中改寫本頁，記下該元件庫的 theme 位置與全域樣式的載入方式。
