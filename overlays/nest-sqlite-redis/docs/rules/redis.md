# Redis: keys, cache, pub/sub, locks and queues

Redis holds disposable or coordination state: caches, locks, pub/sub messages and BullMQ queues. The database stays the source of truth. Anything in Redis may be lost or evicted, so nothing in it may be the only copy.

## Connection and keys

- `src/redis/client.ts` is the one file that names the Redis client. `createRedisClient(config)` returns the client, a probe and a close from a URL in the env schema (`REDIS_URL`); the `src/infra/` seam calls it once. No host or credential in code. Reuse the client; never open one per request.
- The client has no offline queue and a capped reconnect delay. While it holds no connection every command fails at once with an error the shared classifier answers as 503, instead of waiting in memory and running late. Its `error` events are handled and logged as one line with the code and never the URL, so a lost connection neither ends the process nor leaks the credential.
- Start-up checks the connection with a real `PING`: if Redis cannot be reached the server does not start and says `redis`, never a value. After start-up the health route answers 503 while Redis is lost and 200 again once the client has reconnected.
- Key shape for your own keys: `<service>:<entity>:<id>[:<facet>]`, lower case, colon separated, for example `shop:product:42:detail`. The service prefix keeps services sharing one Redis apart. Change `REDIS_KEY_PREFIX` of `src/redis/client.ts` (`app`) to the project's name once, and use it for your own keys too.
- The template writes its rate-limit counters under that prefix too, each with a TTL, and the shape depends on the framework. Fastify's are `app:rate-limit:<scope>:<client>`. Nest's come from `@nest-lab/throttler-storage-redis`, which wraps every key it is given in a hash tag and adds the throttler's name, so they are `{app:rate-limit:default:<client>:default}:hits` and `{app:rate-limit:default:<client>:default}:blocked`: they contain the prefix and do not start with it. They expire by themselves; to find them, match `*app:rate-limit:*`.
- Every key written by application code gets a TTL, except queue keys that the queue library manages. Reason: a key without a TTL becomes permanent clutter.
- Never run `FLUSHALL` or `FLUSHDB`, in code, scripts or by hand against a shared instance. To clear, delete keys by exact name or by `SCAN` with `MATCH` on the service prefix (`app:*` for the keys of your own code), in batches.
- Never use `KEYS` in application code; use `SCAN`.
- An unreachable Redis answers 503, not 500 (see `api-and-errors.md`). A cache miss caused by an outage falls through to the database where that is safe.
- A call to Redis on the request path goes under `bounded()`: a connection that is up but silent would otherwise hold the request open. The rate limiter already does, and it fails closed: when Redis does not answer, the request is answered 503 and is not let through uncounted.

## Cache-aside

1. Read the key. On a hit, return it.
2. On a miss, read the database, write the result with a TTL, return it.
3. A write updates the database first, then deletes the key (delete, not update). Reason: deleting cannot leave a stale value behind a race that updating can.

Rules: the TTL is the staleness bound, so choose it from how stale the answer may be; serialise as JSON; cache the data, not the envelope; never cache per-user data under a shared key. Add a little random jitter to TTLs of keys that are filled together.

## Pub/sub

- Channel names follow the key shape: `<service>:<event>`.
- Pub/sub is fire-and-forget: a subscriber that is down misses the message. Use it for live fan-out (websocket push, cache invalidation hints), not for work that must happen; use a queue for that.
- A subscriber needs its own connection; a connection in subscribe mode cannot run other commands.
- Publish after the database transaction commits.

## Locks

Take a lock with one atomic command and release it only if you still own it:

```ts
const token = randomUUID();
const ok = await redis.set(`shop:lock:order:${id}`, token, 'EX', 30, 'NX');
if (ok !== 'OK') throw new AppError('busy');
try {
  await work();
} finally {
  // release only our own lock, atomically
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
    1,
    `shop:lock:order:${id}`,
    token,
  );
}
```

- `SET key token NX EX seconds` is the only way to acquire; a separate `SETNX` then `EXPIRE` can leave a lock with no expiry.
- The TTL is longer than the work, and the work must tolerate losing the lock. A lock is an optimisation against duplicate work; correctness still rests on a database constraint or a row lock.
- Do not hold a lock across a database transaction commit boundary you do not control.

## BullMQ queues

- Queues live in an infrastructure module. Business modules call a small wrapper (`EmailQueue.send`) and never import `bullmq` directly, so a queue can be swapped in one place.
- Enqueue after the transaction that caused the job has committed. The queue cannot join a database transaction, and a job for a change that rolled back is the failure to avoid; a job that arrives a moment late is not.
- Two lanes. Event queues carry fire-and-forget work triggered by an event; losing one is recoverable. Sweep queues run periodic jobs whose work is derived from database state, never from an earlier job, so a lost enqueue costs nothing.
- Jobs are idempotent: a retry must not double the effect. Carry ids in the payload, not whole rows.
- Set attempts with exponential backoff, and `removeOnComplete` and `removeOnFail` limits so finished jobs do not grow Redis without bound.
- BullMQ needs `maxRetriesPerRequest: null` on its connection.
- Workers log failures with the job id and the cause chain, and never log the payload when it holds personal data or secrets.
