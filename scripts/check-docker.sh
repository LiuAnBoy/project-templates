#!/usr/bin/env bash
# Builds a project's images and runs them, to prove what only a real container
# can: the image holds no secret, runs as a non-root user, answers its health
# route, and a project name keeps two projects apart.
#
# Usage: scripts/check-docker.sh <name-or-dir>...
#   A target is a template name (templates/<name>), an overlay name
#   (overlays/<name> applied over its base template), or a directory (anything
#   containing a slash, or naming an existing directory), checked where it
#   stands. Targets run in turn, each in a temp copy under its own unique
#   project name, and are named in messages by their name or the directory's
#   basename. The source is never changed.
#
# Steps, per target, all in the copy:
#   1. Docker absent or its daemon silent: `INCOMPLETE <target>: needs Docker; no
#      image was built`, and the exit is 3.
#   2. `.env` is the whole `.env.example` with every *_PORT value moved up by
#      20000 (8000 becomes 28000, 3000 becomes 23000), and the port of
#      DOCKER_API_HOST with them, so no port of the other checks is needed.
#      `SENTINEL_SECRET` is planted in `.env`, and sentinel files in `todos/` and
#      `node_modules/` of the build context. With COMPOSE_PROJECT_NAME blank,
#      `docker compose config` must fail naming the variable; then it is set.
#   3. `docker compose build` and `up -d --wait`. Every Docker command runs under
#      a bound and a timeout is a failure naming the step.
#   4. `/api/health` read from inside `server` answers exactly {"status":"ok"},
#      every running service is healthy, and hello answers through the published
#      port. A server also shows its startup failure unchanged: a bad setting
#      exits non-zero, names the setting and holds no value. A project with no
#      `server` service (a web base) is checked on its web services instead: each
#      is healthy and `/` answers 200 through its published port. A Vite project
#      also answers a deep link such as `/some/route` with `index.html`, and
#      `/api/v1/hello` from a stub the script runs on the host at 28000 (and
#      `/api/health` does not reach it), which
#      DOCKER_API_HOST names through host.docker.internal.
#   5. Image guards on every image the project built: the user is not root, the
#      sentinel is absent from `docker history`, `Config.Env` and the exported
#      container filesystem, and `.env`, `todos/` and the planted
#      `node_modules/` file are absent from it. The build stage, when the
#      Dockerfile has one named `build`, is exported the same way, because that
#      is where `COPY . .` puts the context. At runtime `server` sees the
#      sentinel, which proves the check can see it, and `web` and `dashboard`,
#      which read no `env_file`, do not (their whole environment is read, and
#      must hold PATH, so an empty read is never an absence).
#   6. Stores (a project with a `migrate` service or a store service). `migrate`
#      ran a migration the script plants in the copy and exited 0: PostgreSQL
#      holds its table, and on SQLite the file belongs to uid 1000 in the named
#      volume, whose top-level declaration `config` lists, and `server` still
#      answers after a restart. `server` and `migrate` see an empty superuser
#      password and an empty TEST_* URL. With each store service stopped in turn,
#      `run --no-deps server` exits non-zero within STORE_BOUND, names the store
#      and prints no password, URL or host:port. With the PostgreSQL password
#      changed behind the volume, `up` exits non-zero, `migrate` prints no user,
#      database, host or password, and `server` stays `created`.
#   7. The switch (a project with docker-compose.postgres-cluster.yml): a
#      throwaway network and PostgreSQL, named from the project name. Only the
#      four .env lines COMPOSE_FILE, POSTGRES_DOCKER_NETWORK, DATABASE_URL and
#      POSTGRES_DATABASE change; a blank network is refused naming the variable;
#      every other file keeps its checksum; `up --wait` passes with no local
#      `postgres` container, health and hello pass, and `migrate`'s table is in
#      the throwaway database; restoring .env brings the local service back.
# A trap runs `down -v --rmi local` for the project, removes the build-stage
# image, the throwaway container and the throwaway network by name and stops the
# stub, and nothing else.
#
# What the script assumes of a project (the contract its files meet):
#   - `.env.example` lines are NAME=value, COMPOSE_PROJECT_NAME is one of them
#     and empty, and every host port is a *_PORT line (`PORT` for the server).
#   - `docker-compose.yml` starts with `name: ${COMPOSE_PROJECT_NAME:?...}`, has a
#     service `server` that builds the Dockerfile at the project root and answers
#     GET /api/health on its own port 8000, or no `server` and a service `web`
#     that answers GET / and publishes `WEB_PORT`; it names no `container_name`.
#   - A web service reads no `env_file`.
#   - A project with a database store has a `migrate` service (the server's image
#     with its own command) that `server` waits on, and either a `postgres`
#     service whose URL compose builds for `server` and `migrate`, or a named
#     volume `sqlite-data` mounted at /app/data. `POSTGRES_USER` and
#     `POSTGRES_DATABASE` are `.env` lines; this script gives them unique values.
#     A Node project keeps its migrations in `drizzle/` (with `meta/_journal.json`),
#     a Python project in `alembic/versions/`.
#   - A Python project has a `pyproject.toml`; anything else is a Node project.
#
# Exit codes: 0 every target ran and passed; 1 a target failed; 2 usage; 3 Docker
# is absent or its daemon does not answer, so the check is incomplete and never a
# pass (a failure of another target still makes the exit 1).
# Needs node on the PATH when the project is a Vite web base (the stub).
# Environment: BUILD_BOUND (seconds for a build, default 900), UP_BOUND (seconds
# for `up --wait`, default 300), STORE_BOUND (seconds a server gets to exit with a
# store down, default 30), DOCKER_BOUND (seconds for any other Docker command,
# default 60).
# Needs network access for package installs; base images must already be local
# or pullable, and no build passes --pull.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_BOUND="${BUILD_BOUND:-900}"
UP_BOUND="${UP_BOUND:-300}"
DOCKER_BOUND="${DOCKER_BOUND:-60}"
STORE_BOUND="${STORE_BOUND:-30}"
PORT_SHIFT=20000
HELLO_BODY='{"success":true,"payload":{"data":{"message":"hello world!!"}}}'
HEALTH_BODY='{"status":"ok"}'
STUB_PORT=$((8000 + PORT_SHIFT))

