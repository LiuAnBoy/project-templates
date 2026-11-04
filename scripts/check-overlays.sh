#!/usr/bin/env bash
# Verifies UI overlays the way a user applies them: from a codeload-shaped
# archive, with the exact extraction commands of the README.
#
# Usage: scripts/check-overlays.sh <overlay>...      (for example next-antd vite-mui)
# For each overlay, in an empty temp directory:
#   1. extract the base:    tar -xz --strip=2 project-templates-master/templates/<base>
#   2. enter it and extract the overlay over it:
#                           tar -xz --strip=3 project-templates-master/overlays/<overlay>
#   3. run check-template.sh, live-check.sh and check-docs.mjs on that directory.
# The base is the part of the overlay name before the first dash.
# Environment: ARCHIVE points at an existing archive instead of building one
# with make-archive.sh.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/check-overlays.sh <overlay>..." >&2
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

# check_one <overlay>: extract base and overlay, then run the three checks.
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
  bash "$ROOT/scripts/check-template.sh" "$project" || return 1
  bash "$ROOT/scripts/live-check.sh" "$project" || return 1
  node "$ROOT/scripts/check-docs.mjs" "$project" || return 1
  rm -rf "$dir"
  echo "PASS $overlay"
}

failed=0
for overlay in "$@"; do
  check_one "$overlay" || { echo "FAIL $overlay" >&2; failed=1; }
done
exit "$failed"
