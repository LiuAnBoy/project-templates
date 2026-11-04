# API envelope, errors and auth

One wire shape for every route. Clients write one unwrapper and one error handler for every backend, so the shape never varies by endpoint.

## The envelope

Success, one object or array:

```json
{ "success": true, "payload": { "data": { "id": "7" } } }
```

List, always paged, paging fields beside `data` and in snake_case:

```json
{
  "success": true,
  "payload": { "data": [], "page": 1, "page_size": 20, "total_count": 0 }
}
```

Failure:

```json
{ "success": false, "payload": { "message": "not found" } }
```

Rules:

- The keys are exactly `success`, `payload`, `data`, `page`, `page_size`, `total_count`, `message`. Do not add `code`, `error`, `details` or `meta`.
- A handler that returns nothing (a delete) answers `data: {}`, so `data` is always present on a success.
- Every list endpoint is paged. `page` starts at 1; clamp `page_size` to `MAX_PAGE_SIZE` (`src/core/paging.py`) and report the effective value, not the requested one.
- Build the envelope in one place only (the `success()` and `listing()` helpers in `src/core/envelope.py`, and the exception handlers in `src/core/handlers.py`), never by hand in a handler. A shape built in many places drifts.
- The envelope has three explicit exceptions, and no others: file downloads and streams, which are not JSON; health and readiness probes, which answer a bare `{ "status": "ok" }` (readiness answers 503 with `{ "status": "unavailable" }` when a dependency is down) so a load balancer can read them; and an endpoint whose machine caller expects a bare status (an incoming webhook that must answer 401 with an empty body). Note the exception in the route's doc comment.

## Failures

