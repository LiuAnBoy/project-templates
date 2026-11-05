## Docker

These rules apply when the project has a `Dockerfile`, a `docker-compose.yml` and a `.dockerignore`; a project that declined them has none of the three. The full rules are in `docs/rules/docker.md`.

- No secret enters an image. A server's runtime values come from `.env` through `env_file` and from `environment`; a web service reads no `env_file`, only build arguments and `environment`. The only build arguments allowed are `API_HOST` and `PART`, and `.dockerignore` keeps `.env`, `node_modules` and `todos` out of the build context.
- The image runs as a numeric non-root uid and never root: 1000, or 101 in the nginx image of a Vite project. It holds only the built output and, for a server, its production dependencies.
- `COMPOSE_PROJECT_NAME` in `.env` must be set. It names the compose project, so two projects on one machine never share a container or a volume.
- A server answers `GET /api/health` inside its container; its compose healthcheck reads that route through the image's own runtime, and a failing dependency check marks the container unhealthy. A web service's healthcheck reads `/`, never the API, so an API outage does not mark it unhealthy.
- Published ports bind to `127.0.0.1`; a proxy in front of the project is the way to open one wider.
