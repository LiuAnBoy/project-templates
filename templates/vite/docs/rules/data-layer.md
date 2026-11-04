# Data layer

Server state goes through React Query, over module api functions, over one HTTP wrapper. This page fixes who may call what.

## The HTTP wrapper

`src/shared/http/http.ts` is the only file that imports `axios`. Everything else imports `http` from it and gets unwrapped data back. Paths are relative to `/api/v1`.

| Call                                                  | Use                                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `http.get<T>(path, query?, options?)`                 | One object. Returns `payload.data`.                                                                      |
| `http.list<T>(path, query?, options?)`                | One page. Returns `{ items, page, pageSize, totalCount }` and throws when the paging fields are missing. |
| `http.getAllPages<T>(path, query?, options?)`         | A whole list, 100 rows per page, bounded at 200 pages; throws instead of returning a partial list.       |
| `http.getText(path, query?, options?)`                | A route that answers plain text.                                                                         |
| `http.post<T>(path, body?, options?)`, `put`, `patch` | A JSON object or `FormData`.                                                                             |
| `http.delete<T>(path, options?)`                      | Delete a resource.                                                                                       |

- `query` drops `undefined` and `null` values before sending. `options` is `{ signal?, timeoutMs?, headers? }`: pass an `AbortSignal` to cancel, `timeoutMs` to override the 15 s default for one call, and `headers` to add request headers for one call (an `Authorization` header set there wins over the token provider).
- Never use raw `fetch`, and never import `axios` outside the wrapper. Why: the token, the error shape and the 401 reaction live in one place.
- The API answers one envelope. Success is `{"success": true, "payload": {"data": ...}}`; a list adds `page`, `page_size` and `total_count` beside `data`; a write may answer `{"success": true}` alone, and its call resolves to `undefined`. Failure is `{"success": false, "payload": {"message": "..."}}` with the HTTP status carrying the kind. The wrapper unwraps the envelope, so api functions never see it.

### Errors

