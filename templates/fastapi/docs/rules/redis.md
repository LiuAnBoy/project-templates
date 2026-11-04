# Redis: keys, cache, pub/sub, locks and queues

Redis holds disposable or coordination state: caches, locks, pub/sub messages and queues. PostgreSQL stays the source of truth. Anything in Redis may be lost or evicted, so nothing in it may be the only copy.

## Current state

This template ships no Redis: no client is installed, no variable is read, and nothing in the code touches a cache, lock or queue. The rules below apply from the first use on. Add the client, `REDIS_URL` in the env schema and `.env.example` (a fake value), and record the use on the architecture page in the same change.

## Connection and keys

- One client per process, from a URL in the env schema (`REDIS_URL`), created in the app lifespan; no host or credential in code. Reuse the client; do not open one per request.
- Key shape: `<service>:<entity>:<id>[:<facet>]`, lower case, colon separated, for example `shop:product:42:detail`. The service prefix keeps services sharing one Redis apart.
- Every key written by application code gets a TTL, except queue keys that the queue library manages. Reason: a key without a TTL becomes permanent clutter.
- Never run `FLUSHALL` or `FLUSHDB`, in code, scripts or by hand against a shared instance. To clear, delete keys by exact name or by `SCAN` with the service prefix, in batches.
- Never use `KEYS` in application code; use `SCAN`.
- An unreachable Redis answers 503, not 500 (see `api-and-errors.md`). A cache miss caused by an outage falls through to the database where that is safe.

## Cache-aside

1. Read the key. On a hit, return it.
2. On a miss, read PostgreSQL, write the result with a TTL, return it.
3. A write updates PostgreSQL first, then deletes the key (delete, not update). Reason: deleting cannot leave a stale value behind a race that updating can.

Rules: the TTL is the staleness bound, so choose it from how stale the answer may be; serialise as JSON; cache the data, not the envelope; never cache per-user data under a shared key. Add a little random jitter to TTLs of keys that are filled together.

## Pub/sub

- Channel names follow the key shape: `<service>:<event>`.
- Pub/sub is fire-and-forget: a subscriber that is down misses the message. Use it for live fan-out (websocket push, cache invalidation hints), not for work that must happen; use a queue for that.
- A subscriber needs its own connection; a connection in subscribe mode cannot run other commands.
- Publish after the database transaction commits.

## Locks

Take a lock with one atomic command and release it only if you still own it:

```python
token = uuid.uuid4().hex
if not await redis.set(f"shop:lock:order:{order_id}", token, ex=30, nx=True):
    raise ApiError("busy")
try:
    await work()
finally:
    # release only our own lock, atomically
    await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
        1,
        f"shop:lock:order:{order_id}",
        token,
    )
```

- `SET key token NX EX seconds` is the only way to acquire; a separate `SETNX` then `EXPIRE` can leave a lock with no expiry.
- The TTL is longer than the work, and the work must tolerate losing the lock. A lock is an optimisation against duplicate work; correctness still rests on a database constraint or a row lock.
- Do not hold a lock across a database transaction commit boundary you do not control.

## Queues

- Queues live in an infrastructure module. Business modules call a small wrapper (`email_queue.send`) and never import the queue library directly, so a queue can be swapped in one place.
- Enqueue after the transaction that caused the job has committed. The queue cannot join a PostgreSQL transaction, and a job for a change that rolled back is the failure to avoid; a job that arrives a moment late is not.
- Two lanes. Event queues carry fire-and-forget work triggered by an event; losing one is recoverable. Sweep jobs run periodically and derive their work from database state, never from an earlier job, so a lost enqueue costs nothing.
- Jobs are idempotent: a retry must not double the effect. Carry ids in the payload, not whole rows.
- Set attempts with exponential backoff, and limits on retained finished and failed jobs so they do not grow Redis without bound.
- Workers log failures with the job id and the cause chain, and never log the payload when it holds personal data or secrets.
