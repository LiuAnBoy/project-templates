# Node server image. The build stage installs from the lockfile, builds and
# drops the dev dependencies; the runtime stage copies only named paths and
# runs as uid 1000. Build with `docker compose build`, not by hand.
FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build && pnpm prune --prod

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/package.json ./package.json
COPY --from=build --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/dist ./dist
COPY --from=build --chown=1000:1000 /app/scripts ./scripts
COPY --from=build --chown=1000:1000 /app/drizzle ./drizzle
USER 1000:1000
EXPOSE 8000
CMD ["node", "dist/main.js"]
