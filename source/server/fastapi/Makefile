.PHONY: dev start lint format format-check test

# Run with reload for local development.
dev:
	uv run --frozen uvicorn main:app --app-dir src --reload --port 8000

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
