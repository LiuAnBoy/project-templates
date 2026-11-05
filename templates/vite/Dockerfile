# Vite web image. The build stage installs from the lockfile and builds the static
# files; the runtime stage is nginx (unprivileged, uid 101) serving them on 8080
# and forwarding /api/v1/ to API_HOST, which nginx reads from the environment when it
# starts. Build with `docker compose build`, not by hand.
FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
COPY --chown=101:101 nginx/default.conf.template /etc/nginx/templates/default.conf.template
USER 101:101
EXPOSE 8080
