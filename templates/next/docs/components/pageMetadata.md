# pageMetadata

`src/shared/seo/metadata.ts`：產生公開頁面需要的 metadata（title、description、canonical、Open Graph、Twitter），從 `src/shared/seo/site.ts` 的 `SITE` 常數取預設值。

## 用法

```tsx
// app/about/page.tsx
import { pageMetadata } from '@/shared/seo/metadata';

export const metadata = pageMetadata({
  title: 'About',
  description: 'Who we are.',
  path: '/about',
});
```

`app/page.tsx` 是現成的例子：`pageMetadata({ path: '/' })`。

## 參數

| 名稱          | 說明                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| `title`       | 頁面標題；根 layout 的 title template 會加上網站名稱。首頁省略                |
| `description` | 預設是 `SITE.description`                                                     |
| `path`        | 網站內的路徑，當作 canonical 連結與 Open Graph 的 `url`                       |
| `type`        | Open Graph 類型，`website`（預設）或 `article`                                |
| `image`       | 分享圖片的網址；有給時 Twitter 卡片是 `summary_large_image`，否則是 `summary` |

## SITE

`src/shared/seo/site.ts` 的 `SITE` 是網站描述自己的唯一地方：`title`、`description`，以及 `url`（公開網址的 origin）。根 layout 用它設定 `metadataBase` 與 title template，`pageMetadata` 用它補預設值。建立專案時把 `url` 改成正式網址，canonical 與 Open Graph 連結才會指向正確的位置。

## 行為

- 頁面層級的 `openGraph` 或 `twitter` 會整個取代 layout 的物件，所以 `pageMetadata` 把 layout 會設的欄位全部重複帶上。
- 測試在 `src/shared/seo/tests/metadata.test.ts`。
