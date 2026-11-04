# 前端文件索引

這個專案由前端範本建立：Vite 單頁應用（React Router 8），目前只有一個首頁，顯示 `Welcome`。本頁是 `docs/` 的入口，記錄目前實際存在的內容。

## 技術棧

| 項目       | 內容                                        |
| ---------- | ------------------------------------------- |
| 框架       | Vite 8、React Router 8、React 19            |
| 伺服器狀態 | TanStack React Query 5                      |
| HTTP       | axios，僅在 `src/shared/http/http.ts` 使用  |
| 語言與檢查 | TypeScript 6（strict）、ESLint 10、Prettier |
| 測試       | Vitest + Testing Library、Playwright        |
| 套件管理   | pnpm                                        |
| UI 元件庫  | 見 [rules/ui.md](./rules/ui.md)             |

## 指令

| 指令                                | 用途                                                        |
| ----------------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                          | 啟動開發伺服器（port 5173），`/api` 轉發到 port 8000 的 API |
| `pnpm lint`                         | ESLint                                                      |
| `pnpm format` / `pnpm format:check` | Prettier 修正／檢查                                         |
| `pnpm typecheck`                    | `tsc --noEmit`                                              |
| `pnpm test`                         | Vitest 單次執行                                             |
| `pnpm test:e2e`                     | Playwright，會自己在 port 5273 啟動開發伺服器               |
| `pnpm build` / `pnpm start`         | 建置與預覽建置結果（port 4173），供發佈流程使用             |

## 環境變數

複製 `.env.example` 為 `.env`。目前只有 `API_HOST`（預設 `http://localhost:8000`），是 `vite.config.ts` 開發與預覽時轉發 `/api` 的目標；正式環境由反向代理轉發。`.env` 已被 git 忽略。

## 目錄

```
src/
  main.tsx        進入點
  app/            App.tsx（providers 與 router）、router.tsx
  modules/home/   首頁模組（components、tests、routes.tsx、index.ts）
  shared/
    http/         HTTP 封裝、錯誤型別與測試
    hooks/        useMediaQuery
    providers/    AppProviders、QueryProvider
    styles/       global.css
  test/setup.ts   Vitest 設定
tests/e2e/        Playwright 規格
```

完整的目標結構與分層規則見 [rules/architecture.md](./rules/architecture.md)。

## 認證

此範本沒有登入、session 或路由守衛，所有路由都是公開的。要加入認證，照 [rules/architecture.md](./rules/architecture.md)〈Authentication is not included〉的步驟做。

## 文件索引

| 文件                                             | 內容                                |
| ------------------------------------------------ | ----------------------------------- |
| [styles.md](./styles.md)                         | 樣式與全域 CSS                      |
| [components/README.md](./components/README.md)   | 共用元件與 hook 索引                |
| [rules/architecture.md](./rules/architecture.md) | 結構、分層、Vite 與路由規則（英文） |
| [rules/data-layer.md](./rules/data-layer.md)     | HTTP 封裝、React Query 規則（英文） |
| [rules/testing.md](./rules/testing.md)           | 測試與檢查規則（英文）              |
| [rules/ui.md](./rules/ui.md)                     | UI 與通知規則（英文）               |

## 文件語言

`AGENTS.md` 與 `docs/rules/` 用英文，給 AI agent 讀；其餘 `docs/` 頁面用繁體中文，記錄實際存在的內容。新增功能時，把成果記在繁體中文文件裡。
