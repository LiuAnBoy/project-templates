# ErrorState

`src/shared/components/ErrorState.tsx`：整頁的失敗畫面，一個標題、一句說明、選用的重試按鈕，以及回首頁的連結。「發生錯誤」與「找不到頁面」兩種畫面共用它，文字都在這個檔案裡。

## 用法

```tsx
import { ErrorState } from '@/shared/components/ErrorState';

<ErrorState kind="error" onRetry={reset} />
<ErrorState kind="not-found" />
```

## Props

| 名稱      | 型別                     | 說明                                       |
| --------- | ------------------------ | ------------------------------------------ |
| `kind`    | `'error' \| 'not-found'` | 失敗的種類，決定標題與說明（英文，同首頁） |
| `onRetry` | `() => void`（選填）     | 有給才顯示「Try again」按鈕，按下時呼叫    |

## 行為

- 只顯示固定文字，不顯示錯誤的訊息、堆疊或 digest；錯誤本身由呼叫端記錄（`console.error`）。
- 樣式是 inline style，直接讀 `shared/styles/theme.ts` 的 `palette`、`radius`、`fontFamily`，不依賴 stylesheet 與 provider，所以在 Next.js 的 `global-error`（取代根 layout，沒有任何 provider）也能正確顯示。
- 「Back to home」是一般的 `<a href="/">`，會重新載入文件，因此在 router 壞掉時仍能離開。
- 使用它的頁面：
  - Next.js：`app/error.tsx`、`app/global-error.tsx`、`app/not-found.tsx`。
  - Vite：`app/ErrorBoundary.tsx`、`app/RouteError.tsx`，以及 `app/router.tsx` 裡最後一條 `*` 路由。
- 測試在 `src/shared/components/tests/ErrorState.test.tsx`；各框架頁面的測試在 `src/app/tests/error-pages.test.tsx`，Playwright 的 `tests/e2e/not-found.spec.ts` 驗證未知網址顯示 not-found。