if [ "$#" -lt 1 ]; then
  echo "usage: scripts/check-docker.sh <name-or-dir>..." >&2
  exit 2
fi

WORK=""
PROJ=""
PROJECT=""
LABEL=""
SENTINEL=""
STARTED=0
COUNTER=0
BUILD_IMAGE=""
STUB_PID=""
SW_NET=""
SW_PG=""

# kill_tree <signal> <pid>: send a signal to a process and all its descendants.
kill_tree() {
  for child in $(pgrep -P "$2" 2>/dev/null); do
    kill_tree "$1" "$child"
  done
  kill "-$1" "$2" 2>/dev/null
}

# run_bound <seconds> <command...>: run a command under a deadline. Returns the
# command's status, or 124 when the deadline passed and the command was killed.
run_bound() {
  local limit rb_pid rb_watch rb_rc
  limit="$1"
  shift
  "$@" &
  rb_pid=$!
  (
    sleep "$limit"
    : >"$WORK/timeout.$rb_pid"
    kill_tree TERM "$rb_pid"
    sleep 2
    kill_tree KILL "$rb_pid"
  ) >/dev/null 2>&1 &
  rb_watch=$!
  { wait "$rb_pid"; } 2>/dev/null
  rb_rc=$?
  kill_tree KILL "$rb_watch"
  { wait "$rb_watch"; } 2>/dev/null
  if [ -f "$WORK/timeout.$rb_pid" ]; then
    rm -f "$WORK/timeout.$rb_pid"
    echo "TIMEOUT after ${limit}s: $*" >&2
    return 124
  fi
  return "$rb_rc"
}

# dk <seconds> <docker args...>: run docker under a deadline.
dk() {
  local limit
  limit="$1"
  shift
  run_bound "$limit" docker "$@"
}

# dc <seconds> <compose args...>: run `docker compose` in the project under a deadline.
dc() {
  local limit
  limit="$1"
  shift
  (cd "$PROJ" && run_bound "$limit" docker compose "$@")
}

# compose_here <compose args...>: run `docker compose` in the project, with no bound
# of its own; read_checked supplies one.
compose_here() {
  (cd "$PROJ" && docker compose "$@")
}

# docker_ready: succeed when a docker binary exists and its daemon answers in time.
docker_ready() {
  local i info_pid
  command -v docker >/dev/null 2>&1 || return 1
  docker info >/dev/null 2>&1 &
  info_pid=$!
  i=0
  while kill -0 "$info_pid" 2>/dev/null; do
    if [ "$i" -ge 150 ]; then
      kill_tree KILL "$info_pid"
      { wait "$info_pid"; } 2>/dev/null
      return 1
    fi
    sleep 0.1
    i=$((i + 1))
  done
  wait "$info_pid" || return 1
  docker compose version >/dev/null 2>&1
}

# fail <message>: report a failed assertion and return 1.
fail() {
  echo "FAIL $LABEL: $1" >&2
  return 1
}

# say <message>: print one passed assertion.
say() {
  echo "ok   $1"
}

# env_value <file> <name>: print the value of NAME in a dotenv file.
env_value() {
  grep -E "^$2=" "$1" | head -n 1 | cut -d= -f2-
}

# teardown: remove everything the current target started, by name.
teardown() {
  local leftover
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then
    if [ "$STARTED" -eq 1 ] && [ -d "$PROJ" ]; then
      # A run that stopped inside the switch still has the cluster .env: restore the local one first.
      [ -f "$WORK/env.local" ] && cp "$WORK/env.local" "$PROJ/.env"
      (cd "$PROJ" && run_bound "$DOCKER_BOUND" docker compose -p "$PROJECT" down -v --rmi local >/dev/null 2>&1)
    fi
    if [ -n "$BUILD_IMAGE" ]; then
      run_bound "$DOCKER_BOUND" docker rmi -f "$BUILD_IMAGE" >/dev/null 2>&1
    fi
    if [ "$STARTED" -eq 1 ]; then
      # `down --rmi local` removes nothing once the project has no container (the
      # run stopped it before a failure), so its images and network go by their label.
      leftover="$(run_bound "$DOCKER_BOUND" docker images -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null)"
      # shellcheck disable=SC2086
      [ -n "$leftover" ] && run_bound "$DOCKER_BOUND" docker rmi -f $leftover >/dev/null 2>&1
      leftover="$(run_bound "$DOCKER_BOUND" docker network ls -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null)"
      # shellcheck disable=SC2086
      [ -n "$leftover" ] && run_bound "$DOCKER_BOUND" docker network rm $leftover >/dev/null 2>&1
    fi
    if [ -n "$SW_PG" ]; then
      run_bound "$DOCKER_BOUND" docker rm -f -v "$SW_PG" >/dev/null 2>&1
    fi
    if [ -n "$SW_NET" ]; then
      run_bound "$DOCKER_BOUND" docker network rm "$SW_NET" >/dev/null 2>&1
    fi
    if [ -n "$STUB_PID" ]; then
      kill "$STUB_PID" 2>/dev/null
      { wait "$STUB_PID"; } 2>/dev/null
    fi
    rm -rf "$WORK"
  fi
  WORK=""
  PROJ=""
  STARTED=0
  BUILD_IMAGE=""
  STUB_PID=""
  SW_NET=""
  SW_PG=""
}
trap teardown EXIT
trap 'exit 130' INT TERM

