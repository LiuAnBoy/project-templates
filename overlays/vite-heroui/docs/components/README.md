# 共用元件索引

新增頁面或功能前，先在這裡找現成的共用元件與 hook，不要重造。新增共用元件時，在同一次變更中補上文件頁，並把它加進下表。

## 清單

| 名稱              | 位置                              | 用途                                        | 文件                                       |
| ----------------- | --------------------------------- | ------------------------------------------- | ------------------------------------------ |
| `http`            | `shared/http/http.ts`             | 唯一的 API 入口，回傳解開 envelope 後的資料 | [http-client.md](./http-client.md)         |
| `useMediaQuery`   | `shared/hooks/useMediaQuery.ts`   | 追蹤 CSS media query 是否符合               | [useMediaQuery.md](./useMediaQuery.md)     |
| `date`            | `shared/utils/date.ts`            | 日期處理物件，唯一匯入 dayjs 的檔案         | [date.md](./date.md)                       |
| `useNotification` | `shared/hooks/useNotification.ts` | 通知，底層是 HeroUI 的 `toast`              | [useNotification.md](./useNotification.md) |
| `cn`              | `shared/utils/cn.ts`              | 合併 class 名稱與衝突的 Tailwind class      | [cn.md](./cn.md)                           |

## 使用原則

- 打 API 一律走 `http`，不直接用 `fetch` 或 `axios`。
- 使用者回饋一律走 `useNotification`，不直接呼叫 HeroUI 的 `toast`。
- 日期一律走 `date`，不直接匯入 `dayjs`。
- 共用元件只收 props 與 callback，不呼叫模組的 hook。
- UI 元件直接用 HeroUI，樣式用 Tailwind class 與 HeroUI 的變數，說明見 [../styles.md](../styles.md)；組 class 用 `cn`。
