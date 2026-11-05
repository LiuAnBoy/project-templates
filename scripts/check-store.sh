#!/usr/bin/env bash
# Checks what only a real store can prove, for one extracted data overlay.
#
# Usage: scripts/check-store.sh <project-dir> [label]
#   <project-dir> is a base template with a data overlay extracted over it (what
#   check-overlays.sh builds). It is copied to a temp directory and never
#   changed. [label] names the overlay in messages (default: the directory name).
#
# Steps, in order, all in the copy:
#   1. .env: the whole `.env.example`, with only the ports changed to 15432
#      (PostgreSQL) and 16379 (Redis), in the *_PORT lines and inside the URLs,
#      so every line of every block is under test and compose and the server
#      read the same file.
#   2. Services: `docker compose -f docker-compose.dev.yml -p <unique> up -d
#      --wait` validates the joined file and the healthchecks. A trap runs
#      `down -v`. A taken port fails before anything starts.
#   3. Store tests: `pnpm run test:integration` (Node) or `make test-integration`
#      (Python), with `.env` in their environment.
#   4. Lifecycle: add a throwaway table, generate a migration, the project's lint
#      and format check pass over it, status lists it, migrate prints it, status
#      is empty, a second migrate is a no-op. Only when the project has `db:migrate`
#      (Node) or a `db-migrate` target (Python).
#   5. Empty environment: the server exits non-zero and names every connection
#      variable; then with HOST set to a sentinel and the settings still missing,
#      the same, and the sentinel is not in the output. Each connection URL made
#      malformed in turn (a port that is no number): the same, one setting named at
#      a time, and no part of the value in the output.
#   6. Boot: live-check.sh boots from `.env` after migrating (LIVE_DOTENV and
#      LIVE_PREPARE) and asserts hello, the 404 and health.
#   7. Store down at startup: with each service stopped in turn, or on SQLite
#      with the path wrong, the server exits non-zero within its bound, the
#      output names the dependency and holds no URL, password or SQLite path
#      from `.env`, and on SQLite no file appears.
#   8. Outage after startup: with the server up, stopping a service makes health
#      answer 503 {"status":"unavailable"} within its bound (with Redis, hello
#      answers the 503 failure envelope too); starting it again makes health
#      answer 200, and the process never ended.
# A project with no compose file (SQLite alone) skips steps 2 and 8.
#
# What the script assumes of an overlay (the contract its layers meet):
#   - `.env.example` lines are NAME=value; the connection settings are the
#     NAME_URL lines not starting with TEST_; POSTGRES_PORT and REDIS_PORT are the
#     host ports of compose; a DATABASE_URL without `://` is a SQLite path.
#   - Node: scripts install via the lockfile, `build`, `start`, `test:integration`,
#     `db:generate`, `db:migrate`, `db:status`; the schema directory and the
#     migration folder are the NODE_* values below. Python: Makefile targets
#     `test-integration`, `start`, `db-generate`, `db-migrate`, `db-status`; the
#     models package and the migration folder are the PY_* values below.
#   - db:status and db:migrate say "nothing pending" in one of the words of
#     NOTHING_RE when there is no work (a zero counts only when no digit or
#     identifier character follows it), and the status output names a pending
#     migration by its tag (Node: the file name; Python: the revision id).
#
# Exit codes: 0 every check ran and passed; 1 a check failed; 2 usage; 3 Docker is
# absent or its daemon does not answer, so the check is incomplete and prints
# `INCOMPLETE <label>: needs Docker; no real-store check ran`. Exit 3 is never a pass.
# Environment: LIVE_PORT (server port, default 8000), STORE_BOUND (seconds a server
# gets to exit at startup, default 30), HEALTH_BOUND (seconds for health to change
# state, default 20), LIVE_TIMEOUT (seconds for a server to become ready, default 90).
# Needs network access for installs and image pulls.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_PORT=15432
REDIS_PORT=16379
SERVER_PORT="${LIVE_PORT:-8000}"
STORE_BOUND="${STORE_BOUND:-30}"
HEALTH_BOUND="${HEALTH_BOUND:-20}"
READY_TIMEOUT="${LIVE_TIMEOUT:-90}"

