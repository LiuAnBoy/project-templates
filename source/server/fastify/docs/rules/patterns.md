# Patterns: problems this project already has an answer for

When a task hits one of the problems below, do not design it again. Each entry is the answer this project uses. An entry belongs here when a second module will meet the same problem; a trade-off that only one module meets stays in that module's own documentation.

This template ships no database, auth or queue yet, so the examples show the shape the answer takes once they exist. The names `AppError`, `bounded`, `isDependencyOutage` and `describeFailure` are real and live under `src/common/`.

## Who may do this?

- Declare what an endpoint needs, not who holds it. Name a capability (`orders.refund`), mark the endpoint with it, and let one registry say which role grants which capability. Role names never appear in a controller; otherwise "let this role do that too" means hunting every place the role name was scattered.
- Authentication is a global hook with an explicit public opt-out (`api-and-errors.md`, Auth). A capability check is a second `onRequest` hook that reads the route's config, not a check inside the handler.
- A capability answers "may this caller do this kind of thing", never "is this row theirs". Ownership is an object-level check that the owning service makes when it reads or writes the row. Keep a list of the capabilities that need that extra check, and treat the marker alone as insufficient for them.
- Choose the scope deliberately: a global capability comes from the caller's roles, a resource-scoped capability from the resource's own ownership and membership rows.

## This must not be duplicated or raced

Read-then-write does not stop concurrency: two requests both read "not there yet", then both write.

- Unique index plus a meaningful error. The database enforces uniqueness; the service catches the violation and throws a table error, so the client gets a 409, not a 500.

  ```ts
  try {
    return await insertOrder(input, client);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error; // SQLSTATE 23505
    throw new AppError('conflict');
  }
  ```

- Atomic claim. When one winner must take a state (a token rotates, a job is picked up), put the condition in the write itself and check the affected row count.

  ```sql
  UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL
  ```

  Zero rows updated means someone else won; treat that as the loser path.

- Protecting "never fewer than one" (the last administrator, the last owner): lock the rows you are about to count, in the same transaction as the change, or use a constraint that cannot be violated. Counting first and then writing races.
- When a decision depends on values you read, lock them (`SELECT ... FOR UPDATE`) in the transaction that acts on them, so the values cannot change between the read and the write.

## Every change must leave a trace

- Write the audit entry in the same transaction as the change, so a change without a trace and a trace without a change are both impossible. Record who (the authenticated caller), what (the action and the target id), and when (`timestamptz`); never the secret values themselves.
- Reads that are only POSTs for transport reasons are not changes; mark them to skip the audit rather than writing noise.
- Keep a coarse record (one row per request or action) and fine records (one row per changed field) linked by an id, so either can be found from the other.
- A new module is not done until its mutating endpoints are audited and a test proves it.

## This happens later

- Do not enqueue a delayed job for a future moment. Store the due time on the row and let a scheduled sweep select rows that are due. A lost enqueue then costs nothing, because the next sweep finds the row anyway.
- Sweeps are idempotent: running one twice changes nothing the second time, because each step claims its row atomically (see above).
- Enqueue work that must follow a change only after the transaction that caused it has committed (`postgres.md`, `redis.md`).

## This table keeps growing

- Decide the retention when the table is created: who reads old rows, and how old. Prune or partition by time; never let an append-only table grow without a plan.
- Index every column a list filters or sorts on, and every foreign key.
- Every list endpoint is paged and clamps the page size. An unbounded list is a future outage.
- Delete in batches inside a job, not in one statement that locks the table.

## What to return to a client

- Always the envelope (`api-and-errors.md`). Lists are paged, with the effective page size.
- Map rows to response DTOs; never return a row object. Password hashes, internal ids, other users' data and storage keys do not leave the service.
- Return the smallest shape the client needs, with stable field names. Timestamps go out as ISO 8601 with an offset.
- A mutation answers with the changed resource, or `data: {}` when there is nothing to return.

## This is not their resource

- A caller asking for a row that belongs to someone else gets the same 404 as a row that does not exist, so ids cannot be probed. Use 403 only when the existence of the thing is already public.
- Scope the query itself by owner (`WHERE id = $1 AND owner_id = $2`) rather than loading the row and comparing afterwards.
- Admin paths that cross owners are explicit, named, and capability-checked.

## This value cannot be trusted

- Validate at the edge with a zod schema: body, query, params and environment. Reject unknown keys on write schemas.
- Never take a price, a total, a role, an owner id or a timestamp from the client when the server can compute or look it up.
- Echo into a message only a name from a closed set the server defines, through `new AppError(code, name)`, which sanitises it. Never echo free text from the request into an answer or a log line.
- Treat headers as input: `x-forwarded-for` is usable only behind a proxy that overwrites it; a request id is accepted only when it matches the safe pattern.
- A file name, a path or a URL from a client is data, never a path to open or a host to call.

## A dependency is down

- The answer is 503, not 500, so the client retries. `isDependencyOutage` classifies by what only a broken connection produces (a network errno or a connection-class SQLSTATE), wherever it hides in the cause chain; anything unrecognised stays a 500 that gets investigated.
- Every call to a dependency on the request path has a deadline: wrap it in `bounded(work, ms, 'name')`. Clients of a dead dependency wait instead of failing, and a request that never finishes reads as "still working" and holds a connection until the pool is gone.
- Say it once. A reconnecting client must not print a stack trace per retry; own the client, listen for its error event, and log the outage a single time.
- Rate limiting and other fail-closed checks that depend on Redis answer 503 when Redis is down, instead of hanging every endpoint.
- Log the whole cause chain (`describeFailure`), because the top-level message of a driver error is usually useless. The answer to the client stays the fixed text.
