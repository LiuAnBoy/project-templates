#!/usr/bin/env bash
# Verifies overlays the way a user applies them: from a codeload-shaped
# archive, with the exact extraction commands of the README.
#
# Usage: scripts/check-overlays.sh [--static | --docker] <overlay>...
#        (for example next-antd vite-mui nest-postgres-redis)
# For each overlay, in an empty temp directory:
#   1. extract the base:    tar -xz --strip=2 project-templates-master/templates/<base>
#   2. enter it and extract the overlay over it:
#                           tar -xz --strip=3 project-templates-master/overlays/<overlay>
#   3. run check-template.sh, live-check.sh and check-docs.mjs on that directory.
# The base is the part of the overlay name before the first dash.
# A data overlay is one whose base is a backend (nest, fastify, fastapi). It
# needs settings and often a store, so an empty-environment live-check cannot
# start it: step 3 runs check-template.sh and check-docs.mjs, then
# check-store.sh, which boots it from its own `.env` with the services running.
# check-store.sh runs only for the overlays in DATA_LIVE of recipes.mjs; the
# others are covered by those and get the two static checks.
# --static runs only check-template.sh and check-docs.mjs, for any overlay: no
# process is started and no service is needed.
# --docker extracts the same way and runs only check-docker.sh on the result, under
# the overlay's own heading, so the result is named after the overlay. It cannot be
# combined with --static.
# Exit codes: 0 every check ran and passed; 1 a check failed; 2 usage; 3 a real-store
# check could not run because Docker is absent, so the result is incomplete, never
# a pass (a failure of another overlay still makes the exit 1).
# Environment: ARCHIVE points at an existing archive instead of building one
# with make-archive.sh.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

STATIC=0
DOCKER=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --static) STATIC=1; shift ;;
    --docker) DOCKER=1; shift ;;
    --) shift; break ;;
    -*)
      echo "usage: scripts/check-overlays.sh [--static | --docker] <overlay>..." >&2
      exit 2
      ;;
    *) break ;;
  esac
done

if [ "$#" -eq 0 ] || { [ "$STATIC" -eq 1 ] && [ "$DOCKER" -eq 1 ]; }; then
  echo "usage: scripts/check-overlays.sh [--static | --docker] <overlay>..." >&2
  exit 2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/check-overlays.XXXXXX")" || exit 1
cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if [ -n "${ARCHIVE:-}" ]; then
  ARCH="$ARCHIVE"
else
  ARCH="$WORK/archive.tar.gz"
  bash "$ROOT/scripts/make-archive.sh" "$ARCH" || exit 1
fi

# is_data_base <base>: succeed for a backend, the base of every data overlay.
is_data_base() {
  case "$1" in
    nest | fastify | fastapi) return 0 ;;
    *) return 1 ;;
  esac
}

# live_overlays: print the data overlays that run against real services, one per line.
live_overlays() {
  node -e 'import(require("url").pathToFileURL(process.argv[1]).href).then((m) => console.log(m.DATA_LIVE.join("\n")))' \
    "$ROOT/scripts/recipes.mjs"
}

# check_one <overlay>: extract base and overlay, then run the checks. Returns 0 on
# a pass, 1 on a failure and 3 when a real-store check could not run (no Docker).
check_one() {
  overlay="$1"
  base="${overlay%%-*}"
  case "$overlay" in
    *-*) ;;
    *)
      echo "FAIL $overlay: not an overlay name (expected <base>-<library>)" >&2
      return 1
      ;;
  esac
  dir="$WORK/$overlay"
  mkdir -p "$dir" || return 1
  echo "=== $overlay (base $base)"
  # The base lands in $dir/$base, as the README's `cd <name>` step expects.
  (cd "$dir" && cat "$ARCH" | tar -xz --strip=2 "project-templates-master/templates/$base") || {
    echo "FAIL $overlay: could not extract the base template" >&2
    return 1
  }
  project="$dir/$base"
  [ -d "$project" ] || { echo "FAIL $overlay: base extracted no $base directory" >&2; return 1; }
  (cd "$project" && cat "$ARCH" | tar -xz --strip=3 "project-templates-master/overlays/$overlay") || {
    echo "FAIL $overlay: could not extract the overlay" >&2
    return 1
  }
  if [ "$DOCKER" -eq 1 ]; then
    named="$dir/$overlay"
    mv "$project" "$named" || return 1
    bash "$ROOT/scripts/check-docker.sh" "$named"
    rc=$?
    if [ "$rc" -ne 0 ]; then return "$rc"; fi
    rm -rf "$dir"
    echo "PASS $overlay"
    return 0
  fi
  bash "$ROOT/scripts/check-template.sh" "$project" || return 1
  if is_data_base "$base"; then
    node "$ROOT/scripts/check-docs.mjs" "$project" || return 1
    if [ "$STATIC" -eq 0 ]; then
      live="$(live_overlays)" || { echo "FAIL $overlay: could not read DATA_LIVE from recipes.mjs" >&2; return 1; }
      if printf '%s\n' "$live" | grep -qx -- "$overlay"; then
        bash "$ROOT/scripts/check-store.sh" "$project" "$overlay"
        rc=$?
        if [ "$rc" -ne 0 ]; then return "$rc"; fi
      else
        echo "static checks only: every file of $overlay runs live in another overlay"
      fi
    fi
  else
    if [ "$STATIC" -eq 0 ]; then
      bash "$ROOT/scripts/live-check.sh" "$project" || return 1
    fi
    node "$ROOT/scripts/check-docs.mjs" "$project" || return 1
  fi
  rm -rf "$dir"
  echo "PASS $overlay"
}

failed=0
incomplete=0
for overlay in "$@"; do
  check_one "$overlay"
  rc=$?
  case "$rc" in
    0) ;;
    3) incomplete=1 ;;
    *) echo "FAIL $overlay" >&2; failed=1 ;;
  esac
done
if [ "$failed" -ne 0 ]; then exit 1; fi
if [ "$incomplete" -ne 0 ]; then exit 3; fi
exit 0