# Where an overlay keeps the pieces the lifecycle step writes into. Both layouts
# are defined by the store layers; change them here if a layer moves.
# The probe's export in the schema entry uses a `.js` specifier, which nodenext
# requires. drizzle-kit 0.31.11 loads such an entry (tried with `generate` on the
# overlays' empty entry plus the probe), so drizzle.config.ts names the entry file
# and needs no special reading of the folder.
NODE_SCHEMA_DIR="src/db/schema"
NODE_MIGRATIONS_GLOB="drizzle/*.sql"
PY_MODELS_DIR="src/db/models"
PY_MIGRATIONS_GLOB="alembic/versions/*.py"
NOTHING_RE='no pending|nothing to|nothing pending|up to date|up-to-date|no-op|no migrations|pending[^0-9]*0([^0-9A-Za-z_]|$)|(^|[^0-9A-Za-z_])0 pending'

set -m # a background server gets its own process group so the whole tree can be killed

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: scripts/check-store.sh <project-dir> [label]" >&2
  exit 2
fi
SRC="$(cd "$1" 2>/dev/null && pwd)" || {
  echo "usage: scripts/check-store.sh <project-dir> [label]: $1 is not a directory" >&2
  exit 2
}
LABEL="${2:-$(basename "$SRC")}"

# docker_ready: succeed when a docker binary exists and its daemon answers in time.
docker_ready() {
  command -v docker >/dev/null 2>&1 || return 1
  docker info >/dev/null 2>&1 &
  info_pid=$!
  i=0
  while kill -0 "$info_pid" 2>/dev/null; do
    if [ "$i" -ge 150 ]; then
      kill -KILL "$info_pid" 2>/dev/null
      { wait "$info_pid"; } 2>/dev/null
      return 1
    fi
    sleep 0.1
    i=$((i + 1))
  done
  wait "$info_pid"
}

# A compose file means a service to start: without Docker nothing real can run.
if [ -f "$SRC/docker-compose.dev.yml" ] && ! docker_ready; then
  echo "INCOMPLETE $LABEL: needs Docker; no real-store check ran" >&2
  exit 3
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/check-store.XXXXXX")" || exit 1
PROJ="$WORK/project"
COMPOSE_PROJECT="ptcheck$$${RANDOM}"
COMPOSE_STARTED=0
SERVER_PID=""
BOUND_RC=0
RUN_ENV=()

# port_busy <port>: succeed when something accepts connections on the port.
port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0
  (exec 3<>"/dev/tcp/::1/$1") 2>/dev/null && return 0
  return 1
}

# kill_group <pid>: terminate a process group and reap it.
kill_group() {
  kill -TERM -- "-$1" 2>/dev/null
  i=0
  while kill -0 "$1" 2>/dev/null && [ "$i" -lt 20 ]; do
    sleep 0.25
    i=$((i + 1))
  done
  kill -KILL -- "-$1" 2>/dev/null
  { wait "$1"; } 2>/dev/null
}

# stop_server: stop the server started by start_server.
stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill_group "$SERVER_PID"
    SERVER_PID=""
  fi
}

