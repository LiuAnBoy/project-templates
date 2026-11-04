# useNotification

`src/shared/hooks/useNotification.ts`：全專案唯一的使用者通知入口，底層是 notistack 的 `enqueueSnackbar`，訊息顯示在畫面右上角。

## 用法

```tsx
import Button from '@mui/material/Button';

import { useNotification } from '@/shared/hooks/useNotification';

function SaveButton() {
  const notify = useNotification();

  return (
    <Button
      onClick={() =>
        save(undefined, {
          onSuccess: () => notify.success('已儲存'),
          onError: (error) => notify.error(getErrorMessage(error)),
        })
      }
    >
      儲存
    </Button>
  );
}
```

## 行為

- 回傳物件只有四個方法：`success`、`error`、`warning`、`info`，每個收一個字串，對應 notistack 的同名 variant。
- 回傳的物件經過 `useMemo`，在 render 之間是同一個，可以放進 effect 的依賴陣列。
- 必須在 `UiProvider` 之內使用，因為 `SnackbarProvider` 在那裡掛載。
- 在事件處理函式與 mutation 的 callback 裡呼叫，不要在 query hook 裡呼叫。
- 需要使用者稍後處理的訊息用對話框（MUI 的 `Dialog`），不是通知，因為通知會自己消失。
- 同時最多顯示 3 則，4 秒後自動消失，這兩個數字在 `UiProvider.tsx`。
- 測試在 `src/shared/hooks/tests/useNotification.test.tsx`：驗證四個方法、回傳物件穩定、四種通知都會出現在畫面上。
