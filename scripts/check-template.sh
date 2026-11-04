#!/usr/bin/env bash
# Verifies templates the way a user would receive them: copy to a temp dir,
# install from the committed lockfile, then run every quality script.
#
# Usage: scripts/check-template.sh <name|directory>...
#   An argument containing a slash, or naming an existing directory, is checked
#   where it stands; any other argument resolves to templates/<name>.
#
# Node targets (package.json), each run as `pnpm run <script>` after
# `pnpm install --frozen-lockfile`:
#   lint, format:check, typecheck, test, build
# Python targets (pyproject.toml), after `uv sync --frozen`, as `make <target>`:
#   lint, format-check, typecheck, test
# Makefile target names are hyphenated; a colon in a target name is not valid.
#
# A missing script or target fails the check unless it appears in the explicit
# allowlists below. Build leftovers and any .env are not copied.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Explicit allowlists (space-separated). Anything not listed here is required.
NODE_OPTIONAL_SCRIPTS=""
PY_OPTIONAL_TARGETS="typecheck"

NODE_SCRIPTS="lint format:check typecheck test build"
PY_TARGETS="lint format-check typecheck test"

TMP=""
cleanup() {
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then rm -rf "$TMP"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# resolve <arg>: print the absolute directory the argument refers to.
resolve() {
  case "$1" in
    */*) (cd "$1" 2>/dev/null && pwd) || echo "$1" ;;
    *)
      if [ -d "$1" ]; then (cd "$1" && pwd); else echo "$ROOT/templates/$1"; fi
      ;;
  esac
}

# in_list <word> <list>: succeed when the word is in the space-separated list.
in_list() {
  case " $2 " in *" $1 "*) return 0 ;; esac
  return 1
}

# has_script <dir> <script>: succeed when package.json defines the script.
has_script() {
  node -e 'const p=require(process.argv[1]+"/package.json");process.exit(p.scripts&&p.scripts[process.argv[2]]?0:1)' "$1" "$2"
}

# has_target <dir> <target>: succeed when the Makefile defines the target.
has_target() {
  [ -f "$1/Makefile" ] && grep -Eq "^$2[[:space:]]*:" "$1/Makefile"
}

# step <label> <command...>: run a command in the temp copy.
step() {
  label="$1"
  shift
  echo "--- $label"
  (cd "$TMP" && CI=true "$@")
}

# check_one <arg>: verify one target; return non-zero on any failure.
check_one() {
  arg="$1"
  dir="$(resolve "$arg")"
  if [ ! -d "$dir" ]; then
    echo "FAIL $arg: $dir does not exist (template not rendered yet?)" >&2
    return 1
  fi
  if [ -f "$dir/package.json" ]; then
    kind=node
  elif [ -f "$dir/pyproject.toml" ]; then
    kind=python
  else
    echo "FAIL $arg: no package.json or pyproject.toml in $dir (template not rendered yet?)" >&2
    return 1
  fi

  TMP="$(mktemp -d "${TMPDIR:-/tmp}/check-template.XXXXXX")" || return 1
  (cd "$dir" && tar --exclude=node_modules --exclude=.venv --exclude=.next --exclude=dist \
    --exclude=.git --exclude=.env --exclude=__pycache__ --exclude=test-results \
    --exclude=playwright-report -cf - .) | (cd "$TMP" && tar -xf -) || {
    echo "FAIL $arg: could not copy $dir" >&2
    return 1
  }

  echo "=== $arg ($kind) in $TMP"
  rc=0
  if [ "$kind" = node ]; then
    if [ ! -f "$TMP/pnpm-lock.yaml" ]; then
      echo "FAIL $arg: pnpm-lock.yaml missing (run scripts/lock.sh)" >&2
      return 1
    fi
    step "pnpm install --frozen-lockfile" pnpm install --frozen-lockfile || rc=1
    if [ "$rc" -eq 0 ]; then
      for s in $NODE_SCRIPTS; do
        if has_script "$TMP" "$s"; then
          step "pnpm run $s" pnpm run "$s" || { rc=1; echo "FAIL $arg: pnpm run $s" >&2; break; }
        elif in_list "$s" "$NODE_OPTIONAL_SCRIPTS"; then
          echo "--- skip $s (allowlisted)"
        else
          echo "FAIL $arg: package.json has no \"$s\" script" >&2
          rc=1
          break
        fi
      done
    else
      echo "FAIL $arg: pnpm install --frozen-lockfile" >&2
    fi
  else
    if [ ! -f "$TMP/uv.lock" ]; then
      echo "FAIL $arg: uv.lock missing (run scripts/lock.sh)" >&2
      return 1
    fi
    step "uv sync --frozen" uv sync --frozen || { rc=1; echo "FAIL $arg: uv sync --frozen" >&2; }
    if [ "$rc" -eq 0 ]; then
      for t in $PY_TARGETS; do
        if has_target "$TMP" "$t"; then
          step "make $t" make "$t" || { rc=1; echo "FAIL $arg: make $t" >&2; break; }
        elif in_list "$t" "$PY_OPTIONAL_TARGETS"; then
          echo "--- skip $t (allowlisted)"
        else
          echo "FAIL $arg: Makefile has no \"$t\" target" >&2
          rc=1
          break
        fi
      done
    fi
  fi
  cleanup
  TMP=""
  [ "$rc" -eq 0 ] && echo "PASS $arg"
  return "$rc"
}

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/check-template.sh <name|directory>..." >&2
  exit 2
fi

failed=0
for arg in "$@"; do
  check_one "$arg" || failed=1
  cleanup
  TMP=""
done
exit "$failed"