cleanup() {
  stop_server
  if [ "$COMPOSE_STARTED" -eq 1 ] && [ -d "$PROJ" ]; then
    (cd "$PROJ" && docker compose -f docker-compose.dev.yml -p "$COMPOSE_PROJECT" down -v >/dev/null 2>&1)
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# fail <message>: report a failed assertion and return 1.
fail() {
  echo "FAIL $LABEL: $1" >&2
  return 1
}

# fail_log <log> <message>: print the tail of a server log, then report the failure.
# The log lives in a directory the exit trap removes, so its path is never named.
fail_log() {
  echo "server output, last lines:" >&2
  tail -n 40 "$1" >&2
  fail "$2"
}

# say <message>: print one passed assertion.
say() {
  echo "ok   $1"
}

# has_script <script>: succeed when package.json defines the script.
has_script() {
  node -e 'const p=require(process.argv[1]+"/package.json");process.exit(p.scripts&&p.scripts[process.argv[2]]?0:1)' "$PROJ" "$1"
}

# has_target <target>: succeed when the Makefile defines the target.
has_target() {
  [ -f "$PROJ/Makefile" ] && grep -Eq "^$1[[:space:]]*:" "$PROJ/Makefile"
}

# env_value <file> <name>: print the value of NAME in a dotenv file.
env_value() {
  grep -E "^$2=" "$1" | head -n 1 | cut -d= -f2-
}

# project_run <command...>: run in the project with `.env` added to the environment.
project_run() {
  dotenv_args=()
  while IFS= read -r line; do dotenv_args+=("$line"); done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$PROJ/.env")
  (cd "$PROJ" && CI=true env "${dotenv_args[@]}" "$@")
}

# run_bounded <seconds> <log> <command...>: run in the project with an empty
# environment (PATH, HOME, TMPDIR, PORT and RUN_ENV only), at most that long. Sets
# BOUND_RC to the exit status, or 124 when it was still running and was killed.
run_bounded() {
  secs="$1"
  log="$2"
  shift 2
  (cd "$PROJ" && exec env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" PORT="$SERVER_PORT" "${RUN_ENV[@]}" "$@") >"$log" 2>&1 </dev/null &
  bound_pid=$!
  i=0
  limit=$((secs * 5))
  while kill -0 "$bound_pid" 2>/dev/null; do
    if [ "$i" -ge "$limit" ]; then
      kill_group "$bound_pid"
      BOUND_RC=124
      return 0
    fi
    sleep 0.2
    i=$((i + 1))
  done
  { wait "$bound_pid"; } 2>/dev/null
  BOUND_RC=$?
  return 0
}

# start_server <log>: start the server from `.env` in the background.
start_server() {
  (cd "$PROJ" && exec env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" PORT="$SERVER_PORT" $START_CMD) >"$1" 2>&1 </dev/null &
  SERVER_PID=$!
}

# http_code <path> [max-seconds]: print the status code of GET on the server (curl gives
# up after at most 5 seconds, or the given time), 000 when it does not answer.
http_code() {
  curl -s -o "$WORK/body" -w '%{http_code}' --max-time "${2:-5}" "http://localhost:$SERVER_PORT$1"
}

# wait_health <code> <seconds>: succeed when /api/health answers that code before the
# deadline; each request is cut off at the time left.
wait_health() {
  deadline=$((SECONDS + $2))
  while :; do
    left=$((deadline - SECONDS))
    [ "$left" -gt 0 ] || return 1
    [ "$left" -gt 5 ] && left=5
    if [ "$(http_code /api/health "$left")" = "$1" ]; then return 0; fi
    kill -0 "$SERVER_PID" 2>/dev/null || return 1
    sleep 0.5
  done
}

# health_fail <message>: report a health wait that failed, with the server log, and say
# whether the server had exited or was still running (a timeout).
health_fail() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    fail_log "$WORK/outage.log" "$1 (the server was still running: a timeout)"
  else
    { wait "$SERVER_PID"; } 2>/dev/null
    exit_status=$?
    SERVER_PID=""
    fail_log "$WORK/outage.log" "$1 (the server exited with status $exit_status)"
  fi
}

# leak_values: print every value of the project's `.env` that must never reach the output.
leak_values() {
  grep -E '^[A-Za-z_][A-Za-z0-9_]*_URL=' "$PROJ/.env" | cut -d= -f2-
  grep -E '^[A-Za-z_]*PASSWORD[A-Za-z_]*=' "$PROJ/.env" | cut -d= -f2-
  grep -E '^[A-Za-z_][A-Za-z0-9_]*_URL=.*://[^:/@]*:[^@]+@' "$PROJ/.env" |
    sed -E 's#^[^=]*=[^:]*://[^:/@]*:([^@]+)@.*#\1#'
}

# assert_no_leak <log> <extra-value>...: fail when the log holds a secret of `.env`.
assert_no_leak() {
  log="$1"
  shift
  for value in $(leak_values) "$@"; do
    [ -n "$value" ] || continue
    if grep -Fq -- "$value" "$log"; then
      fail_log "$log" "the output holds a value from .env (a URL, a password or a path)" || return 1
    fi
  done
  return 0
}

# --- the steps -----------------------------------------------------------------

# prepare: copy the project, pick the toolchain and read the facts the steps need.
prepare() {
  mkdir -p "$PROJ" || return 1
  (cd "$SRC" && tar --exclude=node_modules --exclude=.venv --exclude=.next --exclude=dist \
    --exclude=.git --exclude=.env --exclude=__pycache__ --exclude=test-results \
    --exclude=playwright-report -cf - .) | (cd "$PROJ" && tar -xf -) || fail "could not copy $SRC" || return 1
  echo "=== $LABEL (real store)"
  if [ -f "$PROJ/package.json" ]; then
    KIND=node
    START_CMD="pnpm run start"
  elif [ -f "$PROJ/pyproject.toml" ]; then
    KIND=python
    START_CMD="make start"
  else
    fail "neither package.json nor pyproject.toml in $SRC" || return 1
  fi
  [ -f "$PROJ/.env.example" ] || { fail ".env.example is missing" || return 1; }
  HAS_COMPOSE=0
  [ -f "$PROJ/docker-compose.dev.yml" ] && HAS_COMPOSE=1
  HAS_DB=0
  if [ "$KIND" = node ]; then has_script db:migrate && HAS_DB=1; else has_target db-migrate && HAS_DB=1; fi
  return 0
}

# step1_env: write `.env` from `.env.example`, changing only the ports.
step1_env() {
  echo "--- 1. .env"
  sed -E \
    -e "s/^POSTGRES_PORT=.*/POSTGRES_PORT=$PG_PORT/" \
    -e "s/^REDIS_PORT=.*/REDIS_PORT=$REDIS_PORT/" \
    -e "/_PORT=/!s/:5432([^0-9]|\$)/:$PG_PORT\\1/g" \
    -e "/_PORT=/!s/:6379([^0-9]|\$)/:$REDIS_PORT\\1/g" \
    "$PROJ/.env.example" >"$PROJ/.env" || return 1
  CONN_VARS="$(grep -E '^[A-Za-z_][A-Za-z0-9_]*_URL=' "$PROJ/.env" | grep -v '^TEST_' | cut -d= -f1)"
  [ -n "$CONN_VARS" ] || { fail ".env.example holds no connection setting (a NAME_URL line)" || return 1; }
  SQLITE_PATH=""
  database_url="$(env_value "$PROJ/.env" DATABASE_URL)"
  case "$database_url" in
    "") ;;
    *://*) ;;
    *) SQLITE_PATH="$database_url" ;;
  esac
  say ".env written from .env.example with the ports $PG_PORT and $REDIS_PORT"
}

