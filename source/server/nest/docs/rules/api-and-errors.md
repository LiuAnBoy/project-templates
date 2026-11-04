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
- Every list endpoint is paged. `page` starts at 1; clamp `page_size` to `MAX_PAGE_SIZE` and report the effective value, not the requested one.
- Build the envelope in one place only (`ResponseEnvelopeInterceptor` for success, `AllExceptionsFilter` for failure), never by hand in a handler. A shape built in many places drifts.
- The envelope has three explicit exceptions, and no others: file downloads and streams, which are not JSON; health and readiness probes, which answer a bare `{ "status": "ok" }` (readiness answers 503 with `{ "status": "unavailable" }` when a dependency is down) so a load balancer can read them; and an endpoint whose machine caller expects a bare status (an incoming webhook that must answer 401 with an empty body). Note the exception in the route's doc comment.

## Failures

- The HTTP status carries the kind of failure. The body carries only a message. A client branches on status, and a public error code becomes a contract that is hard to retire.
- Services throw one app error type holding an internal code. The code is for logs and tests and is never serialised.
- One table maps each internal code to `(status, message)`; it lives in `src/common/errors/failures.ts`, with `AppError` in `src/common/errors/app-error.ts`. The message is fixed text, or a template whose only variable is a name from a closed set (a parameter or field the server defines), sanitised to `[A-Za-z0-9_.-]{1,40}` and shown as `?` otherwise.
- Every error a client sees comes from the table, whoever raised it. An error raised by a framework or a guard (a Nest `HttpException`, a Fastify validation or body-limit error) is answered with the message of the table entry for its status, never the framework's own text; a status with no entry answers the entry for 400 (4xx) or `internal` (5xx).
- Pick distinct statuses where the meaning allows, because the client cannot tell two failures with one status apart. Give no two table entries the same message (a test guards this).
- Status map: 400 malformed request or failed validation; 401 no or invalid credential; 403 refused; 404 nothing there (also for another user's resource, so ids cannot be probed); 409 state conflict; 422 a well-formed request the rules refuse; 429 rate limit; 503 a dependency is unavailable; 500 anything unexpected.
- A validation failure answers 400 with a fixed message. The zod issue list goes to the debug log, not to the client.
- An unreachable database or Redis answers 503, not 500: the client should retry a 503 and report a 500. Wrap dependency calls in `bounded()` so a dead dependency fails instead of hanging.
- No path, secret, SQL, stack trace or driver message ever reaches an answer. An unknown error is logged with its full cause chain and answered with the fixed 500 text.
- A new failure is a new table entry plus a line in the API page's error list.

## Wiring

- `ResponseEnvelopeInterceptor` (global, `APP_INTERCEPTOR`) maps a handler's return value to `{ success: true, payload: { data } }`, returns `data: {}` for `undefined`, and passes a `StreamableFile` through untouched. `paginated(data, meta)` returns the list shape. Controllers return plain data. `@RawResponse()` leaves one handler or controller outside the envelope; use it only for the exceptions above.
- `AppError` extends `Error`, not `HttpException`, and takes a table code. Services throw `new AppError('notFound')`; controllers and repositories do not build HTTP responses.
- `AllExceptionsFilter` (global, `APP_FILTER`, `@Catch()`) is the only place a failure body is built. It tests in this order, first match wins: `ZodValidationException` (a subclass of `HttpException`, so it comes first) becomes 400 `invalidRequest` with the issues sent to the debug log; `AppError` uses its own status and message; any other `HttpException` or framework error with a status is answered with the table message for that status, and a 5xx is logged; a dependency outage becomes 503; anything else is logged with its cause chain and answered 500 `internal`.
- The JSON body parser is replaced (`bodyParser: false` plus `registerJsonBodyParser`) so a malformed body answers from the table and an empty JSON body parses to `{}`.
- Every response carries `x-request-id`: the caller's when it matches `[A-Za-z0-9._-]{8,128}`, otherwise a new UUID.

## Auth

### Current state

This template ships no authentication. Every route it has is public, and nothing in the code checks who is calling. Do not describe the service as protected.

### Steps before the first non-public route

1. Add `common/auth/` with a JWT guard that reads a `@Public()` marker (`SetMetadata` plus `Reflector.getAllAndOverride`) and throws `new AppError('unauthorized')` when the bearer token is missing or invalid.
2. Register it as the first `APP_GUARD` in `app.module.ts`, so it runs above every controller of every module, present and future. Do not use `useGlobalGuards`, which cannot inject `Reflector`.
3. Mark the hello controller `@Public()`, and every other route that must stay open (health probes, signature-verified webhooks).
4. Add the signing secret to `config/env.ts` (minimum length 32) and `.env.example` with a fake value.
5. Add tests: a request without a token to a non-public route answers 401 in the failure envelope, and a `@Public()` route answers 200 without one.
6. Update `AGENTS.md` (Auth line), this section and the API pages in the same change.

### Target state

After those steps, authentication is on by default and enforced once, above every route; a public route opts out explicitly, so a router or scope added later and forgotten fails closed instead of being public. Health probes and signature-verified webhooks are the usual public routes.

- Passwords are stored only as Argon2id hashes.
- Access tokens are short-lived JWTs (minutes). The signing secret comes from the env schema with a minimum length of 32.
- Refresh tokens are stored as a digest, never raw, and rotate on every use. A rotated token presented again is treated as theft and revokes its whole family.
- Authorisation is checked in one place (a guard or a policy function), not scattered through handlers.
- Rate-limit with a store shared across instances (Redis). Never trust all proxies: `trustProxy` is a hop count or a list of specific addresses, because a blanket value lets any caller forge `X-Forwarded-For`. `getClientAddress` reads the forwarded headers as given and is correct only behind a proxy that overwrites them.
- CORS allows the one web origin from config, never `*` with credentials. Security headers are already registered (`@fastify/helmet`).
- Secrets and tokens are never logged. Webhook receivers verify a signature over the raw body before parsing it.
