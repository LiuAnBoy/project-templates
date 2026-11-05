# Docker: images, compose and secrets

These rules hold when the project has a `Dockerfile`, a `docker-compose.yml` and a `.dockerignore`. A project that declined them keeps this page, and nothing here applies to it.

## Starting

- Copy `.env.example` to `.env` and set `COMPOSE_PROJECT_NAME` to a name that is unique on the machine. Compose refuses to start while it is empty and names the variable. The name keeps two projects apart, so `docker compose down -v` removes only this project's volumes.
- `docker compose up -d --build --wait` builds the image, starts the services and returns when every healthcheck passes.
- Every `*_PORT` setting of `.env` is a host port. The server inside the container always listens on 8000, and `PORT` in `.env` chooses the loopback port that reaches it.

## Images

- The runtime image is a Debian `-slim` base. A Node image takes its major version from `.nvmrc`, installs pnpm through corepack from the `packageManager` field, and installs from the lockfile. A Python image installs from `uv.lock` with `uv sync --frozen --no-dev`.
- A build stage installs and builds. The runtime stage copies named paths only: the built output, the production dependencies and whatever a store needs to migrate. Source, tests, documents and dev dependencies stay behind.
- The runtime user is `1000:1000`, written as numbers so one rule fits the `node` user and the `app` user. Files copied into the image use `--chown=1000:1000`.
- A directory the process writes to is created and owned by uid 1000 in the image, because an empty named volume takes the ownership of the directory it mounts over.

## Secrets

- A secret is never a build argument, an `ENV` line, a copied file or a layer. The only build arguments are `API_HOST` and `PART`, and `test-render.mjs` fails on any other.
- Runtime values come from `env_file: .env` and `environment`. The context excludes `**/.env`, `**/.env.*` (except the example), `**/node_modules` and `**/todos`.
- A startup failure prints the name of a setting or a check and never a value. A container shows it unchanged: the exit code and the text are those of the process.

## Healthchecks and restarts

- The server's healthcheck calls `GET /api/health` with the image's own runtime, because the slim images have no curl. A 503 marks the container unhealthy. `restart: unless-stopped` does not act on health, so an outage of a dependency does not restart the instances.
- A service that states no `restart` gets `unless-stopped`.

## Ports and proxies

- Published ports bind to `127.0.0.1`. Opening one beyond loopback requires a reverse proxy in front of it.
- Behind a proxy, name the proxy in `TRUST_PROXY`. Leave it empty when nothing is in front: the limit then counts the socket address.