# step2_services: start the compose services and wait for their healthchecks.
step2_services() {
  [ "$HAS_COMPOSE" -eq 1 ] || { echo "--- 2. services: none (no compose file)"; return 0; }
  echo "--- 2. services"
  for port in $(grep -E '^[A-Za-z_]+_PORT=[0-9]+$' "$PROJ/.env" | cut -d= -f2); do
    if port_busy "$port"; then fail "port $port is already in use; refusing to start the services" || return 1; fi
  done
  COMPOSE_STARTED=1
  (cd "$PROJ" && docker compose -f docker-compose.dev.yml -p "$COMPOSE_PROJECT" up -d --wait) ||
    { fail "docker compose up --wait failed" || return 1; }
  SERVICES="$(cd "$PROJ" && docker compose -f docker-compose.dev.yml -p "$COMPOSE_PROJECT" config --services)" ||
    { fail "docker compose config failed" || return 1; }
  say "services up and healthy: $(echo $SERVICES)"
}

# compose_do <args...>: run docker compose against the project's file.
compose_do() {
  (cd "$PROJ" && docker compose -f docker-compose.dev.yml -p "$COMPOSE_PROJECT" "$@")
}

# step3_tests: install, build and run the store tests.
step3_tests() {
  echo "--- 3. store tests"
  if [ "$KIND" = node ]; then
    (cd "$PROJ" && CI=true pnpm install --frozen-lockfile) || { fail "pnpm install failed" || return 1; }
    project_run pnpm run test:integration || { fail "pnpm run test:integration failed" || return 1; }
  else
    (cd "$PROJ" && CI=true uv sync --frozen) || { fail "uv sync failed" || return 1; }
    project_run make test-integration || { fail "make test-integration failed" || return 1; }
  fi
  say "store tests passed"
}

