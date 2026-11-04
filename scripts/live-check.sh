#!/usr/bin/env bash
# Starts a template for real and asserts its behaviour.
#
# Usage: scripts/live-check.sh <name|directory>...
#   An argument containing a slash, or naming an existing directory, is checked
#   where it stands; any other argument resolves to templates/<name>.
#
# The target's nature is read from its manifests, in this order:
#   workspace  pnpm-workspace.yaml and contract/package.json
#              -> build contract, import it from Node, assert that the export
#                 `helloResponseSchema` parses a valid hello body and rejects
#                 invalid ones (needs an `exports` map so the package can import
#                 itself by name)
#   web        package.json with a `test:e2e` script
#              -> install, `playwright install chromium`, `pnpm run test:e2e`
#   server     package.json with a `start` script
#              -> install, `pnpm run build` if defined, `pnpm run start`
#   server     pyproject.toml with a Makefile `start` target
#              -> `uv sync --frozen`, `make start`
# A server is copied without any .env, started with an empty environment on
# port 8000 (LIVE_PORT overrides, also exported as PORT), and asserted over HTTP:
#   GET /api/v1/hello       200 and exactly the hello body
#   GET /api/health         200 and exactly {"status":"ok"} (outside the envelope)
#   GET an unknown route    404, "success": false, string payload.message
# A Node server is then started once more with a temporary .env holding
# TRUST_PROXY=loopback and RATE_LIMIT_MAX=1, and must count two loopback requests
# with different x-forwarded-for values as two clients.
# The check refuses to run when the port is already taken. Everything started
# is killed on exit. Only package installation touches the network.
# Environment: LIVE_PORT (default 8000), LIVE_TIMEOUT seconds (default 90).

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${LIVE_PORT:-8000}"
TIMEOUT="${LIVE_TIMEOUT:-90}"
HELLO='{"success":true,"payload":{"data":{"message":"hello world!!"}}}'

set -m # background servers get their own process group so the whole tree can be killed

TMP=""
SERVER_PID=""
LOG=""

# port_busy: succeed when something accepts connections on the port (IPv4 or IPv6).
port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && return 0
  (exec 3<>"/dev/tcp/::1/$PORT") 2>/dev/null && return 0
  return 1
}

# stop_server: terminate the started process group and wait for the port to free up.
stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill -TERM -- "-$SERVER_PID" 2>/dev/null
    i=0
    while kill -0 "$SERVER_PID" 2>/dev/null && [ "$i" -lt 20 ]; do
      sleep 0.25
      i=$((i + 1))
    done
    kill -KILL -- "-$SERVER_PID" 2>/dev/null
    { wait "$SERVER_PID"; } 2>/dev/null
    SERVER_PID=""
    i=0
    while port_busy && [ "$i" -lt 20 ]; do
      sleep 0.25
      i=$((i + 1))
    done
  fi
}

