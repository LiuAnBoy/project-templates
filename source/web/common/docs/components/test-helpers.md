# 測試輔助

`src/test/` 放元件測試共用的輔助，與 `setup.ts` 同一層。

## renderWithProviders

`src/test/renderWithProviders.tsx`：把元素包進真正的 `AppProviders`（含 `UiProvider`、`QueryProvider`）後 render，因此不管專案用哪個 UI 元件庫都能用。

```tsx
import { renderWithProviders } from '@/test/renderWithProviders';

const { queryClient } = renderWithProviders(<SaveButton />);
```

- 內層另包一個全新的 `QueryClient`（`retry: false`、`gcTime: 0`），測試之間不共用快取；回傳值是 Testing Library 的結果加上這個 `queryClient`。
- 選項是 Testing Library 的 render 選項（不含 `wrapper`）。Vite 版另有 `route`，決定記憶體 router 的起始位置（預設 `/`），因為 Vite 版的元件可能用到 router。
- 元件庫的 provider 可能讀 `window.matchMedia`，而 jsdom 沒有，這時先呼叫下面的 `installMatchMedia()`。

## installMatchMedia

`src/test/matchMedia.ts`：安裝可控制的 `window.matchMedia`。

```tsx
const media = installMatchMedia(['(min-width: 768px)']);
media.set('(min-width: 768px)', false);
media.listenerCount('(min-width: 768px)');
afterEach(restoreMatchMedia);
```

- 參數是一開始符合的 query；沒列出的 query 一律不符合。
- `set(query, matches)` 改變某個 query 並通知它的 listener；`listenerCount(query)` 回傳該 query 目前的 listener 數，用來確認元件卸載後有取消訂閱。
- `restoreMatchMedia()` 還原環境原本的 `matchMedia`（jsdom 沒有，就移除），在 `afterEach` 呼叫。
- 範例：`src/shared/hooks/tests/useMediaQuery.test.tsx`、`src/test/tests/renderWithProviders.test.tsx`。
