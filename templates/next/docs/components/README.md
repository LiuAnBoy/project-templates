# 共用元件索引

新增頁面或功能前，先在這裡找現成的共用元件與 hook，不要重造。新增共用元件時，在同一次變更中補上文件頁，並把它加進下表。

## 清單

| 名稱            | 位置                            | 用途                                        | 文件                                   |
| --------------- | ------------------------------- | ------------------------------------------- | -------------------------------------- |
| `http`          | `shared/http/http.ts`           | 唯一的 API 入口，回傳解開 envelope 後的資料 | [http-client.md](./http-client.md)     |
| `useMediaQuery` | `shared/hooks/useMediaQuery.ts` | 追蹤 CSS media query 是否符合               | [useMediaQuery.md](./useMediaQuery.md) |

## 使用原則

- 打 API 一律走 `http`，不直接用 `fetch` 或 `axios`。
- 共用元件只收 props 與 callback，不呼叫模組的 hook。
- 此範本沒有 UI 元件庫，也就沒有通知 hook；加入元件庫時依 [../rules/ui.md](../rules/ui.md) 補上。
