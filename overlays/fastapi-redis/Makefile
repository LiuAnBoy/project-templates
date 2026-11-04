.PHONY: dev start lint format format-check test

# Run with reload for local development.
dev:
	uv run --frozen uvicorn main:app --app-dir src --reload --port 8000 --no-proxy-headers --no-access-log

# Run the server the way a deployment does.
start:
	uv run --frozen python src/main.py

lint:
	uv run --frozen ruff check .

format:
	uv run --frozen ruff format .
	uv run --frozen ruff check --fix .

format-check:
	uv run --frozen ruff format --check .

test:
	uv run --frozen pytest

.PHONY: test-integration

# Run the store tests against the services of .env (start docker-compose.dev.yml first).
test-integration:
	uv run --frozen pytest tests_integration
