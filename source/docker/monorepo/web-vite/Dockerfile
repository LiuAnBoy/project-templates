# Vite part image, built from the workspace root; PART names the directory. The
# build stage installs the workspace from the lockfile and builds the static files;
# the runtime stage is nginx (unprivileged, uid 101) serving them on 8080 and
# forwarding /api/v1/ to API_HOST, which nginx reads from the environment when it
# starts. Build with `docker compose build`, not by hand.
FROM node:24-slim AS build
ARG PART
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter "$PART..." run build

FROM nginxinc/nginx-unprivileged:alpine
ARG PART
COPY --from=build --chown=101:101 /workspace/${PART}/dist /usr/share/nginx/html
COPY --from=build --chown=101:101 /workspace/${PART}/nginx/default.conf.template /etc/nginx/templates/default.conf.template
USER 101:101
EXPOSE 8080