# resolve_target <arg> <dest>: copy the target into <dest> without build leftovers
# or any .env. Prints the label. Returns 1 when the target does not exist.
resolve_target() {
  local arg dest src excludes base
  arg="$1"
  dest="$2"
  case "$arg" in
    */*)
      src="$(cd "$arg" 2>/dev/null && pwd)" || return 1
      LABEL="$(basename "$src")"
      ;;
    *)
      LABEL="$arg"
      if [ -d "$arg" ]; then
        src="$(cd "$arg" && pwd)"
      elif [ -d "$ROOT/templates/$arg" ]; then
        src="$ROOT/templates/$arg"
      elif [ -d "$ROOT/overlays/$arg" ]; then
        src=""
      else
        return 1
      fi
      ;;
  esac
  mkdir -p "$dest" || return 1
  excludes="--exclude=node_modules --exclude=.venv --exclude=.next --exclude=dist --exclude=.git --exclude=.env --exclude=__pycache__ --exclude=test-results --exclude=playwright-report"
  if [ -n "$src" ]; then
    # shellcheck disable=SC2086
    (cd "$src" && tar $excludes -cf - .) | (cd "$dest" && tar -xf -) || return 1
  else
    base="${arg%%-*}"
    # shellcheck disable=SC2086
    (cd "$ROOT/templates/$base" && tar $excludes -cf - .) | (cd "$dest" && tar -xf -) || return 1
    # shellcheck disable=SC2086
    (cd "$ROOT/overlays/$arg" && tar $excludes -cf - .) | (cd "$dest" && tar -xf -) || return 1
  fi
}

# write_env: write .env from .env.example with the ports moved and the sentinel planted.
write_env() {
  [ -f "$PROJ/.env.example" ] || { fail ".env.example is missing"; return 1; }
  awk -v shift="$PORT_SHIFT" '
    /^[A-Za-z0-9_]*PORT=[0-9]+$/ { split($0, kv, "="); print kv[1] "=" (kv[2] + shift); next }
    /^DOCKER_API_HOST=.*:[0-9]+$/ {
      n = split($0, parts, ":")
      sub(/:[0-9]+$/, ":" (parts[n] + shift))
      print
      next
    }
    { print }
  ' "$PROJ/.env.example" >"$PROJ/.env" || return 1
  printf 'SENTINEL_SECRET=%s\n' "$SENTINEL" >>"$PROJ/.env"
  mkdir -p "$PROJ/todos" "$PROJ/node_modules"
  printf '%s\n' "$SENTINEL" >"$PROJ/todos/ptcheck-sentinel.txt"
  printf '%s\n' "$SENTINEL" >"$PROJ/node_modules/ptcheck-sentinel.txt"
  # Unique store names, so a leak of the user or the database name is recognisable.
  if grep -q '^POSTGRES_USER=' "$PROJ/.env"; then
    set_env POSTGRES_USER "ptu${RANDOM}x"
    set_env POSTGRES_DATABASE "ptd${RANDOM}x"
  fi
  plant_migration
}

# set_env <name> <value>: replace the NAME= line of .env in place. The value goes
# through the environment, so no character of it is read as an escape.
set_env() {
  SET_VALUE="$2" awk -v name="$1" '
    index($0, name "=") == 1 { print name "=" ENVIRON["SET_VALUE"]; next }
    { print }
  ' "$PROJ/.env" >"$PROJ/.env.next" && mv "$PROJ/.env.next" "$PROJ/.env"
}

# plant_migration: give the copy one migration that creates the table ptcheck_probe,
# so what `migrate` did can be read back. Node: drizzle/ and its journal; Python:
# alembic/versions/. A project with neither has no migrate service.
plant_migration() {
  if [ -f "$PROJ/scripts/db/migrate.mjs" ] && [ -f "$PROJ/drizzle/meta/_journal.json" ]; then
    printf 'CREATE TABLE ptcheck_probe (id integer);\n' >"$PROJ/drizzle/0000_ptcheck_probe.sql"
    node -e "
      const fs = require('fs');
      const file = process.argv[1];
      const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
      journal.entries.push({ idx: 0, version: journal.version, when: 1730000000000, tag: '0000_ptcheck_probe', breakpoints: true });
      fs.writeFileSync(file, JSON.stringify(journal, null, 2) + '\n');
    " "$PROJ/drizzle/meta/_journal.json" || return 1
  elif [ -f "$PROJ/scripts/db_migrate.py" ] && [ -d "$PROJ/alembic/versions" ]; then
    cat >"$PROJ/alembic/versions/20250101_0000_ptcheck0001_probe.py" <<'PYMIG'
"""Probe migration planted by check-docker.sh."""

import sqlalchemy as sa
from alembic import op

revision = "ptcheck0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("ptcheck_probe", sa.Column("id", sa.Integer()))


def downgrade() -> None:
    op.drop_table("ptcheck_probe")
PYMIG
  fi
}

# set_project_name <name>: set COMPOSE_PROJECT_NAME in .env.
set_project_name() {
  grep -v '^COMPOSE_PROJECT_NAME=' "$PROJ/.env" >"$PROJ/.env.next" || true
  printf 'COMPOSE_PROJECT_NAME=%s\n' "$1" >>"$PROJ/.env.next"
  mv "$PROJ/.env.next" "$PROJ/.env"
}

# check_blank_name: with the project name blank, compose must fail naming the variable.
check_blank_name() {
  local out
  out="$WORK/blank.out"
  if dc "$DOCKER_BOUND" config -q >"$out" 2>&1; then
    fail "docker compose accepted a blank COMPOSE_PROJECT_NAME"
    return 1
  fi
  if ! grep -q 'COMPOSE_PROJECT_NAME' "$out"; then
    echo "compose output, first lines:" >&2
    head -n 5 "$out" >&2
    fail "a blank COMPOSE_PROJECT_NAME failed without naming the variable"
    return 1
  fi
  say "$LABEL: a blank COMPOSE_PROJECT_NAME is refused, naming the variable"
}

# is_python: succeed for a Python project.
is_python() {
  [ -f "$PROJ/pyproject.toml" ]
}

# has_service <name>: succeed when docker-compose.yml defines the service.
has_service() {
  grep -q "^  $1:" "$PROJ/docker-compose.yml"
}

# service_exec <service> <command...>: run a command in a running service.
service_exec() {
  local svc
  svc="$1"
  shift
  dc "$DOCKER_BOUND" exec -T "$svc" "$@"
}

# read_health: print the body of /api/health read from inside server.
read_health() {
  if is_python; then
    service_exec server python -c "import urllib.request as u; import sys; sys.stdout.write(u.urlopen('http://127.0.0.1:8000/api/health', timeout=3).read().decode())"
  else
    service_exec server node -e "fetch('http://127.0.0.1:8000/api/health').then((r) => r.text()).then((t) => process.stdout.write(t))"
  fi
}

# check_healthy: at least one service runs and every running one is healthy.
check_healthy() {
  local ids id state
  ids="$(dc "$DOCKER_BOUND" ps -q 2>/dev/null)"
  [ -n "$ids" ] || { fail "no service is running"; return 1; }
  for id in $ids; do
    state="$(dk "$DOCKER_BOUND" inspect -f '{{.Name}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null)"
    case "$state" in
      *" healthy") ;;
      *)
        fail "a service is not healthy: $state"
        return 1
        ;;
    esac
  done
  say "$LABEL: every running service is healthy"
}

# check_running: health inside server, every service healthy, hello through the port.
check_running() {
  local body port hello
  body="$(read_health 2>/dev/null)"
  if [ "$body" != "$HEALTH_BODY" ]; then
    fail "/api/health from inside server answered '$body', expected '$HEALTH_BODY'"
    return 1
  fi
  say "$LABEL: /api/health answers exactly $HEALTH_BODY from inside server"
  check_healthy || return 1
  port="$(env_value "$PROJ/.env" PORT)"
  hello="$(curl -s --max-time 10 "http://127.0.0.1:$port/api/v1/hello")"
  if [ "$hello" != "$HELLO_BODY" ]; then
    fail "hello through port $port answered '$hello'"
    return 1
  fi
  say "$LABEL: hello answers through the published port $port"
}

# start_stub: answer GET /api/v1/hello on all interfaces of the host at STUB_PORT,
# as the API a standalone web container reaches through host.docker.internal.
start_stub() {
  local i
  STUB_BODY="$HELLO_BODY" STUB_PORT="$STUB_PORT" node -e "
    require('http')
      .createServer((req, res) => {
        if (req.url === '/api/v1/hello') {
          res.setHeader('content-type', 'application/json');
          res.end(process.env.STUB_BODY);
        } else if (req.url === '/api/health') {
          res.end('stub-health');
        } else {
          res.statusCode = 404;
          res.end();
        }
      })
      .listen(Number(process.env.STUB_PORT), '0.0.0.0');
  " >"$WORK/stub.out" 2>&1 &
  STUB_PID=$!
  i=0
  while [ "$i" -lt 50 ]; do
    if [ "$(curl -s --max-time 2 "http://127.0.0.1:$STUB_PORT/api/v1/hello")" = "$HELLO_BODY" ]; then
      return 0
    fi
    kill -0 "$STUB_PID" 2>/dev/null || break
    sleep 0.1
    i=$((i + 1))
  done
  cat "$WORK/stub.out" >&2
  fail "the API stub did not start on port $STUB_PORT (is it in use?)"
  return 1
}

# check_web: a project with no server. Every service is healthy, `/` answers 200
# through the published web port, and a Vite project answers a deep link with
# index.html and reaches the stub through its proxy.
check_web() {
  local port code root_body deep_body hello
  check_healthy || return 1
  port="$(env_value "$PROJ/.env" WEB_PORT)"
  [ -n "$port" ] || { fail "WEB_PORT is not set in .env"; return 1; }
  root_body="$WORK/web-root.out"
  code="$(curl -s --max-time 10 -o "$root_body" -w '%{http_code}' "http://127.0.0.1:$port/")"
  if [ "$code" != "200" ]; then
    fail "/ answered $code through web port $port"
    return 1
  fi
  say "$LABEL: / answers 200 through the published web port $port"
  if is_vite; then
    deep_body="$WORK/web-deep.out"
    code="$(curl -s --max-time 10 -o "$deep_body" -w '%{http_code}' "http://127.0.0.1:$port/some/route")"
    if [ "$code" != "200" ] || ! cmp -s "$root_body" "$deep_body"; then
      fail "a deep link answered $code and not the index.html of /"
      return 1
    fi
    say "$LABEL: a deep link answers 200 with index.html"
    hello="$(curl -s --max-time 10 "http://127.0.0.1:$port/api/v1/hello")"
    if [ "$hello" != "$HELLO_BODY" ]; then
      fail "/api/v1/hello through web port $port answered '$hello', not the stub's body"
      return 1
    fi
    say "$LABEL: /api/v1/hello reaches the API stub through the proxy"
    if [ "$(curl -s --max-time 10 "http://127.0.0.1:$port/api/health")" = "stub-health" ]; then
      fail "/api/health on the web port reached the API stub, but only /api/v1/ is forwarded"
      return 1
    fi
    say "$LABEL: /api/health on the web port does not reach the API"
  fi
}

# is_vite: succeed for a Vite project.
is_vite() {
  grep -q '"vite"' "$PROJ/package.json" 2>/dev/null
}

# check_startup_failure: a bad setting makes the container exit non-zero, naming the
# setting and never the value, as the process itself prints it.
check_startup_failure() {
  local bad out rc
  bad="ptcheck-bad-value"
  out="$WORK/startup.out"
  dc "$DOCKER_BOUND" run --rm --no-deps -T -e "RATE_LIMIT_MAX=$bad" server >"$out" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ] || [ "$rc" -eq 124 ]; then
    cat "$out" >&2
    fail "a malformed RATE_LIMIT_MAX did not stop the container (exit $rc)"
    return 1
  fi
  if ! grep -qi 'RATE_LIMIT_MAX' "$out"; then
    cat "$out" >&2
    fail "the startup failure did not name RATE_LIMIT_MAX"
    return 1
  fi
  if grep -q -F "$bad" "$out"; then
    fail "the startup failure printed the value of RATE_LIMIT_MAX"
    return 1
  fi
  say "$LABEL: a malformed setting stops the container (exit $rc), names the setting and prints no value"
}

# read_checked <file> <step> <command...>: run a command under the Docker bound with
# its output in <file>. A failed or timed-out command, or one that prints nothing,
# fails naming the step, so a guard never judges an empty read.
read_checked() {
  local file step
  file="$1"
  step="$2"
  shift 2
  if ! run_bound "$DOCKER_BOUND" "$@" >"$file" 2>"$file.err"; then
    cat "$file.err" >&2
    fail "could not read $step"
    return 1
  fi
  if [ ! -s "$file" ]; then
    fail "reading $step returned nothing"
    return 1
  fi
}

# absent_from <file> <needle>: succeed when the needle is not in the file. A grep
# that errors (status 2) is not an absence and fails too.
absent_from() {
  grep -a -q -F -- "$2" "$1" 2>/dev/null
  [ "$?" -eq 1 ]
}

# scan_export <what> <container-id>: export a container's filesystem and fail when
# it holds the sentinel, a planted file, `.env` or `todos/`.
scan_export() {
  local what id tarball listing
  what="$1"
  id="$2"
  tarball="$WORK/export.tar"
  if ! run_bound "$BUILD_BOUND" docker export -o "$tarball" "$id" 2>"$WORK/export.err"; then
    cat "$WORK/export.err" >&2
    fail "could not export the filesystem of $what"
    return 1
  fi
  if [ ! -s "$tarball" ]; then
    fail "the export of the filesystem of $what is empty"
    return 1
  fi
  if ! absent_from "$tarball" "$SENTINEL"; then
    rm -f "$tarball"
    fail "the sentinel is in the filesystem of $what, or the export could not be read"
    return 1
  fi
  listing="$WORK/export.list"
  if ! tar -tf "$tarball" >"$listing" 2>/dev/null || [ ! -s "$listing" ]; then
    rm -f "$tarball"
    fail "could not list the exported filesystem of $what"
    return 1
  fi
  rm -f "$tarball"
  if grep -q 'ptcheck-sentinel' "$listing"; then
    fail "a planted context file is in the filesystem of $what"
    return 1
  fi
  if grep -E -q '(^|/)(app|workspace)/(\.env|todos)(/|$)' "$listing"; then
    fail ".env or todos/ is in the filesystem of $what"
    return 1
  fi
  say "$LABEL: the filesystem of $what holds no sentinel, .env, todos/ or planted file"
}

# check_image <service>: the guards of one built image and its running container.
check_image() {
  local svc image id user uid history envs
  svc="$1"
  image="$PROJECT-$svc"
  id="$(dc "$DOCKER_BOUND" ps -q "$svc" 2>/dev/null)"
  [ -n "$id" ] || { fail "service $svc is not running"; return 1; }
  user="$(dk "$DOCKER_BOUND" inspect -f '{{.Config.User}}' "$image" 2>/dev/null)"
  case "$user" in
    "" | root | 0 | 0:* | root:*)
      fail "the image of $svc declares user '$user', which is root"
      return 1
      ;;
  esac
  uid="$(service_exec "$svc" id -u 2>/dev/null | tr -d '\r')"
  if [ -z "$uid" ] || [ "$uid" = "0" ]; then
    fail "the process in $svc runs as uid '$uid'"
    return 1
  fi
  say "$LABEL: $svc runs as user $user (uid $uid), not root"
  history="$WORK/history.out"
  read_checked "$history" "docker history of the $svc image" \
    docker history --no-trunc --format '{{.CreatedBy}}' "$image" || return 1
  if ! absent_from "$history" "$SENTINEL"; then
    fail "the sentinel is in docker history of the $svc image"
    return 1
  fi
  envs="$WORK/envs.out"
  read_checked "$envs" "Config.Env of the $svc image" \
    docker inspect -f '{{json .Config.Env}}' "$image" || return 1
  if ! absent_from "$envs" "$SENTINEL"; then
    fail "the sentinel is in Config.Env of the $svc image"
    return 1
  fi
  say "$LABEL: the $svc image history and Config.Env hold no sentinel"
  scan_export "the $svc container" "$id" || return 1
}

# check_build_stage: build the stage named `build` of the Dockerfile and scan it,
# because `COPY . .` puts the whole context there.
check_build_stage() {
  local cid rc
  grep -E -q '^FROM .* AS build[[:space:]]*$' "$PROJ/Dockerfile" 2>/dev/null || return 0
  BUILD_IMAGE="$PROJECT-buildstage"
  if ! run_bound "$BUILD_BOUND" docker build --target build -t "$BUILD_IMAGE" "$PROJ" >"$WORK/stage.out" 2>&1; then
    tail -n 20 "$WORK/stage.out" >&2
    fail "could not build the build stage"
    return 1
  fi
  cid="$(dk "$DOCKER_BOUND" create "$BUILD_IMAGE" 2>/dev/null)"
  [ -n "$cid" ] || { fail "could not create a container of the build stage"; return 1; }
  scan_export "the build stage" "$cid"
  rc=$?
  dk "$DOCKER_BOUND" rm -f "$cid" >/dev/null 2>&1
  return "$rc"
}

# check_runtime_env: the server sees the sentinel; web and dashboard do not.
check_runtime_env() {
  local seen svc ids
  if has_service server; then
    seen="$(service_exec server printenv SENTINEL_SECRET 2>/dev/null | tr -d '\r')"
    if [ "$seen" != "$SENTINEL" ]; then
      fail "server does not see SENTINEL_SECRET at runtime, so the sentinel checks prove nothing"
      return 1
    fi
    say "$LABEL: server sees the sentinel at runtime"
  fi
  for svc in web dashboard; do
    ids="$(dc "$DOCKER_BOUND" ps -q "$svc" 2>/dev/null)" || { fail "could not list service $svc"; return 1; }
    if [ -n "$ids" ]; then
      # Read the whole environment: a failed exec must not look like an absent variable.
      read_checked "$WORK/printenv.out" "the environment of $svc" \
        compose_here exec -T "$svc" printenv || return 1
      if ! grep -q '^PATH=' "$WORK/printenv.out"; then
        fail "the environment read of $svc holds no PATH, so it proves nothing"
        return 1
      fi
      if ! absent_from "$WORK/printenv.out" "$SENTINEL"; then
        fail "$svc sees the sentinel, but it reads no env_file"
        return 1
      fi
      say "$LABEL: $svc does not see the sentinel"
    fi
  done
}

# container_state <service>: print "<status> <exit code>" of the service's container
# (exited ones included), or fail when it has none or the read fails.
container_state() {
  local id
  id="$(dc "$DOCKER_BOUND" ps -a -q "$1" 2>/dev/null)" || return 1
  [ -n "$id" ] || return 1
  dk "$DOCKER_BOUND" inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$id" 2>/dev/null
}

# wait_stack: bring the project up again and wait for every service to be healthy.
wait_stack() {
  if ! dc "$UP_BOUND" up -d --wait >"$WORK/wait.out" 2>&1; then
    tail -n 30 "$WORK/wait.out" >&2
    fail "docker compose up --wait failed ($1)"
    return 1
  fi
}

# check_store_env: server and migrate carry no superuser password and no TEST_* URL
# of their stores from .env, and each of them still holds the variable (empty), so
# a missing blanking shows as a different line.
check_store_env() {
  local svc name
  has_service migrate || return 0
  grep -q '^POSTGRES_PASSWORD=' "$PROJ/.env" || return 0
  for svc in server migrate; do
    if [ "$svc" = server ]; then
      read_checked "$WORK/svcenv.out" "the environment of server" \
        compose_here exec -T server printenv || return 1
    else
      read_checked "$WORK/svcenv.out" "the environment of migrate" \
        compose_here run --rm --no-deps -T migrate printenv || return 1
    fi
    grep -q '^PATH=' "$WORK/svcenv.out" || { fail "the environment read of $svc holds no PATH"; return 1; }
    for name in POSTGRES_PASSWORD TEST_DATABASE_URL TEST_REDIS_URL; do
      grep -q "^$name=" "$PROJ/.env" || continue
      # migrate reaches no Redis, and a Redis-only project has no migrate service.
      [ "$svc" = migrate ] && [ "$name" = TEST_REDIS_URL ] && continue
      if ! grep -q -x "$name=" "$WORK/svcenv.out"; then
        fail "$svc does not carry an empty $name"
        return 1
      fi
    done
  done
  say "$LABEL: server and migrate carry an empty superuser password and empty TEST_* URLs"
}

# check_migrated: migrate exited 0 and its work is in the store.
check_migrated() {
  local state user db seen owner restarted
  has_service migrate || return 0
  state="$(container_state migrate)" || { fail "migrate left no container to read"; return 1; }
  if [ "$state" != "exited 0" ]; then
    fail "migrate is '$state', expected 'exited 0'"
    return 1
  fi
  if has_service postgres; then
    user="$(env_value "$PROJ/.env" POSTGRES_USER)"
    db="$(env_value "$PROJ/.env" POSTGRES_DATABASE)"
    read_checked "$WORK/probe.out" "the migrated table in postgres" \
      compose_here exec -T postgres \
      psql -U "$user" -d "$db" -tAc "select to_regclass('public.ptcheck_probe') is not null" || return 1
    if [ "$(tr -d '[:space:]' <"$WORK/probe.out")" != "t" ]; then
      fail "migrate exited 0 but the planted migration is not in the database"
      return 1
    fi
    say "$LABEL: migrate exited 0 and its table is in the database"
    return 0
  fi
  if ! grep -q '^  sqlite-data:' "$PROJ/docker-compose.yml"; then
    fail "the named volume sqlite-data has no top-level declaration"
    return 1
  fi
  read_checked "$WORK/volumes.out" "the volumes of the compose file" \
    compose_here config --volumes || return 1
  grep -q -x 'sqlite-data' "$WORK/volumes.out" || { fail "config lists no volume sqlite-data"; return 1; }
  owner="$(service_exec server stat -c '%u' /app/data/app.db 2>/dev/null | tr -d '\r')"
  if [ "$owner" != "1000" ]; then
    fail "the database file belongs to uid '$owner', expected 1000 (created by migrate)"
    return 1
  fi
  say "$LABEL: migrate exited 0 and created the database file as uid 1000 in the named volume"
  restarted="$WORK/restart.out"
  if ! dc "$DOCKER_BOUND" restart server >"$restarted" 2>&1; then
    cat "$restarted" >&2
    fail "could not restart server"
    return 1
  fi
  wait_stack "after restarting server" || return 1
  seen="$(read_health 2>/dev/null)"
  if [ "$seen" != "$HEALTH_BODY" ]; then
    fail "after a restart, /api/health answered '$seen', expected '$HEALTH_BODY'"
    return 1
  fi
  say "$LABEL: server reads the database file again after a restart"
}

# store_down <service>: stop one store, run server once without its dependencies, and
# judge its output; then bring the project back.
store_down() {
  local svc out rc password
  svc="$1"
  out="$WORK/down-$svc.out"
  if ! dc "$DOCKER_BOUND" stop "$svc" >/dev/null 2>&1; then
    fail "could not stop $svc"
    return 1
  fi
  dc "$STORE_BOUND" run --rm --no-deps -T server >"$out" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ] || [ "$rc" -eq 124 ]; then
    cat "$out" >&2
    fail "with $svc stopped, server exited $rc instead of failing within ${STORE_BOUND}s"
    return 1
  fi
  if ! grep -q -i "$svc" "$out"; then
    cat "$out" >&2
    fail "with $svc stopped, the startup failure did not name it"
    return 1
  fi
  password="$(env_value "$PROJ/.env" POSTGRES_PASSWORD)"
  if [ -n "$password" ] && grep -q -F -- "$password" "$out"; then
    fail "with $svc stopped, the startup failure printed the password"
    return 1
  fi
  if grep -q -F '://' "$out" || grep -q -E "$svc:[0-9]+" "$out"; then
    cat "$out" >&2
    fail "with $svc stopped, the startup failure printed a URL or a host and port"
    return 1
  fi
  say "$LABEL: with $svc stopped, server exits $rc within the bound, names it, and prints no password, URL or host"
  wait_stack "after starting $svc again"
}

# check_stores_down: each store service stopped in turn.
check_stores_down() {
  local svc
  for svc in postgres redis; do
    has_service "$svc" || continue
    store_down "$svc" || return 1
  done
}

# check_migrate_failure: with the PostgreSQL password changed behind its volume,
# migrate fails, server is never started, `up` is non-zero, and migrate's output
# holds no user, database, host or password.
check_migrate_failure() {
  local out rc user db password state secret
  has_service postgres || return 0
  has_service migrate || return 0
  user="$(env_value "$PROJ/.env" POSTGRES_USER)"
  db="$(env_value "$PROJ/.env" POSTGRES_DATABASE)"
  password="$(env_value "$PROJ/.env" POSTGRES_PASSWORD)"
  dc "$DOCKER_BOUND" down >/dev/null 2>&1 || { fail "could not stop the project"; return 1; }
  set_env POSTGRES_PASSWORD "ptwrongpw${RANDOM}"
  out="$WORK/migrate-fail.out"
  dc "$UP_BOUND" up -d --wait >"$out" 2>&1
  rc=$?
  dc "$DOCKER_BOUND" logs migrate >>"$out" 2>&1
  if [ "$rc" -eq 0 ] || [ "$rc" -eq 124 ]; then
    cat "$out" >&2
    fail "up exited $rc although migrate could not log in"
    return 1
  fi
  state="$(container_state server)" || state="absent"
  case "$state" in
    "created 0" | absent) ;;
    *)
      fail "server is '$state' after a failed migrate, expected it unstarted"
      return 1
      ;;
  esac
  if ! grep -q -i 'migrate' "$out"; then
    fail "the failed up did not name migrate"
    return 1
  fi
  state="$(container_state migrate)" || { fail "migrate left no container to read"; return 1; }
  case "$state" in
    "exited 0" | "running "*)
      fail "migrate is '$state' although the password was wrong"
      return 1
      ;;
  esac
  dc "$DOCKER_BOUND" logs migrate >"$WORK/migrate.log" 2>&1
  if [ ! -s "$WORK/migrate.log" ]; then
    fail "migrate printed nothing when it failed"
    return 1
  fi
  for secret in "$user" "$db" "$password" "postgres:5432" "@postgres" "://"; do
    if grep -q -F -- "$secret" "$WORK/migrate.log"; then
      cat "$WORK/migrate.log" >&2
      fail "migrate's output holds '$secret'"
      return 1
    fi
  done
  say "$LABEL: a failing migrate leaves server unstarted, up exits $rc, and the output holds no host, user, database or password"
  set_env POSTGRES_PASSWORD "$password"
}

# switch_wait_ready: wait until the throwaway PostgreSQL answers over TCP (the
# temporary server of the image's first start listens on a socket only).
switch_wait_ready() {
  local i
  i=0
  while [ "$i" -lt 60 ]; do
    if run_bound "$DOCKER_BOUND" docker exec "$SW_PG" psql -h 127.0.0.1 -U ptswu -d ptswdb -tAc 'select 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  fail "the throwaway PostgreSQL did not become ready"
  return 1
}

# checksums <file>: write a sorted checksum list of every file of the project but .env.
checksums() {
  (cd "$PROJ" && find . -type f ! -name .env ! -name .env.next -print | sort | while IFS= read -r f; do
    cksum "$f"
  done) >"$1"
}

# containers_of <service>: print the ids of the project's containers of a service,
# exited ones included. Fails when the read fails; prints nothing when there are none.
containers_of() {
  run_bound "$DOCKER_BOUND" docker ps -a -q \
    --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1"
}

# check_switch: the cluster switch by .env alone.
check_switch() {
  local out ids probe
  [ -f "$PROJ/docker-compose.postgres-cluster.yml" ] || return 0
  SW_NET="${PROJECT}swnet"
  SW_PG="${PROJECT}swpg"
  if ! run_bound "$DOCKER_BOUND" docker network create "$SW_NET" >"$WORK/sw.out" 2>&1; then
    cat "$WORK/sw.out" >&2
    fail "could not create the throwaway network"
    return 1
  fi
  if ! run_bound "$DOCKER_BOUND" docker run -d --name "$SW_PG" --network "$SW_NET" \
    -e POSTGRES_USER=ptswu -e POSTGRES_PASSWORD=ptswpw -e POSTGRES_DB=ptswdb postgres:18-alpine >"$WORK/sw.out" 2>&1; then
    cat "$WORK/sw.out" >&2
    fail "could not start the throwaway PostgreSQL"
    return 1
  fi
  switch_wait_ready || return 1
  dc "$DOCKER_BOUND" down >/dev/null 2>&1 || { fail "could not stop the project before the switch"; return 1; }
  cp "$PROJ/.env" "$WORK/env.local"
  checksums "$WORK/sum.before" || { fail "could not checksum the project"; return 1; }
  set_env COMPOSE_FILE "docker-compose.yml:docker-compose.postgres-cluster.yml"
  set_env DATABASE_URL "postgresql://ptswu:ptswpw@$SW_PG:5432/ptswdb"
  set_env POSTGRES_DATABASE "ptswdb"
  out="$WORK/blank-net.out"
  if dc "$DOCKER_BOUND" config -q >"$out" 2>&1; then
    fail "a blank POSTGRES_DOCKER_NETWORK was accepted with the cluster file"
    return 1
  fi
  if ! grep -q 'POSTGRES_DOCKER_NETWORK' "$out"; then
    head -n 5 "$out" >&2
    fail "a blank POSTGRES_DOCKER_NETWORK failed without naming the variable"
    return 1
  fi
  say "$LABEL: a blank POSTGRES_DOCKER_NETWORK is refused, naming the variable"
  set_env POSTGRES_DOCKER_NETWORK "$SW_NET"
  if [ "$(diff <(grep -v -E '^(COMPOSE_FILE|POSTGRES_DOCKER_NETWORK|DATABASE_URL|POSTGRES_DATABASE)=' "$WORK/env.local") \
    <(grep -v -E '^(COMPOSE_FILE|POSTGRES_DOCKER_NETWORK|DATABASE_URL|POSTGRES_DATABASE)=' "$PROJ/.env") | wc -l | tr -d ' ')" != "0" ]; then
    fail "the switch changed an .env line other than the four"
    return 1
  fi
  checksums "$WORK/sum.after" || { fail "could not checksum the project"; return 1; }
  if ! cmp -s "$WORK/sum.before" "$WORK/sum.after"; then
    fail "the switch changed a file other than .env"
    return 1
  fi
  say "$LABEL: the switch changes four .env lines and no other file"
  wait_stack "on the cluster" || return 1
  ids="$(containers_of postgres)" || { fail "could not list the postgres containers"; return 1; }
  if [ -n "$ids" ]; then
    fail "a local postgres container exists on the cluster"
    return 1
  fi
  say "$LABEL: no local postgres container exists on the cluster"
  check_running || return 1
  read_checked "$WORK/probe.out" "the migrated table in the throwaway database" \
    docker exec "$SW_PG" psql -U ptswu -d ptswdb -tAc "select to_regclass('public.ptcheck_probe') is not null" || return 1
  probe="$(tr -d '[:space:]' <"$WORK/probe.out")"
  if [ "$probe" != "t" ]; then
    fail "migrate's table is not in the throwaway database"
    return 1
  fi
  say "$LABEL: migrate's work is in the throwaway database"
  dc "$DOCKER_BOUND" down >/dev/null 2>&1 || { fail "could not stop the project on the cluster"; return 1; }
  cp "$WORK/env.local" "$PROJ/.env"
  rm -f "$WORK/env.local"
  wait_stack "after restoring .env" || return 1
  ids="$(containers_of postgres)" || { fail "could not list the postgres containers"; return 1; }
  if [ -z "$ids" ]; then
    fail "restoring .env did not bring the local postgres back"
    return 1
  fi
  check_running || return 1
  say "$LABEL: restoring .env brings the local postgres back"
}

# check_one <arg>: run every step for one target. Returns 0 on a pass, 1 on a
# failure and 3 when Docker is not usable.
check_one() {
  local arg rc start built need
  arg="$1"
  COUNTER=$((COUNTER + 1))
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/check-docker.XXXXXX")" || return 1
  PROJ="$WORK/project"
  if ! resolve_target "$arg" "$PROJ"; then
    LABEL="$arg"
    fail "not a template, an overlay or a directory"
    teardown
    return 1
  fi
  if ! docker_ready; then
    echo "INCOMPLETE $LABEL: needs Docker; no image was built" >&2
    teardown
    return 3
  fi
  for need in Dockerfile docker-compose.yml .dockerignore; do
    if [ ! -f "$PROJ/$need" ]; then
      fail "$need is missing"
      teardown
      return 1
    fi
  done
  PROJECT="ptdk$$x${COUNTER}x${RANDOM}"
  SENTINEL="ptcheck-secret-$$-${RANDOM}${RANDOM}"
  echo "=== $LABEL"
  rc=1
  if write_env && check_blank_name; then
    set_project_name "$PROJECT"
    STARTED=1
    start=$(date +%s)
    if ! has_service server && is_vite && ! start_stub; then
      :
    elif ! dc "$BUILD_BOUND" build >"$WORK/build.out" 2>&1; then
      tail -n 30 "$WORK/build.out" >&2
      fail "docker compose build failed"
    else
      built=$(date +%s)
      echo "built $LABEL in $((built - start))s"
      if ! dc "$UP_BOUND" up -d --wait >"$WORK/up.out" 2>&1; then
        tail -n 30 "$WORK/up.out" >&2
        dc "$DOCKER_BOUND" logs --tail 40 >&2 2>&1
        fail "docker compose up --wait failed"
      elif has_service server; then
        if check_running && check_startup_failure && check_runtime_env &&
          check_image server && check_build_stage && check_store_env && check_migrated &&
          check_stores_down && check_switch && check_migrate_failure; then
          rc=0
        fi
      elif has_service web; then
        if check_web && check_runtime_env && check_image web && check_build_stage; then
          rc=0
        fi
      else
        fail "docker-compose.yml defines neither a server nor a web service"
      fi
    fi
  fi
  teardown
  if [ "$rc" -eq 0 ]; then
    echo "PASS $LABEL"
  fi
  return "$rc"
}

failed=0
incomplete=0
for target in "$@"; do
  check_one "$target"
  rc=$?
  case "$rc" in
    0) ;;
    3) incomplete=1 ;;
    *) echo "FAIL $target" >&2; failed=1 ;;
  esac
done
if [ "$failed" -ne 0 ]; then exit 1; fi
if [ "$incomplete" -ne 0 ]; then exit 3; fi
exit 0