# write_probe_table: add a throwaway table to the copy's schema.
write_probe_table() {
  if [ "$KIND" = node ]; then
    mkdir -p "$PROJ/$NODE_SCHEMA_DIR" || return 1
    if [ -n "$SQLITE_PATH" ]; then
      cat >"$PROJ/$NODE_SCHEMA_DIR/check_probe.ts" <<'EOF'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const checkProbe = sqliteTable('check_probe', {
  id: text('id').primaryKey(),
});
EOF
    else
      cat >"$PROJ/$NODE_SCHEMA_DIR/check_probe.ts" <<'EOF'
import { pgTable, text } from 'drizzle-orm/pg-core';

export const checkProbe = pgTable('check_probe', {
  id: text('id').primaryKey(),
});
EOF
    fi
    if [ -f "$PROJ/$NODE_SCHEMA_DIR/index.ts" ]; then
      printf "\nexport * from './check_probe.js';\n" >>"$PROJ/$NODE_SCHEMA_DIR/index.ts"
    fi
  else
    mkdir -p "$PROJ/$PY_MODELS_DIR" || return 1
    cat >"$PROJ/$PY_MODELS_DIR/check_probe.py" <<'EOF'
"""A throwaway table that check-store.sh adds to its copy."""

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class CheckProbe(Base):
    """One column, so the generated migration has something to create."""

    __tablename__ = "check_probe"
    id: Mapped[str] = mapped_column(String, primary_key=True)
EOF
    if [ -f "$PROJ/$PY_MODELS_DIR/__init__.py" ]; then
      printf '\nfrom db.models import check_probe as check_probe  # noqa: F401\n' >>"$PROJ/$PY_MODELS_DIR/__init__.py"
    fi
  fi
}

# migration_files: list the generated migration files of the copy, sorted.
migration_files() {
  if [ "$KIND" = node ]; then glob="$NODE_MIGRATIONS_GLOB"; else glob="$PY_MIGRATIONS_GLOB"; fi
  (cd "$PROJ" && ls -1 $glob 2>/dev/null | sort)
}

# lifecycle_run <label> <node-script> <make-target>: run a lifecycle command, keep its output in $OUT.
lifecycle_run() {
  if [ "$KIND" = node ]; then
    OUT="$(project_run pnpm run "$2" 2>&1)"
  else
    OUT="$(project_run make "$3" 2>&1)"
  fi
  LIFECYCLE_RC=$?
  echo "$OUT" | sed 's/^/     | /'
}

