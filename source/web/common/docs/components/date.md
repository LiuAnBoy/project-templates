# date

`src/shared/utils/date.ts`：日期處理的唯一入口，用法和 `http` 一樣，匯入一個物件 `date`。`dayjs`、語系、外掛與格式字串都只存在這個檔案，專案其他地方不得直接 `import dayjs`，也不另外包裝 dayjs 的其餘功能；需要新的日期功能時加在這個物件上。

## 用法

```ts
import { date } from '@/shared/utils/date';

date.format(new Date()); // 2026-11-04
date.formatDateTime('2026-11-04T09:30:00'); // 2026-11-04 09:30
date.fromNow('2026-11-01T09:30:00'); // 3 天前
date.parse('not a date'); // null
```

## 行為

- `date.format(value)` 輸出 `YYYY-MM-DD`，`date.formatDateTime(value)` 輸出 `YYYY-MM-DD HH:mm`。
- `date.fromNow(value, now?)` 輸出繁體中文的相對時間，`now` 預設為現在，測試時可傳入固定時間。
- `date.parse(value)` 回傳 dayjs 物件，值無法解析時回傳 `null`，不丟例外。
- 參數是 `Date`、ISO 字串或毫秒時間戳記。值無法解析時三個格式化函式都回傳空字串，不會出現 "Invalid Date"。
- 檔案載入時把 dayjs 語系設為 `zh-tw` 並啟用 `relativeTime` 外掛；物件沒有狀態。
- 測試在 `src/shared/utils/tests/date.test.ts`。