- The HTTP status carries the kind of failure. The body carries only a message. A client branches on status, and a public error code becomes a contract that is hard to retire.
- Services throw one app error type holding an internal code. The code is for logs and tests and is never serialised.
- One table maps each internal code to `(status, message)`; it lives in `src/core/errors.py` as `FAILURES: dict[str, tuple[int, str]]`, raised through `ApiError(code, name=None)`. The message is fixed text, or a template whose only variable is a name from a closed set (a parameter or field the server defines), sanitised to `[A-Za-z0-9_.-]{1,40}` and shown as `?` otherwise.
- Every error a client sees comes from the table, whoever raised it. An error raised by a framework or a guard (a Starlette `HTTPException`, a pydantic `RequestValidationError`) is answered with the message of the table entry for its status, never the framework's own text; a status with no entry answers the entry for 400 (4xx) or `internal` (5xx).
- Pick distinct statuses where the meaning allows, because the client cannot tell two failures with one status apart. Give no two table entries the same message (a test guards this).
- Status map: 400 malformed request or failed validation; 401 no or invalid credential; 403 refused; 404 nothing there (also for another user's resource, so ids cannot be probed); 409 state conflict; 422 a well-formed request the rules refuse; 429 rate limit; 503 a dependency is unavailable; 500 anything unexpected.
- A validation failure answers 400 with a fixed message. The pydantic issue list goes to the debug log, not to the client.
- An unreachable database or Redis answers 503, not 500: the client should retry a 503 and report a 500. Wrap dependency calls in `bounded()` (`src/core/bounded.py`) so a dead dependency fails instead of hanging.
- No path, secret, SQL, stack trace or driver message ever reaches an answer. An unknown error is logged with its full cause chain and answered with the fixed 500 text.
- A new failure is a new table entry plus a line in the API page's error list.

## Names, ids, time and paging on the wire

- Every wire key (query, body and `data`) is snake_case. Python code is snake_case already, so models carry the wire names directly and nothing is converted; never add a camelCase alias or a generic key rewriter.
- Paths are plural kebab-case nouns: `/api/v1/order-items`.
- Ids are UUIDs and travel as strings.
- Instants travel as ISO 8601 strings with an offset (`2026-11-04T09:30:00Z`), never as Unix integers. The database side is in `postgres.md`.
- `page_size` defaults to 20 and is clamped to 100; `page` defaults to 1.
- Failure messages are fixed English text.

## Wiring

- Success: routes return `success(data)` or `listing(items, page=..., page_size=..., total_count=...)` from `src/core/envelope.py`, and declare `response_model=Envelope[Model]` or `ListEnvelope[Model]` so the schema comes from the same pydantic models. `success(None)` answers `data: {}`. A raw-response route (the exceptions above) returns a plain `Response` and skips the helper.
- Failure: `register_handlers` in `src/core/handlers.py` sets the handlers on the application. The first match wins: `ApiError` uses its own status and message; `RequestValidationError` becomes 400 `invalid_request` with the issue locations and types (never the input) sent to the debug log; a Starlette `HTTPException` (an unknown route is a 404, a wrong method a 405) is answered with the table message for its status, and a 5xx is logged; a dependency outage becomes 503; anything else is logged with its cause chain and answered 500 `internal`.
- `RequestContextMiddleware` in `src/core/middleware.py` puts `x-request-id` on every response (the caller's when it matches `[A-Za-z0-9._-]{8,128}`, otherwise a new UUID) and writes the access log line.
- The interactive docs and the OpenAPI document are switched off.

## Rate limiting

### Default

Every route is limited per client from the first boot, with no setup: 300 requests per 60 seconds, counted across all routes together. The default is generous on purpose, because a limit that blocks real users costs more than one that is loose; lower it where the traffic is known. A request over the limit is answered 429 in the failure envelope with the `too_many_requests` message (`{"success":false,"payload":{"message":"too many requests"}}`) and a `Retry-After` header.

The settings are environment variables, validated at boot in `src/core/config.py` and listed in `.env.example`:

| Variable                    | Default | Meaning                                               |
| --------------------------- | ------- | ----------------------------------------------------- |
| `RATE_LIMIT_MAX`            | `300`   | Requests allowed per client in one window, at least 1 |
| `RATE_LIMIT_WINDOW_SECONDS` | `60`    | The window in seconds, at least 1                     |
| `TRUST_PROXY`               | empty   | Which proxies' forwarded address is believed (below)  |

### Wiring and the store

`RateLimitMiddleware` in `src/core/rate_limit.py` is a pure ASGI middleware over the `limits` package (a fixed window per client). `create_app` in `src/main.py` is the wiring place: it passes the numbers from the settings, and it adds the limit before `RequestContextMiddleware`, so the request context is the outer layer and a refused request still gets an id and an access log line. The middleware runs before routing, so a request to an unknown path is counted too.

The `limits` async storage (`limits.aio.storage.Storage`) is the port: the middleware is given one and never builds it. `create_memory_storage()` is the default, the memory of one process. A second instance would count on its own, so with more than one the real limit is multiplied and a client balanced across them is counted loosely. The shared storage, which the Redis overlay provides, replaces that one call in `create_app`; no other file changes.

### The client

The limit counts the socket address, `scope["client"]`, unless `TRUST_PROXY` is set. `TRUST_PROXY` is a comma-separated list of the addresses or ranges of the reverse proxies in front of the server (`10.0.0.1,172.16.0.0/12`; `loopback`, `linklocal` and `uniquelocal` are accepted names). Then `x-forwarded-for` is believed only on a connection from one of them, and the client is the first address from the right that is not one of them. An IPv6 client is counted as its `/64` network, and an IPv4-mapped address as the IPv4 address, so one client cannot take a new bucket by varying the low bits.

Without this rule a header from an unproxied caller is free text, and a caller could take a new bucket per request by changing it. So a blanket value (`true`, `*`, `0.0.0.0/0`) and a bare count are refused at boot. `TRUST_PROXY` is the single setting: `make dev` and `main.py` start uvicorn with proxy headers off, so uvicorn does not rewrite the client address behind it. `client_address` in `src/core/middleware.py`, which the access log uses, reads the headers as given and is for logs only. With no proxy trusted, a log line can name a forged address while the limit counts the socket address. Never use it to decide anything.

### Behind a proxy or a web server

- Behind a reverse proxy, set `TRUST_PROXY` to the proxy addresses. Left unset, every visitor arrives from the proxy's address and shares one bucket, which can lock everyone out at once.
- A web server in front of this API (the Next template) reaches it from its own address. A page rendered on that server calls the API with no visitor address, because the server-side request carries none of the visitor's headers. The rewrite that forwards the browser's `/api/v1` calls adds no `x-forwarded-for` either (checked in Next 16.4.5); it passes on what the visitor or the proxy in front of Next sent. So with `TRUST_PROXY` unset, every call that reaches the API through the web server, from a page or from the browser, is counted under the web server's address: one bucket of 300 per 60 seconds for the whole site.
- A deployment with a web server in front must therefore do one or both of these. Put a proxy in front of the web server that sets `x-forwarded-for`, and set `TRUST_PROXY` to the addresses of the web server and that proxy: calls the browser makes are then counted per visitor. Raise `RATE_LIMIT_MAX` to the volume of the server-rendered calls, because those stay in the web server's bucket until the web server forwards the visitor's address with each server-side call.

### Exempting a route

Only the health route is exempt by default, and it is the worked example. A path that must never be refused, such as a probe or a signature-verified webhook, goes in the `exempt_paths` argument of `RateLimitMiddleware` in `create_app`, as an exact request path (`HEALTH_PATH`, `/api/health`, is there now). A probe from a load balancer is otherwise counted against the balancer's address, and one answered 429 reads as a dead service.

## The health route

Every route is under `/api/v1/` except `GET /api/health`. It is the liveness probe: `src/health/router.py` is included in `create_app` without the `API_PREFIX`, and it is one of the envelope exceptions above, so it returns a plain dict and skips `success()`: 200 with exactly `{"status":"ok"}`, because a load balancer reads the bare body. It touches no dependency, because no store ships; a data overlay adds its checks and answers 503 `{"status":"unavailable"}` when one is down. A route with no dependency needs no port or factory.

It is public and stays public when authentication is added: mark it `@public` in the same change. It is exempt from the rate limit.

## Auth

### Current state

This template ships no authentication. Every route it has is public, and nothing in the code checks who is calling. Do not describe the service as protected.

### Steps before the first non-public route

1. Add `src/auth/dependencies.py` with a `public` marker (sets `endpoint.__public__ = True`) and an async `current_user(request)` dependency. It returns `None` when the matched endpoint (`request.scope["route"].endpoint`) is marked public, and otherwise verifies the bearer token and raises `ApiError("unauthorized")`.
2. Mount it once, at the app: `FastAPI(dependencies=[Depends(current_user)], ...)` in `create_app`, so it runs before every route of every router, including one added later and forgotten. A router never adds its own auth dependency; a handler that needs the user repeats `Depends(current_user)`, which FastAPI resolves once per request.
3. Mark the hello route `@public`, and every other route that must stay open (health probes, signature-verified webhooks).
4. The app-level dependency covers API routes only: anything added with `app.mount` or `add_route` bypasses it, so mount nothing outside the routers.
5. Add the signing secret to `src/core/config.py` (minimum length 32) and `.env.example` with a fake value.
6. Add tests: a request without a token to a non-public route answers 401 in the failure envelope, and a public route answers 200 without one.
7. Update `AGENTS.md` (Auth line), this section and the API pages in the same change.

### Target state

After those steps, authentication is on by default and enforced once, above every route; a public route opts out explicitly, so a router or scope added later and forgotten fails closed instead of being public. Health probes and signature-verified webhooks are the usual public routes.

- Passwords are stored only as Argon2id hashes.
- Access tokens are short-lived JWTs (minutes). The signing secret comes from the env schema with a minimum length of 32.
- Refresh tokens are stored as a digest, never raw, and rotate on every use. A rotated token presented again is treated as theft and revokes its whole family.
- Authorisation is checked in one place (a guard or a policy function), not scattered through handlers.
- Rate limiting is already on (see Rate limiting). With more than one instance, give it the shared storage (Redis) and set `TRUST_PROXY` to the proxies in front; never trust all proxies, because a blanket value lets any caller forge `X-Forwarded-For`.
- CORS allows the one web origin from config, never `*` with credentials. Add a security-headers middleware; this template registers none.
- Secrets and tokens are never logged. Webhook receivers verify a signature over the raw body before parsing it.