# step4_lifecycle: generate, status, migrate, status, migrate again.
step4_lifecycle() {
  if [ "$HAS_DB" -ne 1 ]; then echo "--- 4. lifecycle: none (no database)"; return 0; fi
  echo "--- 4. lifecycle"
  before="$(migration_files)"
  write_probe_table || { fail "could not write the throwaway table" || return 1; }
  lifecycle_run generate db:generate db-generate
  [ "$LIFECYCLE_RC" -eq 0 ] || { fail "generate failed" || return 1; }
  created="$(printf '%s\n' "$before" | diff - <(migration_files) | sed -n 's/^> //p')"
  [ -n "$created" ] || { fail "generate wrote no migration file" || return 1; }
  if [ "$KIND" = node ]; then
    tag="$(basename "$(echo "$created" | head -n 1)" .sql)"
  else
    tag="$(sed -n "s/^revision[^=]*= *['\"]\\([^'\"]*\\)['\"].*/\\1/p" "$PROJ/$(echo "$created" | head -n 1)" | head -n 1)"
  fi
  [ -n "$tag" ] || { fail "could not read the new migration's tag" || return 1; }
  lifecycle_run lint lint lint
  [ "$LIFECYCLE_RC" -eq 0 ] || { fail "the generated migration fails the project's lint" || return 1; }
  lifecycle_run format-check format:check format-check
  [ "$LIFECYCLE_RC" -eq 0 ] || { fail "the generated migration fails the project's format check" || return 1; }
  say "the generated migration passes lint and the format check"
  lifecycle_run status db:status db-status
  [ "$LIFECYCLE_RC" -eq 0 ] || { fail "status failed with a pending migration" || return 1; }
  echo "$OUT" | grep -Fq -- "$tag" || { fail "status does not list the pending migration $tag" || return 1; }
  say "status lists $tag"
  lifecycle_run migrate db:migrate db-migrate
  [ "$LIFECYCLE_RC" -eq 0 ] || { fail "migrate failed" || return 1; }
  echo "$OUT" | grep -Fq -- "$tag" || { fail "migrate does not print $tag" || return 1; }
  say "migrate printed $tag"
  lifecycle_run status db:status db-status
  [ "$LIFECYCLE_RC" -eq 0 ] || { fail "status failed after migrate" || return 1; }
  if echo "$OUT" | grep -Fq -- "$tag" || ! echo "$OUT" | grep -Eiq -- "$NOTHING_RE"; then
    fail "status after migrate still lists $tag or does not say nothing is pending" || return 1
  fi
  say "status is empty after migrate"
  lifecycle_run migrate db:migrate db-migrate
  [ "$LIFECYCLE_RC" -eq 0 ] || { fail "second migrate failed" || return 1; }
  echo "$OUT" | grep -Eiq -- "$NOTHING_RE" || { fail "the second migrate is not a no-op" || return 1; }
  say "a second migrate is a no-op"
}

