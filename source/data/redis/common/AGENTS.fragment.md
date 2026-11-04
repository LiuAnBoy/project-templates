## Redis

- Cache, lock, pub/sub and queue work follows `docs/rules/redis.md`: keys are `<service>:<entity>:<id>`, every key written by application code has a TTL, never `FLUSHALL`, `FLUSHDB` or `KEYS`.
- An unreachable Redis answers 503, not 500, and anything in it may be lost: the database stays the source of truth.
