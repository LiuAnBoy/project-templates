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
#      `/api/v1/hello` from a stub the script runs on the host at 28000, which
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
# A trap runs `down -v --rmi local` for the project, removes the build-stage
# image by name and stops the stub, and nothing else.
#
# What the script assumes of a project (the contract its files meet):
#   - `.env.example` lines are NAME=value, COMPOSE_PROJECT_NAME is one of them
#     and empty, and every host port is a *_PORT line (`PORT` for the server).
#   - `docker-compose.yml` starts with `name: ${COMPOSE_PROJECT_NAME:?...}`, has a
#     service `server` that builds the Dockerfile at the project root and answers
#     GET /api/health on its own port 8000, or no `server` and a service `web`
#     that answers GET / and publishes `WEB_PORT`; it names no `container_name`.
#   - A web service reads no `env_file`.
#   - A Python project has a `pyproject.toml`; anything else is a Node project.
#
# Exit codes: 0 every target ran and passed; 1 a target failed; 2 usage; 3 Docker
# is absent or its daemon does not answer, so the check is incomplete and never a
# pass (a failure of another target still makes the exit 1).
# Needs node on the PATH when the project is a Vite web base (the stub).
# Environment: BUILD_BOUND (seconds for a build, default 900), UP_BOUND (seconds
# for `up --wait`, default 300), DOCKER_BOUND (seconds for any other Docker
# command, default 60).
# Needs network access for package installs; base images must already be local
# or pullable, and no build passes --pull.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_BOUND="${BUILD_BOUND:-900}"
UP_BOUND="${UP_BOUND:-300}"
DOCKER_BOUND="${DOCKER_BOUND:-60}"
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
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then
    if [ "$STARTED" -eq 1 ] && [ -d "$PROJ" ]; then
      (cd "$PROJ" && run_bound "$DOCKER_BOUND" docker compose -p "$PROJECT" down -v --rmi local >/dev/null 2>&1)
    fi
    if [ -n "$BUILD_IMAGE" ]; then
      run_bound "$DOCKER_BOUND" docker rmi -f "$BUILD_IMAGE" >/dev/null 2>&1
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
        docker compose -p "$PROJECT" --project-directory "$PROJ" exec -T "$svc" printenv || return 1
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
          check_image server && check_build_stage; then
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