cleanup() {
  stop_server
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then rm -rf "$TMP"; fi
  TMP=""
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

# has_script <dir> <script>: succeed when package.json defines the script.
has_script() {
  node -e 'const p=require(process.argv[1]+"/package.json");process.exit(p.scripts&&p.scripts[process.argv[2]]?0:1)' "$1" "$2"
}

# has_target <dir> <target>: succeed when the Makefile defines the target.
has_target() {
  [ -f "$1/Makefile" ] && grep -Eq "^$2[[:space:]]*:" "$1/Makefile"
}

# nature <dir>: print workspace, web, node-server, python-server or unknown.
nature() {
  if [ -f "$1/pnpm-workspace.yaml" ] && [ -f "$1/contract/package.json" ]; then
    echo workspace
  elif [ -f "$1/package.json" ] && has_script "$1" test:e2e; then
    echo web
  elif [ -f "$1/package.json" ] && has_script "$1" start; then
    echo node-server
  elif [ -f "$1/pyproject.toml" ] && has_target "$1" start; then
    echo python-server
  else
    echo unknown
  fi
}

# step <label> <command...>: run a command in the temp copy.
step() {
  label="$1"
  shift
  echo "--- $label"
  (cd "$TMP" && CI=true "$@")
}

# start_server <command...>: start in the temp copy with an empty environment.
start_server() {
  LOG="$TMP/.live-check-server.log"
  port_env=""
  [ -n "${LIVE_PORT:-}" ] && port_env="PORT=$LIVE_PORT"
  # shellcheck disable=SC2086 # port_env is empty or a single NAME=value word
  (cd "$TMP" && exec env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" $port_env "$@") >"$LOG" 2>&1 </dev/null &
  SERVER_PID=$!
}

# wait_ready: wait until the server answers any HTTP response, or fail.
wait_ready() {
  i=0
  while [ "$i" -lt "$TIMEOUT" ]; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming ready; log tail:" >&2
      tail -n 40 "$LOG" >&2
      return 1
    fi
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/api/v1/hello")"
    [ "$code" != 000 ] && return 0
    sleep 1
    i=$((i + 1))
  done
  echo "server not ready after ${TIMEOUT}s; log tail:" >&2
  tail -n 40 "$LOG" >&2
  return 1
}

# assert_http: assert the hello body, the bare health body and the 404 failure envelope.
assert_http() {
  code="$(curl -s -o "$TMP/.live-body" -w '%{http_code}' --max-time 5 "http://localhost:$PORT/api/v1/hello")"
  body="$(cat "$TMP/.live-body")"
  if [ "$code" != 200 ] || [ "$body" != "$HELLO" ]; then
    echo "FAIL hello: status $code, body: $body" >&2
    echo "expected 200 and:   $HELLO" >&2
    return 1
  fi
  echo "ok   GET /api/v1/hello"
  code="$(curl -s -o "$TMP/.live-body" -w '%{http_code}' --max-time 5 "http://localhost:$PORT/api/health")"
  body="$(cat "$TMP/.live-body")"
  if [ "$code" != 200 ] || [ "$body" != '{"status":"ok"}' ]; then
    echo "FAIL health: status $code, body: $body" >&2
    echo 'expected 200 and:   {"status":"ok"}' >&2
    return 1
  fi
  echo "ok   GET /api/health"
  code="$(curl -s -o "$TMP/.live-body" -w '%{http_code}' --max-time 5 "http://localhost:$PORT/api/v1/__live_check_no_such_route__")"
  if [ "$code" != 404 ]; then
    echo "FAIL unknown route: expected 404, got $code, body: $(cat "$TMP/.live-body")" >&2
    return 1
  fi
  node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c)).on("end", () => {
      try {
        const b = JSON.parse(d);
        const ok = b.success === false && b.payload && typeof b.payload.message === "string" && b.payload.message.length > 0;
        process.exit(ok ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });
  ' <"$TMP/.live-body" || {
    echo "FAIL unknown route: 404 body is not the failure envelope: $(cat "$TMP/.live-body")" >&2
    return 1
  }
  echo "ok   unknown route answers the 404 failure envelope"
}

# run_server <install-and-start-description> : shared server flow after install.
run_server() {
  if port_busy; then
    echo "FAIL port $PORT is already in use; refusing to assert against a foreign process" >&2
    return 1
  fi
  start_server "$@"
  wait_ready || return 1
  assert_http
  rc=$?
  stop_server
  return "$rc"
}

# assert_env_file: a Node server must read `.env` before it builds its HTTP
# adapter. The temporary `.env` trusts loopback and allows one request per
# client, so two requests from loopback with different `x-forwarded-for` values
# both answer 200 only when TRUST_PROXY reached the adapter, and a repeat of the
# first answers 429 only when RATE_LIMIT_MAX did too.
assert_env_file() {
  if port_busy; then
    echo "FAIL port $PORT is already in use; refusing to assert against a foreign process" >&2
    return 1
  fi
  printf 'TRUST_PROXY=loopback\nRATE_LIMIT_MAX=1\n' >"$TMP/.env"
  start_server pnpm run start
  wait_ready || return 1
  rc=0
  first="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H 'x-forwarded-for: 203.0.113.1' "http://localhost:$PORT/api/v1/hello")"
  second="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H 'x-forwarded-for: 203.0.113.2' "http://localhost:$PORT/api/v1/hello")"
  repeat="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H 'x-forwarded-for: 203.0.113.1' "http://localhost:$PORT/api/v1/hello")"
  if [ "$first" != 200 ] || [ "$second" != 200 ] || [ "$repeat" != 429 ]; then
    echo "FAIL .env: TRUST_PROXY and RATE_LIMIT_MAX from .env did not reach the server" >&2
    echo "expected 200, 200, 429 for two forwarded clients and a repeat; got $first, $second, $repeat" >&2
    rc=1
  else
    echo "ok   .env reaches the HTTP adapter (TRUST_PROXY) and the limit (RATE_LIMIT_MAX)"
  fi
  stop_server
  rm -f "$TMP/.env"
  return "$rc"
}

# check_contract: workspace flow.
check_contract() {
  step "pnpm install --frozen-lockfile" pnpm install --frozen-lockfile || return 1
  step "build contract" pnpm --dir contract run build || return 1
  cat >"$TMP/contract/.live-check.mjs" <<'EOF'
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const mod = await import(pkg.name);
const schema = mod.helloResponseSchema;
assert.ok(schema && typeof schema.safeParse === 'function', 'contract must export helloResponseSchema');
const valid = { success: true, payload: { data: { message: 'hello world!!' } } };
assert.equal(schema.safeParse(valid).success, true, 'valid hello body must parse');
for (const bad of [{}, { success: true, payload: { data: { message: 42 } } }, { success: true }, null]) {
  assert.equal(schema.safeParse(bad).success, false, `invalid body must be rejected: ${JSON.stringify(bad)}`);
}
console.log('ok   contract schema parses a valid body and rejects invalid ones');
EOF
  echo "--- import contract from Node"
  (cd "$TMP/contract" && node .live-check.mjs)
}

# check_one <arg>: live-check one target; return non-zero on failure.
check_one() {
  arg="$1"
  dir="$(resolve "$arg")"
  if [ ! -d "$dir" ]; then
    echo "FAIL $arg: $dir does not exist (template not rendered yet?)" >&2
    return 1
  fi
  kind="$(nature "$dir")"
  if [ "$kind" = unknown ]; then
    echo "FAIL $arg: cannot tell what to start in $dir (need a workspace layout, a test:e2e script, a start script, or a pyproject.toml with a Makefile start target; not rendered yet?)" >&2
    return 1
  fi
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/live-check.XXXXXX")" || return 1
  (cd "$dir" && tar --exclude=node_modules --exclude=.venv --exclude=.next --exclude=dist \
    --exclude=.git --exclude=.env --exclude=__pycache__ --exclude=test-results \
    --exclude=playwright-report -cf - .) | (cd "$TMP" && tar -xf -) || {
    echo "FAIL $arg: could not copy $dir" >&2
    cleanup
    return 1
  }
  echo "=== $arg ($kind)"
  rc=0
  case "$kind" in
    workspace) check_contract || rc=1 ;;
    web)
      step "pnpm install --frozen-lockfile" pnpm install --frozen-lockfile &&
        step "playwright install chromium" pnpm exec playwright install chromium &&
        step "pnpm run test:e2e" pnpm run test:e2e || rc=1
      ;;
    node-server)
      step "pnpm install --frozen-lockfile" pnpm install --frozen-lockfile || rc=1
      if [ "$rc" -eq 0 ] && has_script "$TMP" build; then
        step "pnpm run build" pnpm run build || rc=1
      fi
      [ "$rc" -eq 0 ] && { run_server pnpm run start || rc=1; }
      [ "$rc" -eq 0 ] && { assert_env_file || rc=1; }
      ;;
    python-server)
      step "uv sync --frozen" uv sync --frozen || rc=1
      [ "$rc" -eq 0 ] && { run_server make start || rc=1; }
      ;;
  esac
  if [ "$rc" -ne 0 ] && [ -n "$LOG" ] && [ -f "$LOG" ]; then
    echo "server log tail:" >&2
    tail -n 40 "$LOG" >&2
  fi
  cleanup
  LOG=""
  if [ "$rc" -eq 0 ]; then echo "PASS $arg"; else echo "FAIL $arg" >&2; fi
  return "$rc"
}

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/live-check.sh <name|directory>..." >&2
  exit 2
fi

failed=0
for arg in "$@"; do
  check_one "$arg" || failed=1
done
exit "$failed"
