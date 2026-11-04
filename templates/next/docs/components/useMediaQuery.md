# useMediaQuery

`src/shared/hooks/useMediaQuery.ts`：追蹤 CSS media query 是否符合。

## 用法

```tsx
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';

function Layout() {
  const isWide = useMediaQuery('(min-width: 768px)');
  return isWide ? <Sidebar /> : null;
}
```

## 行為

- 參數是 media query 字串，回傳目前是否符合；視窗變化時會重新渲染。
- 伺服器端與 hydration 期間一律回傳 `false`，之後才跟隨瀏覽器，所以依賴它的版面要能接受第一次是 `false`。
- 在 Next.js 中，使用它的檔案必須是 client component（檔頭 `'use client'`）。
