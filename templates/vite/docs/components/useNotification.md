# useNotification

`src/shared/hooks/useNotification.ts`：全專案唯一的使用者通知入口。此範本沒有 UI 元件庫，通知由 `UiProvider` 自己渲染：畫面右上角一塊 `aria-live` 區域，每則訊息顯示約 4 秒後自動移除，顏色取自 `theme.ts` 的 `palette`。

## 用法

```tsx
import { useNotification } from '@/shared/hooks/useNotification';

function SaveButton() {
  const notify = useNotification();

  return (
    <button
      onClick={() =>
        save(undefined, {
          onSuccess: () => notify.success('已儲存'),
          onError: (error) => notify.error(getErrorMessage(error)),
        })
      }
    >
      儲存
    </button>
  );
}
```

## 行為

- 回傳物件只有四個方法：`success`、`error`、`warning`、`info`，每個收一個字串。
- 回傳的物件在 render 之間是同一個，可以放進 effect 的依賴陣列。
- 必須在 `UiProvider` 之內使用，否則丟出錯誤。`AppProviders` 已經掛好。
- 在事件處理函式與 mutation 的 callback 裡呼叫，不要在 query hook 裡呼叫。
- 需要使用者稍後處理的訊息用對話框，不是通知，因為通知會自己消失。
- 選定 UI 元件庫的 overlay 會用該元件庫的版本取代 `UiProvider.tsx` 與 `useNotification.ts`，介面不變。
- 測試在 `src/shared/hooks/tests/useNotification.test.tsx`：驗證四個方法、四種通知都會出現在畫面上，並在時間到後移除。
