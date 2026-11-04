#!/usr/bin/env bash
# Regenerates the lockfile of one or more rendered templates or overlays.
#
# Usage: scripts/lock.sh <template-or-overlay-name>...
#   package.json   -> pnpm install --lockfile-only   (writes pnpm-lock.yaml)
#   pyproject.toml -> uv lock                        (writes uv.lock)
# A name under overlays/ (for example next-antd) is locked together with its
# base (the part before the first dash): the base template is copied to a temp
# directory, the overlay is extracted over it as a user would, the lockfile is
# generated there and stored in overlays/<name>/pnpm-lock.yaml. The overlay's
# existing lockfile, if any, is the starting point so unchanged versions stay.
# Needs network access to the package registry. Run after render.mjs.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/lock.sh <template-or-overlay-name>..." >&2
  exit 2
fi

TMP=""
cleanup() {
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then rm -rf "$TMP"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# lock_overlay <name>: lock an overlay together with its base in a temp copy.
lock_overlay() {
  name="$1"
  dir="$ROOT/overlays/$name"
  base="${name%%-*}"
  if [ ! -d "$ROOT/templates/$base" ]; then
    echo "FAIL $name: base template $ROOT/templates/$base does not exist" >&2
    return 1
  fi
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/lock-overlay.XXXXXX")" || return 1
  # The base's own lockfile is dropped: the overlay's file, if present, comes next.
  (cd "$ROOT/templates/$base" && tar --exclude=node_modules --exclude=.next --exclude=dist \
    --exclude=pnpm-lock.yaml -cf - .) | (cd "$TMP" && tar -xf -) || return 1
  (cd "$dir" && tar -cf - .) | (cd "$TMP" && tar -xf -) || return 1
  echo "lock $name (pnpm, with base $base)"
  (cd "$TMP" && pnpm install --lockfile-only) || return 1
  cp "$TMP/pnpm-lock.yaml" "$dir/pnpm-lock.yaml" || return 1
  cleanup
  TMP=""
}

failed=0
for name in "$@"; do
  dir="$ROOT/templates/$name"
  if [ -d "$ROOT/overlays/$name" ] && [ ! -d "$dir" ]; then
    lock_overlay "$name" || { echo "FAIL $name: pnpm failed" >&2; failed=1; }
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
