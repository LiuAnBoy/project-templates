# FastAPI server image. The build stage installs the locked production
# dependencies into a virtual environment; the runtime stage copies that and
# the source, and runs as uid 1000. Build with `docker compose build`, not by hand.
FROM python:3.15-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

FROM python:3.15-slim
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/.venv ./.venv
COPY --chown=1000:1000 src ./src
USER 1000:1000
EXPOSE 8000
CMD ["python", "src/main.py"]