- A non-2xx answer, or a 2xx body that is not the envelope, throws `HttpError` with `status`, `message` (the server's `payload.message`), `requestId` (the `x-request-id` header), `retryAfter` (seconds, from `Retry-After`) and the raw `body`.
- No answer throws `NetworkError`. No answer within the timeout throws `TimeoutError`, a subclass of `NetworkError`, so one `instanceof NetworkError` covers both and `instanceof TimeoutError` tells them apart. Their `cause` is a plain copy holding the message, code, method and URL, never the request or its headers, so a logger that walks `cause` cannot print the bearer token.
- A token provider that rejects throws `AuthTokenError` with the provider's failure as `cause`; nothing is sent, and it is not a network failure.
- A cancelled request (aborted `signal`) rejects with axios's `CanceledError`, untouched. Check it with `isCancel` from axios inside the code that cancelled; do not report it as a failure.
- `getErrorMessage(error, fallback?)` returns the text to show: the server's message for an `HttpError`, a fixed text for a transport failure, the fallback otherwise. The UI shows it as is; the server owns user-facing wording.
- An error nobody handles reaches the framework's error page (`architecture.md`), which shows the fixed text of `ErrorState` and logs the error with `console.error`. Never show an error's message, stack or digest there. An unknown address shows the not-found page, which is `ErrorState` with `kind="not-found"`.

### Token and 401

`shared/` never imports `modules/`, so a feature registers its behaviour at startup through two setters on the wrapper:

- `setAuthTokenProvider(provider)`: the provider returns the bearer token, or a promise of it while a session loads. Each request sends `Authorization: Bearer <token>` when the provider answers one, unless the call already carries its own `Authorization` header.
- `setUnauthorizedHandler(handler)`: runs when the API answers 401, before the call rejects. Use it to send the user to sign-in. If the handler throws, the error is logged and the call still rejects with the `HttpError`.

Both accept `null` to clear. The provider is process-wide, so it belongs to the browser, where one process is one user. Code that runs on a server never registers one: a single provider would serve every user's request from the same process and could send one user's token on another's call. Server code passes the current user's credential on each call through `options.headers`. This template ships no authentication, so nothing registers them yet; see "Authentication is not included" in `architecture.md`.

### Base URL

The base comes from `src/shared/http/base-url.ts` and is resolved on every request. In the browser it is `/api/v1`, same-origin; how that path reaches the API, and any other case where the base differs, is in `architecture.md`. If the API lives on another origin, read its address from an environment variable and keep the real host out of the code.

The instance sets `allowAbsoluteUrls: false`: a path that is absolute or protocol-relative is appended to the base, never followed, so the bearer token cannot be sent to another host. Pass paths only, never full URLs.

## Module api functions

Pure functions in `modules/<feature>/api/`, named `getXxxApi`, `createXxxApi`, `updateXxxApi`, `deleteXxxApi`. They build the URL, call `http.*` and return typed data; no React, no side effects.

```ts
export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (q: ProductListQuery) => [...productKeys.lists(), q] as const,
  detail: (id: string) => [...productKeys.all, 'detail', id] as const,
};

export const getProductApi = (id: string) =>
  http.get<Product>(`/products/${id}`);
export const updateProductApi = (id: string, input: UpdateProductInput) =>
  http.put<void>(`/products/${id}`, input);
```

Why a key factory: every query and every invalidation names its key through one function, so a typo cannot create a second cache entry.

## Query and mutation hooks

In `modules/<feature>/hooks/`, named `useXxxQuery` and `useXxxMutation`.

```ts
export const useProductQuery = (id: string) =>
  useQuery({
    queryKey: productKeys.detail(id),
    queryFn: ({ signal }) =>
      http.get<Product>(`/products/${id}`, undefined, { signal }),
    enabled: Boolean(id),
  });
```

- Hooks do no UI side effects: no notification, no navigation, no modal. The component passes `onSuccess` and `onError` to `mutate` and reacts there. Why: the same mutation is reused with different feedback.
- A mutation invalidates the keys it changes (detail, lists, anything derived). Prefer invalidation over patching the cache by hand.
- Pass `enabled` for queries that depend on an id. A query whose response carries a version that the next save must echo sets `staleTime: 0`.
- One `QueryClient` per browser and one per request on the server, created in `shared/providers/QueryProvider.tsx`. Defaults: `staleTime` 60 s, `refetchOnWindowFocus: false`, queries retry once, mutations never retry.

## State that is not server state

Everything that came from the server and can be refetched is a query, never a copy in a store. Two copies of server data drift apart. UI state (an open dialog, a form draft) stays in the component or a context. If sign-in is added later, only the token or session handle and the current user belong in a store.

## Forms

Where the `@app/contract` package exists (a monorepo with a Node server), validate with the same zod schema the backend uses. Where it does not (a standalone template, or a monorepo with a FastAPI server), keep one schema per form beside the component. Submit through a mutation hook and show the server's `message` through `getErrorMessage`.

## Dates

`src/shared/utils/date.ts` is the only file that imports `dayjs`. Everything else imports the `date` object from it (`date.format`, `date.formatDateTime`, `date.fromNow`, `date.parse`) and a new date need becomes a new method there. Never import `dayjs` anywhere else, and never use `moment`, `date-fns` or hand-written `toLocaleString` formatting for values shown to the user. Why: the locale, the formats and the plugin set live in one place, and a library swap touches one file.

## Wire format

Every key on the wire is snake_case, in requests and in responses, and the database is snake_case as well; camelCase never appears in the API or the database. Api functions and their types keep items in the wire shape (`created_at`, not `createdAt`). The only camelCased fields are the paging fields that `http.list` returns (`items`, `page`, `pageSize`, `totalCount`). Why: one spelling end to end means no mapping layer to keep in step with the server.
