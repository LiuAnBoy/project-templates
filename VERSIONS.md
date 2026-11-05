# 套件版本紀錄

最後通過驗證的日期：2026-11-05

本檔由 `node scripts/versions.mjs` 依各範本與 overlay 的依賴清單產生，請勿手動編輯。驗證全部通過後，`scripts/verify.sh` 會更新上方日期。

「使用者」欄列出宣告該版本的範本與 overlay；overlay 的清單已合併其基底範本的依賴，所以基底範本的套件也會列出 overlay。同一套件在不同範本釘在不同版本時，每個版本各佔一列。

共 82 個 Node 套件、15 個 Python 套件；釘在多個版本的套件：Node 0 個、Python 0 個。

## Node（npm）

| 套件 | 版本 | 使用者 |
| --- | --- | --- |
| `@ant-design/cssinjs` | `2.1.2` | next-antd |
| `@ant-design/icons` | `6.3.4` | next-antd, vite-antd |
| `@ant-design/nextjs-registry` | `1.3.0` | next-antd |
| `@emotion/cache` | `11.14.0` | next-mui |
| `@emotion/react` | `11.14.0` | next-mui, vite-mui |
| `@emotion/styled` | `11.14.1` | next-mui, vite-mui |
| `@eslint/js` | `10.0.1` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis, next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui, workspace |
| `@fastify/helmet` | `13.2.0` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `@fastify/rate-limit` | `11.2.2` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis |
| `@heroui/react` | `3.2.7` | next-heroui, vite-heroui |
| `@heroui/styles` | `3.2.7` | next-heroui, vite-heroui |
| `@hookform/resolvers` | `7.0.2` | next-heroui, next-mui, vite-heroui, vite-mui |
| `@internationalized/date` | `3.12.4` | next-heroui, vite-heroui |
| `@mui/icons-material` | `9.5.0` | next-mui, vite-mui |
| `@mui/material` | `9.5.0` | next-mui, vite-mui |
| `@mui/material-nextjs` | `9.5.0` | next-mui |
| `@nest-lab/throttler-storage-redis` | `1.2.0` | nest-mysql-redis, nest-postgres-redis, nest-redis, nest-sqlite-redis |
| `@nestjs/cli` | `11.0.24` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `@nestjs/common` | `11.2.8` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `@nestjs/config` | `4.0.4` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `@nestjs/core` | `11.2.8` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `@nestjs/platform-fastify` | `11.2.8` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `@nestjs/testing` | `11.2.8` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `@nestjs/throttler` | `6.7.1` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `@playwright/test` | `1.64.1` | next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui |
| `@react-aria/ssr` | `3.10.1` | next-heroui, vite-heroui |
| `@react-aria/utils` | `3.34.1` | next-heroui, vite-heroui |
| `@swc/core` | `1.16.21` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `@tailwindcss/postcss` | `4.3.4` | next-heroui, vite-heroui |
| `@tanstack/react-query` | `5.105.3` | next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui |
| `@testing-library/jest-dom` | `7.0.1` | next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui |
| `@testing-library/react` | `16.3.3` | next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui |
| `@types/better-sqlite3` | `9.6.0` | fastify-sqlite, fastify-sqlite-redis, nest-sqlite, nest-sqlite-redis |
| `@types/node` | `24.19.2` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis, next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui, workspace |
| `@types/pg` | `8.23.1` | fastify-postgres, fastify-postgres-redis, nest-postgres, nest-postgres-redis |
| `@types/react` | `19.3.0` | next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui |
| `@types/react-dom` | `19.3.0` | next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui |
| `@vitejs/plugin-react` | `6.2.1` | vite, vite-antd, vite-heroui, vite-mui |
| `antd` | `6.7.0` | next-antd, vite-antd |
| `axios` | `1.21.0` | next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui |
| `better-sqlite3` | `13.0.3` | fastify-sqlite, fastify-sqlite-redis, nest-sqlite, nest-sqlite-redis |
| `clsx` | `2.1.1` | next-heroui, vite-heroui |
| `dayjs` | `1.11.23` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis, next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui |
| `drizzle-kit` | `0.31.11` | fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-sqlite, fastify-sqlite-redis, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-sqlite, nest-sqlite-redis |
| `drizzle-orm` | `0.45.4` | fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-sqlite, fastify-sqlite-redis, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-sqlite, nest-sqlite-redis |
| `eslint` | `10.14.0` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis, next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui, workspace |
| `eslint-config-next` | `16.4.5` | next, next-antd, next-heroui, next-mui |
| `eslint-config-prettier` | `10.1.8` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis, next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui, workspace |
| `eslint-plugin-react-hooks` | `7.1.1` | vite, vite-antd, vite-heroui, vite-mui |
| `eslint-plugin-react-refresh` | `0.5.7` | vite, vite-antd, vite-heroui, vite-mui |
| `fastify` | `5.12.8` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `fastify-type-provider-zod` | `7.0.0` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis |
| `globals` | `17.14.0` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis, next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui, workspace |
| `ioredis` | `6.0.0` | fastify-mysql-redis, fastify-postgres-redis, fastify-redis, fastify-sqlite-redis, nest-mysql-redis, nest-postgres-redis, nest-redis, nest-sqlite-redis |
| `jsdom` | `30.1.3` | next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui |
| `lucide-react` | `1.68.0` | next-heroui, vite-heroui |
| `mysql2` | `3.24.6` | fastify-mysql, fastify-mysql-redis, nest-mysql, nest-mysql-redis |
| `nestjs-pino` | `5.3.1` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `nestjs-zod` | `5.5.0` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `next` | `16.4.5` | next, next-antd, next-heroui, next-mui |
| `notistack` | `3.0.2` | next-mui, vite-mui |
| `pg` | `8.23.1` | fastify-postgres, fastify-postgres-redis, nest-postgres, nest-postgres-redis |
| `pino` | `10.4.0` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `pino-http` | `11.0.0` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `prettier` | `3.9.10` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis, next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui, workspace |
| `react` | `19.3.1` | next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui |
| `react-aria` | `3.53.1` | next-heroui, vite-heroui |
| `react-aria-components` | `1.22.1` | next-heroui, vite-heroui |
| `react-dom` | `19.3.1` | next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui |
| `react-hook-form` | `7.91.0` | next-heroui, next-mui, vite-heroui, vite-mui |
| `react-router` | `8.5.1` | vite, vite-antd, vite-heroui, vite-mui |
| `reflect-metadata` | `0.2.2` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `rxjs` | `7.8.2` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `tailwind-merge` | `3.7.0` | next-heroui, vite-heroui |
| `tailwindcss` | `4.3.4` | next-heroui, vite-heroui |
| `tsx` | `4.23.15` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis |
| `typescript` | `6.0.3` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis, next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui, workspace |
| `typescript-eslint` | `8.72.1` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis, next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui, workspace |
| `unplugin-swc` | `2.0.0` | nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis |
| `vite` | `8.3.5` | vite, vite-antd, vite-heroui, vite-mui |
| `vitest` | `5.1.0` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis, next, next-antd, next-heroui, next-mui, vite, vite-antd, vite-heroui, vite-mui, workspace |
| `zod` | `4.6.7` | fastify, fastify-mysql, fastify-mysql-redis, fastify-postgres, fastify-postgres-redis, fastify-redis, fastify-sqlite, fastify-sqlite-redis, nest, nest-mysql, nest-mysql-redis, nest-postgres, nest-postgres-redis, nest-redis, nest-sqlite, nest-sqlite-redis, next-heroui, next-mui, vite-heroui, vite-mui, workspace |

