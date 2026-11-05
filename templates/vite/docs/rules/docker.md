# Docker: images, compose and secrets

These rules hold when the project has a `Dockerfile`, a `docker-compose.yml` and a `.dockerignore`. A project that declined them keeps this page, and nothing here applies to it.

## Starting

- Copy `.env.example` to `.env` and set `COMPOSE_PROJECT_NAME` to a name that is unique on the machine. Compose refuses to start while it is empty and names the variable. The name keeps two projects apart, so `docker compose down -v` removes only this project's volumes.
- `docker compose up -d --build --wait` builds the image, starts the services and returns when every healthcheck passes.
- Every `*_PORT` setting of `.env` is a host port. A server inside its container always listens on 8000, and `PORT` in `.env` chooses the loopback port that reaches it. A web service listens on its framework's port inside the container (3000 for Next.js, 8080 for the nginx image of Vite), and `WEB_PORT` chooses the loopback port that reaches it.

## Images

- The Node and Python runtime images are Debian `-slim` bases. A Node image takes its major version from `.nvmrc`, installs pnpm through corepack from the `packageManager` field, and installs from the lockfile. A Python image installs from `uv.lock` with `uv sync --frozen --no-dev`.
- A build stage installs and builds. The runtime stage copies named paths only: the built output, the production dependencies and whatever a store needs to migrate. Source, tests, documents and dev dependencies stay behind.
- A Next.js image runs the standalone server that `next build` writes when the Dockerfile sets `NEXT_OUTPUT=standalone`; `next.config.ts` reads that value and no other command sets it. The build stage creates `public/` when the project has none, so a project that adds it later reaches the image.
- A Vite image serves the built files from `nginxinc/nginx-unprivileged:alpine` on 8080. The image renders `nginx/default.conf.template` from the environment when it starts, so `API_HOST` needs no rebuild. The template forwards `/api/v1/` to `API_HOST` as a fixed upstream that nginx resolves at start, and answers every other path with `index.html`. Nothing else is forwarded, so the API's `/api/health` is not reachable through the web port.
- The runtime user is numeric: `1000:1000` for the `node` and `app` users, with `--chown=1000:1000` on copied files, and `101:101` for the nginx image, whose configuration directory belongs to that uid. Only the final stage's `USER` counts.
- A directory the process writes to is created and owned by the runtime uid in the image, because an empty named volume takes the ownership of the directory it mounts over.

## Secrets

- A secret is never a build argument, an `ENV` line, a copied file or a layer. The only build arguments are `API_HOST` and `PART`.
- A server takes runtime values from `env_file: .env` and `environment`. A web service (`web`, `dashboard`) sets no `env_file`: a root `.env` holds the server's database credentials, and the web containers are the ones that face outward. Its values come from build arguments and `environment` alone.
- The context excludes `**/.env`, `**/.env.*` (except the example), `**/node_modules`, and the local notes directory `todos` at the project root only. A source folder named `todos` anywhere deeper, such as `src/todos/`, stays in the context.
- A startup failure prints the name of a setting or a check and never a value. A container shows it unchanged: the exit code and the text are those of the process.

## Healthchecks and restarts

- The server's healthcheck calls `GET /api/health` with the image's own runtime, because the slim images have no curl. A 503 marks the container unhealthy. `restart: unless-stopped` does not act on health, so an outage of a dependency does not restart the instances.
- A web service's healthcheck reads `/`, because a web app has no `/api/health` and reading through the proxy would mark it unhealthy whenever the API is down.
- A service that states no `restart` gets `unless-stopped`.

## Ports and proxies

- Published ports bind to `127.0.0.1`. Opening one beyond loopback requires a reverse proxy in front of it.
- Behind a proxy, name the proxy in `TRUST_PROXY`. Leave it empty when nothing is in front: the limit then counts the socket address.
- A standalone web container names its API in `DOCKER_API_HOST` in `.env`, which is both the image build argument (Next.js) and the running container's `API_HOST`. The default, `http://host.docker.internal:8000`, reaches a server published on the host's loopback where Docker Desktop forwards that name to the host. On Linux `extra_hosts` maps the name to `host-gateway`, which is the bridge address, and a server published on `127.0.0.1` does not listen there, so the default misses a server from this repository's compose. Put the web and the server on one external network and name the server's service in `DOCKER_API_HOST` (`http://<service>:8000`), or give the host's real address. This follows from how Docker publishes ports and was not run on Linux.
