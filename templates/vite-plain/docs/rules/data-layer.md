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

- `query` drops `undefined` and `null` values before sending. `options` is `{ signal?, timeoutMs? }`: pass an `AbortSignal` to cancel, and `timeoutMs` to override the 15 s default for one call.
- Never use raw `fetch`, and never import `axios` outside the wrapper. Why: the token, the error shape and the 401 reaction live in one place.
- The API answers one envelope. Success is `{"success": true, "payload": {"data": ...}}`; a list adds `page`, `page_size` and `total_count` beside `data`; a write may answer `{"success": true}` alone, and its call resolves to `undefined`. Failure is `{"success": false, "payload": {"message": "..."}}` with the HTTP status carrying the kind. The wrapper unwraps the envelope, so api functions never see it.

### Errors

- A non-2xx answer, or a 2xx body that is not the envelope, throws `HttpError` with `status`, `message` (the server's `payload.message`), `requestId` (the `x-request-id` header), `retryAfter` (seconds, from `Retry-After`) and the raw `body`.
- No answer throws `NetworkError`. No answer within the timeout throws `TimeoutError`, a subclass of `NetworkError`, so one `instanceof NetworkError` covers both and `instanceof TimeoutError` tells them apart.
- A cancelled request (aborted `signal`) rejects with axios's `CanceledError`, untouched. Check it with `isCancel` from axios inside the code that cancelled; do not report it as a failure.
- `getErrorMessage(error, fallback?)` returns the text to show: the server's message for an `HttpError`, a fixed text for a transport failure, the fallback otherwise. The UI shows it as is; the server owns user-facing wording.

### Token and 401

`shared/` never imports `modules/`, so a feature registers its behaviour at startup through two setters on the wrapper:

- `setAuthTokenProvider(provider)`: the provider returns the bearer token, or a promise of it while a session loads. Each request sends `Authorization: Bearer <token>` when the provider answers one.
- `setUnauthorizedHandler(handler)`: runs when the API answers 401, before the call rejects. Use it to send the user to sign-in.

Both accept `null` to clear. This template ships no authentication, so nothing registers them yet; see "Adding authentication" in `architecture.md`.

### Base URL

The base is `/api/v1`, same-origin. In development the framework forwards it to port 8000 (see `architecture.md`); in production a reverse proxy does the same. If the API lives on another origin, read its address from an environment variable and keep the real host out of the code.

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

Validate with the same zod schema the backend uses when the `@app/contract` package is present (it is, in a monorepo); otherwise keep one schema per form beside the component. Submit through a mutation hook and show the server's `message` through `getErrorMessage`.
