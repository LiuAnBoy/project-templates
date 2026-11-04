## Redis

- Cache, lock, pub/sub and queue work follows `docs/rules/redis.md`: keys are `<service>:<entity>:<id>`, every key written by application code has a TTL, never `FLUSHALL`, `FLUSHDB` or `KEYS`.
- An unreachable Redis answers 503, not 500, and anything in it may be lost: the database stays the source of truth.
- `REDIS_URL` is required and the only value the server reads; `docker-compose.dev.yml` runs the service in development, and a shared server is reached by changing `.env` alone. The default rate limit counts in Redis, so every instance shares one limit, and it answers 503 rather than letting requests through uncounted when Redis is unreachable.
