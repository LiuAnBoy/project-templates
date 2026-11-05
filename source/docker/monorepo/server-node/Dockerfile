# Node server image, built from the workspace root. The build stage installs the
# whole workspace from the lockfile, builds the server and its contract package,
# and deploys the server's production dependencies to /app; the runtime stage
# copies only named paths and runs as uid 1000. Build with `docker compose build`,
# not by hand.
FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /workspace
# docker-fragment: build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter "server..." run build \
    && pnpm --filter server deploy --legacy --prod /app \
    && cp -R server/dist /app/dist

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/package.json ./package.json
COPY --from=build --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/dist ./dist
# docker-fragment: runtime
USER 1000:1000
EXPOSE 8000
CMD ["node", "dist/main.js"]
