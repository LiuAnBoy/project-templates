# Next.js part image, built from the workspace root; PART names the directory. The
# build stage installs the workspace from the lockfile and builds a standalone
# server; the runtime stage copies only that server, the static files and public/,
# and runs as uid 1000. Build with `docker compose build`, not by hand.
FROM node:24-slim AS build
ARG PART
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
RUN corepack enable
WORKDIR /workspace
# The rewrite target next.config.ts bakes into the build.
ARG API_HOST=http://server:8000
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN mkdir -p "$PART/public" && pnpm --filter "$PART..." run build

FROM node:24-slim
ARG PART
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PART=${PART}
WORKDIR /app
COPY --from=build --chown=1000:1000 /workspace/${PART}/.next/standalone ./
COPY --from=build --chown=1000:1000 /workspace/${PART}/.next/static ./${PART}/.next/static
COPY --from=build --chown=1000:1000 /workspace/${PART}/public ./${PART}/public
USER 1000:1000
EXPOSE 3000
CMD ["sh", "-c", "exec node \"$PART/server.js\""]