# step5_empty_env: the server refuses an empty environment, and the error leaks no value.
step5_empty_env() {
  echo "--- 5. empty environment"
  if port_busy "$SERVER_PORT"; then fail "port $SERVER_PORT is already in use" || return 1; fi
  if [ "$KIND" = node ] && has_script build; then
    (cd "$PROJ" && CI=true pnpm run build) || { fail "pnpm run build failed" || return 1; }
  fi
  mv "$PROJ/.env" "$PROJ/.env.held" || return 1
  RUN_ENV=()
  run_bounded "$STORE_BOUND" "$WORK/empty.log" $START_CMD
  first_rc="$BOUND_RC"
  sentinel="sentinel-host-$$-$RANDOM.invalid"
  RUN_ENV=("HOST=$sentinel")
  run_bounded "$STORE_BOUND" "$WORK/sentinel.log" $START_CMD
  second_rc="$BOUND_RC"
  RUN_ENV=()
  mv "$PROJ/.env.held" "$PROJ/.env" || return 1
  for pair in "$first_rc:$WORK/empty.log" "$second_rc:$WORK/sentinel.log"; do
    rc="${pair%%:*}"
    log="${pair#*:}"
    if [ "$rc" -eq 124 ]; then fail_log "$log" "the server kept running with its required settings missing" || return 1; fi
    if [ "$rc" -eq 0 ]; then fail_log "$log" "the server exited 0 with its required settings missing" || return 1; fi
    for name in $CONN_VARS; do
      grep -Fq -- "$name" "$log" || { fail_log "$log" "the startup error does not name $name" || return 1; }
    done
  done
  if grep -Fq -- "$sentinel" "$WORK/sentinel.log"; then
    fail_log "$WORK/sentinel.log" "the startup error prints the value of another setting (HOST)" || return 1
  fi
  say "an empty environment is refused, names $(echo $CONN_VARS), and leaks no value"
  for name in $CONN_VARS; do
    value="$(env_value "$PROJ/.env" "$name")"
    case "$value" in
      *://*) ;;
      *) continue ;;
    esac
    RUN_ENV=("$name=${value%%://*}://:zqcanarypw@zqcanaryhost:zqcanaryport/zqcanarydb")
    run_bounded "$STORE_BOUND" "$WORK/malformed.log" $START_CMD
    RUN_ENV=()
    if [ "$BOUND_RC" -eq 124 ]; then fail_log "$WORK/malformed.log" "the server kept running with a malformed $name" || return 1; fi
    if [ "$BOUND_RC" -eq 0 ]; then fail_log "$WORK/malformed.log" "the server exited 0 with a malformed $name" || return 1; fi
    grep -Fq -- "$name" "$WORK/malformed.log" || { fail_log "$WORK/malformed.log" "the startup error does not name $name" || return 1; }
    if grep -Fq -- zqcanary "$WORK/malformed.log"; then
      echo "FAIL: the startup error prints the value of a malformed $name" >&2
      return 1
    fi
    say "a malformed $name is refused, naming it and leaking no part of it"
  done
}

# step6_boot: boot from `.env` after migrating and assert the routes.
step6_boot() {
  echo "--- 6. boot"
  prepare_cmd=""
  if [ "$HAS_DB" -eq 1 ]; then
    if [ "$KIND" = node ]; then prepare_cmd="pnpm run db:migrate"; else prepare_cmd="make db-migrate"; fi
  fi
  LIVE_DOTENV="$PROJ/.env" LIVE_PREPARE="$prepare_cmd" LIVE_PORT="$SERVER_PORT" \
    bash "$ROOT/scripts/live-check.sh" "$PROJ" || { fail "live-check failed from .env" || return 1; }
}

# step7_down_at_startup: a missing store fails the startup, naming the dependency and no secret.
step7_down_at_startup() {
  echo "--- 7. store down at startup"
  if port_busy "$SERVER_PORT"; then fail "port $SERVER_PORT is already in use" || return 1; fi
  RUN_ENV=()
  if [ "$HAS_COMPOSE" -eq 1 ]; then
    for svc in $SERVICES; do
      compose_do stop "$svc" >/dev/null || { fail "could not stop $svc" || return 1; }
      run_bounded "$STORE_BOUND" "$WORK/down-$svc.log" $START_CMD
      rc="$BOUND_RC"
      compose_do up -d --wait >/dev/null || { fail "could not start the services again" || return 1; }
      if [ "$rc" -eq 124 ]; then fail_log "$WORK/down-$svc.log" "with $svc stopped the server kept running past ${STORE_BOUND}s" || return 1; fi
      if [ "$rc" -eq 0 ]; then fail_log "$WORK/down-$svc.log" "with $svc stopped the server exited 0" || return 1; fi
      case "$svc" in
        postgres*) pattern="postgres|database" ;;
        *) pattern="$svc" ;;
      esac
      grep -Eiq -- "$pattern" "$WORK/down-$svc.log" ||
        { fail_log "$WORK/down-$svc.log" "with $svc stopped the output does not name the dependency" || return 1; }
      assert_no_leak "$WORK/down-$svc.log" || return 1
      say "with $svc stopped the server exits $rc, names the dependency and leaks no secret"
    done
  fi
  if [ -n "$SQLITE_PATH" ]; then
    wrong="$(dirname "$SQLITE_PATH")/missing-$$-$RANDOM.db"
    cp "$PROJ/.env" "$PROJ/.env.held" || return 1
    sed -E "s#^DATABASE_URL=.*#DATABASE_URL=$wrong#" "$PROJ/.env.held" >"$PROJ/.env"
    run_bounded "$STORE_BOUND" "$WORK/down-sqlite.log" $START_CMD
    rc="$BOUND_RC"
    mv "$PROJ/.env.held" "$PROJ/.env" || return 1
    if [ "$rc" -eq 124 ]; then fail_log "$WORK/down-sqlite.log" "with a wrong SQLite path the server kept running" || return 1; fi
    if [ "$rc" -eq 0 ]; then fail_log "$WORK/down-sqlite.log" "with a wrong SQLite path the server exited 0" || return 1; fi
    if [ -e "$PROJ/$wrong" ] || [ -e "$wrong" ]; then fail "a wrong SQLite path created a file" || return 1; fi
    grep -Eiq -- "sqlite|database" "$WORK/down-sqlite.log" ||
      { fail_log "$WORK/down-sqlite.log" "with a wrong SQLite path the output does not name the dependency" || return 1; }
    assert_no_leak "$WORK/down-sqlite.log" "$wrong" || return 1
    say "with a wrong SQLite path the server exits $rc, creates no file and leaks no path"
  fi
}