## Python（PyPI）

| 套件 | 版本 | 使用者 |
| --- | --- | --- |
| `aiosqlite` | `0.22.1` | fastapi-sqlite, fastapi-sqlite-redis |
| `alembic` | `1.20.1` | fastapi-postgres, fastapi-postgres-redis, fastapi-sqlite, fastapi-sqlite-redis |
| `fastapi` | `0.162.0` | fastapi, fastapi-postgres, fastapi-postgres-redis, fastapi-redis, fastapi-sqlite, fastapi-sqlite-redis |
| `greenlet` | `3.5.6` | fastapi-postgres, fastapi-postgres-redis, fastapi-sqlite, fastapi-sqlite-redis |
| `httpx2` | `2.16.0` | fastapi, fastapi-postgres, fastapi-postgres-redis, fastapi-redis, fastapi-sqlite, fastapi-sqlite-redis |
| `limits` | `5.8.0` | fastapi, fastapi-postgres, fastapi-postgres-redis, fastapi-redis, fastapi-sqlite, fastapi-sqlite-redis |
| `loguru` | `0.7.3` | fastapi, fastapi-postgres, fastapi-postgres-redis, fastapi-redis, fastapi-sqlite, fastapi-sqlite-redis |
| `psycopg` | `3.3.8` | fastapi-postgres, fastapi-postgres-redis |
| `pydantic` | `2.14.2` | fastapi, fastapi-postgres, fastapi-postgres-redis, fastapi-redis, fastapi-sqlite, fastapi-sqlite-redis |
| `pydantic-settings` | `2.16.2` | fastapi, fastapi-postgres, fastapi-postgres-redis, fastapi-redis, fastapi-sqlite, fastapi-sqlite-redis |
| `pytest` | `9.2.0` | fastapi, fastapi-postgres, fastapi-postgres-redis, fastapi-redis, fastapi-sqlite, fastapi-sqlite-redis |
| `redis` | `8.1.0` | fastapi-postgres-redis, fastapi-redis, fastapi-sqlite-redis |
| `ruff` | `0.17.3` | fastapi, fastapi-postgres, fastapi-postgres-redis, fastapi-redis, fastapi-sqlite, fastapi-sqlite-redis |
| `sqlalchemy` | `2.1.8` | fastapi-postgres, fastapi-postgres-redis, fastapi-sqlite, fastapi-sqlite-redis |
| `uvicorn` | `0.54.0` | fastapi, fastapi-postgres, fastapi-postgres-redis, fastapi-redis, fastapi-sqlite, fastapi-sqlite-redis |
