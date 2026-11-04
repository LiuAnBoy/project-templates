## Redis on FastAPI

- Take the client from the infra seam: `create_infra(config)` in `src/infra/infra.py` returns `redis` (the client), and `main.py` passes it to the services it wires. `create_infra` creates it once and its `close` releases it; never create another. The package is `src/redis_client/`, because `src/redis` would shadow the `redis` library.
- The default rate limit counts in Redis through `limits`, and every call to it runs under `bounded()`; `make test-integration` runs the store tests against the compose service (start it first, and copy `.env.example` to `.env`).
