#!/usr/bin/env bash
# Regenerates the lockfile of one or more rendered templates.
#
# Usage: scripts/lock.sh <template-name>...
#   package.json   -> pnpm install --lockfile-only   (writes pnpm-lock.yaml)
#   pyproject.toml -> uv lock                        (writes uv.lock)
# Needs network access to the package registry. Run after render.mjs.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/lock.sh <template-name>..." >&2
  exit 2
fi

failed=0
for name in "$@"; do
  dir="$ROOT/templates/$name"
  if [ ! -d "$dir" ]; then
    echo "FAIL $name: $dir does not exist (render it first: node scripts/render.mjs --only $name)" >&2
    failed=1
    continue
  fi
  if [ -f "$dir/package.json" ]; then
    echo "lock $name (pnpm)"
    (cd "$dir" && pnpm install --lockfile-only) || { echo "FAIL $name: pnpm failed" >&2; failed=1; }
  elif [ -f "$dir/pyproject.toml" ]; then
    echo "lock $name (uv)"
    (cd "$dir" && uv lock) || { echo "FAIL $name: uv failed" >&2; failed=1; }
  else
    echo "FAIL $name: neither package.json nor pyproject.toml in $dir" >&2
    failed=1
  fi
done
exit "$failed"
