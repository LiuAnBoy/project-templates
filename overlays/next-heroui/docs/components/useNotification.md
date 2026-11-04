# useNotification

`src/shared/hooks/useNotification.ts`：全專案唯一的使用者通知入口，底層是 HeroUI 的 `toast`，訊息顯示在畫面右上角。

## 用法

```tsx
import { Button } from '@heroui/react';

import { useNotification } from '@/shared/hooks/useNotification';

function SaveButton() {
  const notify = useNotification();

  return (
    <Button
      onPress={() =>
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

- 回傳物件只有四個方法：`success`、`error`、`warning`、`info`，每個收一個字串。
- `error` 對應 HeroUI 的 `toast.danger`，因為 `danger` 是 HeroUI 對錯誤樣式的名稱；其餘三個對應同名的 `toast.success`、`toast.warning`、`toast.info`。
- `toast` 是一般函式，回傳的物件每次呼叫都是同一個，可以放進 effect 的依賴陣列，也不需要 provider 才能呼叫。顯示 toast 的容器 `Toast.Provider` 由 `UiProvider` 掛載一次；容器掛載前送出的 toast 會在掛載後顯示。
- 在事件處理函式與 mutation 的 callback 裡呼叫，不要在 query hook 裡呼叫。
- 需要使用者稍後處理的訊息用對話框（HeroUI 的 `Modal`），不是通知，因為通知會自己消失。
- 位置、同時顯示數量與停留時間在 `src/shared/styles/theme.ts`。
- 測試在 `src/shared/hooks/tests/useNotification.test.ts`：驗證四個方法、回傳物件穩定，以及四個方法分別呼叫 `toast.success`、`toast.danger`、`toast.warning`、`toast.info`。
