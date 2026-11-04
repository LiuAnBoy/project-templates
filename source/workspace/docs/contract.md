# contract 套件

`contract/` 是前後端共用的 wire 契約：API 的請求與回應 schema（zod），以及從 schema 推導出的型別。套件名稱是 `@app/contract`。

## 範圍

放進來的只有 schema 與型別。業務計算、框架程式碼、需要資料庫的東西都不放。契約只有一份：伺服器用它驗證，前端用它解析，兩邊都不另外宣告自己的版本。

目前只有 hello 路由的 schema，在 `contract/src/hello.ts`：`helloDataSchema`（`data` 的內容）與 `helloResponseSchema`（整個 envelope）。

## 如何使用

套件建置成 `dist/`（ESM 與型別宣告），透過 `exports` 對外匯出，所以前後端都是匯入編譯後的 JavaScript，不需要 `transpilePackages`，也不需要執行時期的 TypeScript。

```ts
import { helloResponseSchema } from '@app/contract';

const body = helloResponseSchema.parse(await response.json());
```

使用端要在自己的 `package.json` 把 `"@app/contract": "workspace:*"` 列入 `dependencies`。

## 建置

`pnpm install`（在根目錄）會透過根目錄的 `prepare` 指令建置 `contract`。修改 schema 之後，用下面的指令重新建置，前後端才會看到新版本：

```sh
pnpm --filter @app/contract run build
```

## 新增一個 schema

1. 在 `contract/src/` 新增 `<feature>.ts`，以 zod 宣告 schema，並匯出從它推導的型別。
2. 在 `contract/src/index.ts` 加一行 `export * from './<feature>.js';`。
3. 在 `contract/src/tests/` 新增測試，驗證合法的內容通過、不合法的被拒絕。
4. 重新建置（見上），再讓伺服器與前端匯入使用。

## 命名

- wire 上的 key 一律是 snake_case；程式內部維持 camelCase，在邊界逐個欄位對應。
- 成功的回應用 envelope：`{ "success": true, "payload": { "data": ... } }`；列表另在 `data` 旁帶 `page`、`page_size`、`total_count`。
