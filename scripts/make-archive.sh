#!/usr/bin/env bash
# Builds a tar.gz of the repository shaped like a codeload.github.com download:
# one top folder, project-templates-master/, holding every file that git
# tracks or that is untracked and not ignored. Uncommitted work is included on
# purpose, so verification sees what is on disk. Files tracked by git but
# deleted on disk are left out.
#
# Usage: scripts/make-archive.sh <output.tar.gz>
# Works with bsdtar (macOS) and GNU tar.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOP="project-templates-master"

if [ "$#" -ne 1 ]; then
  echo "usage: scripts/make-archive.sh <output.tar.gz>" >&2
  exit 2
fi

case "$1" in
  /*) OUT="$1" ;;
  *) OUT="$(pwd)/$1" ;;
esac

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/make-archive.XXXXXX")" || exit 1
cleanup() {
  rm -rf "$STAGE"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

mkdir -p "$STAGE/$TOP" || exit 1

# Keep only paths that exist on disk, one per line (names never hold newlines here).
(cd "$ROOT" && git ls-files -co --exclude-standard | sort -u | while IFS= read -r file; do
  if [ -e "$file" ] || [ -L "$file" ]; then printf '%s\n' "$file"; fi
done) >"$STAGE/files.txt" || exit 1

(cd "$ROOT" && tar -cf - -T "$STAGE/files.txt") | (cd "$STAGE/$TOP" && tar -xf -) || {
  echo "FAIL: could not stage the repository files" >&2
  exit 1
}

tar -czf "$OUT" -C "$STAGE" "$TOP" || {
  echo "FAIL: could not write $OUT" >&2
  exit 1
}
echo "archive $OUT ($(wc -l <"$STAGE/files.txt" | tr -d ' ') files)"