# step8_outage: stop and restart each service under a running server.
step8_outage() {
  if [ "$HAS_COMPOSE" -ne 1 ]; then echo "--- 8. outage after startup: none (no service to stop)"; return 0; fi
  echo "--- 8. outage after startup"
  start_server "$WORK/outage.log"
  if ! wait_health 200 "$READY_TIMEOUT"; then
    health_fail "health did not answer 200 within ${READY_TIMEOUT}s" || return 1
  fi
  for svc in $SERVICES; do
    compose_do stop "$svc" >/dev/null || { fail "could not stop $svc" || return 1; }
    wait_health 503 "$HEALTH_BOUND" || { health_fail "health did not answer 503 within ${HEALTH_BOUND}s with $svc stopped" || return 1; }
    [ "$(cat "$WORK/body")" = '{"status":"unavailable"}' ] ||
      { fail_log "$WORK/outage.log" "health body with $svc stopped is not exactly {\"status\":\"unavailable\"}: $(cat "$WORK/body")" || return 1; }
    say "with $svc stopped health answers 503 {\"status\":\"unavailable\"}"
    if [ "$svc" = redis ]; then
      code="$(http_code /api/v1/hello)"
      body="$(cat "$WORK/body")"
      if [ "$code" != 503 ] || ! echo "$body" | grep -Fq '"success":false'; then
        fail "with redis stopped hello answered $code, not the 503 failure envelope: $body" || return 1
      fi
      say "with redis stopped hello answers the 503 failure envelope"
    fi
    compose_do up -d --wait >/dev/null || { fail "could not start $svc again" || return 1; }
    wait_health 200 "$READY_TIMEOUT" || { health_fail "health did not recover to 200 after $svc came back" || return 1; }
    kill -0 "$SERVER_PID" 2>/dev/null || { health_fail "the server ended during the $svc outage" || return 1; }
    say "with $svc back health answers 200 and the process never ended"
  done
  stop_server
}

# run_all: every step in order; the first failure stops the run.
run_all() {
  prepare || return 1
  step1_env || return 1
  step2_services || return 1
  step3_tests || return 1
  step4_lifecycle || return 1
  step5_empty_env || return 1
  step6_boot || return 1
  step7_down_at_startup || return 1
  step8_outage || return 1
}

if run_all; then
  echo "PASS $LABEL (real store)"
  exit 0
fi
echo "FAIL $LABEL (real store)" >&2
exit 1
