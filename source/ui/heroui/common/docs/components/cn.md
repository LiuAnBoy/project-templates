# cn

`src/shared/utils/cn.ts`：組 class 字串的唯一方式，先用 `clsx` 處理條件，再用 `tailwind-merge` 合併衝突的 Tailwind class，後面的勝出。

## 用法

```tsx
import { cn } from '@/shared/utils/cn';

function Badge({ active }: { active: boolean }) {
  return (
    <span className={cn('px-2 text-sm', active && 'font-medium', 'px-3')} />
  );
}
// active 時是 "text-sm font-medium px-3"：後面的 px-3 取代 px-2
```

## 行為

- 參數可以是字串、陣列，或 `{ 名稱: 條件 }` 物件，型別是 `clsx` 的 `ClassValue`。
- 不要用字串相加來組 class，條件與覆蓋都交給 `cn`。
