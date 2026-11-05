## Docker

These rules apply when the project has a `Dockerfile`, a `docker-compose.yml` and a `.dockerignore`; a project that declined them has none of the three. The full rules are in `docs/rules/docker.md`.

- No secret enters an image. Runtime values come from `.env` through `env_file` and from `environment`; the only build arguments allowed are `API_HOST` and `PART`, and `.dockerignore` keeps `.env`, `node_modules` and `todos` out of the build context.
- The image runs as uid 1000, never root, and holds only the built output and its production dependencies.
- `COMPOSE_PROJECT_NAME` in `.env` must be set. It names the compose project, so two projects on one machine never share a container or a volume.
- The server answers `GET /api/health` inside its container; its compose healthcheck reads that route through the image's own runtime, and a failing dependency check marks the container unhealthy.
- Published ports bind to `127.0.0.1`; a proxy in front of the project is the way to open one wider.
