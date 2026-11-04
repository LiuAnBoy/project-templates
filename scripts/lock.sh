#!/usr/bin/env bash
# Regenerates the lockfile of one or more rendered templates or overlays.
#
# Usage: scripts/lock.sh [--data] [<template-or-overlay-name>...]
#   package.json   -> pnpm install --lockfile-only   (writes pnpm-lock.yaml)
#   pyproject.toml -> uv lock                        (writes uv.lock)
# A name under overlays/ (for example next-antd or nest-postgres) is locked
# together with its base (the part before the first dash): the base template is
# copied to a temp directory, the overlay is extracted over it as a user would,
# the lockfile is generated there and stored in overlays/<name>/ as
# pnpm-lock.yaml for a Node base or uv.lock for a Python base. The overlay's
# existing lockfile, if any, is the starting point so unchanged versions stay.
# --data adds every data overlay that recipes.mjs generates to the names.
# Needs network access to the package registry. Run after render.mjs.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --data: add every data overlay named by recipes.mjs to the names given.
if [ "${1:-}" = "--data" ]; then
  shift
  data_names="$(node -e 'import(require("url").pathToFileURL(process.argv[1]).href).then((m) => console.log(Object.keys(m.dataOverlays).join("\n")))' \
    "$ROOT/scripts/recipes.mjs")" || { echo "FAIL: could not read the data overlays from recipes.mjs" >&2; exit 1; }
  for data_name in $data_names; do set -- "$@" "$data_name"; done
  if [ "$#" -eq 0 ]; then
    echo "no data overlays are defined in recipes.mjs"
    exit 0
  fi
fi

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/lock.sh [--data] [<template-or-overlay-name>...]" >&2
  exit 2
fi

TMP=""
cleanup() {
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then rm -rf "$TMP"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# lock_overlay <name>: lock an overlay together with its base in a temp copy.
# The base's manifest picks the tool: pnpm for package.json, uv for pyproject.toml.
lock_overlay() {
  name="$1"
  dir="$ROOT/overlays/$name"
  base="${name%%-*}"
  if [ ! -d "$ROOT/templates/$base" ]; then
    echo "FAIL $name: base template $ROOT/templates/$base does not exist" >&2
    return 1
  fi
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/lock-overlay.XXXXXX")" || return 1
  # The base's own lockfiles are dropped: the overlay's file, if present, comes next.
  (cd "$ROOT/templates/$base" && tar --exclude=node_modules --exclude=.next --exclude=dist \
    --exclude=.venv --exclude=__pycache__ --exclude=pnpm-lock.yaml --exclude=uv.lock -cf - .) |
    (cd "$TMP" && tar -xf -) || return 1
  (cd "$dir" && tar -cf - .) | (cd "$TMP" && tar -xf -) || return 1
  if [ -f "$TMP/package.json" ]; then
    echo "lock $name (pnpm, with base $base)"
    (cd "$TMP" && pnpm install --lockfile-only) || return 1
    cp "$TMP/pnpm-lock.yaml" "$dir/pnpm-lock.yaml" || return 1
  elif [ -f "$TMP/pyproject.toml" ]; then
    echo "lock $name (uv, with base $base)"
    (cd "$TMP" && uv lock) || return 1
    cp "$TMP/uv.lock" "$dir/uv.lock" || return 1
  else
    echo "FAIL $name: neither package.json nor pyproject.toml after extracting the overlay over $base" >&2
    return 1
  fi
  cleanup
  TMP=""
}

failed=0
for name in "$@"; do
  dir="$ROOT/templates/$name"
  if [ -d "$ROOT/overlays/$name" ] && [ ! -d "$dir" ]; then
    lock_overlay "$name" || { echo "FAIL $name: locking failed" >&2; failed=1; }
    cleanup
    TMP=""
    continue
  fi
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
