# 共用元件索引

新增頁面或功能前，先在這裡找現成的共用元件與 hook，不要重造。新增共用元件時，在同一次變更中補上文件頁，並把它加進下表。

## 清單

| 名稱                                       | 位置                               | 用途                                        | 文件                                       |
| ------------------------------------------ | ---------------------------------- | ------------------------------------------- | ------------------------------------------ |
| `http`                                     | `shared/http/http.ts`              | 唯一的 API 入口，回傳解開 envelope 後的資料 | [http-client.md](./http-client.md)         |
| `useMediaQuery`                            | `shared/hooks/useMediaQuery.ts`    | 追蹤 CSS media query 是否符合               | [useMediaQuery.md](./useMediaQuery.md)     |
| `date`                                     | `shared/utils/date.ts`             | 日期處理物件，唯一匯入 dayjs 的檔案         | [date.md](./date.md)                       |
| `useNotification`                          | `shared/hooks/useNotification.ts`  | 通知，由 `UiProvider` 渲染                  | [useNotification.md](./useNotification.md) |
| `ErrorState`                               | `shared/components/ErrorState.tsx` | 整頁的錯誤與找不到頁面畫面                  | [ErrorState.md](./ErrorState.md)           |
| `renderWithProviders`、`installMatchMedia` | `test/`                            | 元件測試用的 provider 包裝與 `matchMedia`   | [test-helpers.md](./test-helpers.md)       |

## 使用原則

- 打 API 一律走 `http`，不直接用 `fetch` 或 `axios`。
- 使用者回饋一律走 `useNotification`，通知的呈現留在 `UiProvider`。
- 失敗畫面一律走 `ErrorState`，不顯示錯誤的訊息或堆疊。
- 共用元件只收 props 與 callback，不呼叫模組的 hook。
- 此範本沒有 UI 元件庫；元件庫在建立專案時以 overlay 選定，細節見 [../rules/ui.md](../rules/ui.md)。
- 日期一律走 `date`，不直接匯入 `dayjs`。
