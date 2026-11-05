#!/usr/bin/env bash
# Whole verification of the repository, the way a user receives it.
#
# Usage: bash scripts/verify.sh
# Stops at the first failing step and exits non-zero. Exit codes: 0 every step ran and
# passed, and VERSIONS.md was stamped with today's date; 1 a step failed; 3 every step
# passed but some real-store check could not run because Docker is absent (its last line
# is `INCOMPLETE verify: <n> overlays not checked against real services`), which is
# incomplete and never a pass, and VERSIONS.md is not stamped.
#
# Steps, in order:
#   1. tooling: bash syntax of every script, render --check, the tooling tests
#      (render, check-docs, versions)
#   2. a codeload-shaped archive of the files on disk (make-archive.sh)
#   3. every UI overlay through check-overlays.sh
#   4. every data overlay of recipes.mjs, one at a time through check-overlays.sh: the
#      static checks of all of them, and check-store.sh (real services) for those in DATA_LIVE
#   5. every template, extracted from that archive with the README's tar flags
#      into an empty directory: check-template, live-check, check-docs, then
#      `git init` there and `git check-ignore .env`
#   6. monorepo.sh against the archive, five compositions: install, check-docs,
#      typecheck, then both sides started and /api/v1/hello curled through the
#      web port(s) with the whole envelope asserted. Two of them carry a store: with
#      `--data sqlite` the server's .env is written and the database migrated; with
#      `--data postgres,redis` the compose file of server/ is started with the command
#      its own header prints (which must name the project), .env is written, the
#      database migrated, and the compose project is dropped afterwards
#   7. monorepo.sh refuses bad input with exit 2 and writes nothing (`--no-docker` twice
#      included), and one composition made with `--no-docker` has none of the Docker files
#   8. the images: check-docker.sh on every target of DOCKER_LIVE, then on three
#      compositions (`next plain nest --dashboard vite plain --data postgres,redis`,
#      `vite plain fastapi --data sqlite`, `next plain fastify --data sqlite`), one at a
#      time; a target that exits 3 is counted as incomplete, any other failure stops the run
#   9. node scripts/versions.mjs --stamp, only when nothing was left incomplete
# Needs network access (package installs), pnpm, uv, git, curl and node, and Docker for
# the real-store checks. The ports a run uses must be free: 8000 plus the web ports of a
# composition (3000, 3001, 15173), and 15432 (PostgreSQL), 13306 (MySQL) and 16379
# (Redis) for the services of the data overlays and of the PostgreSQL composition.
# The Docker step (8) uses only moved ports: 23000 and 23001 (web parts), 28000 (server and
# the Vite stub), 25432 (PostgreSQL), 23306 (MySQL) and 26379 (Redis).
# The Vite compositions run on 15173 rather than its default 5173, because a Vite dev
# server is often running for other work on the machine, and the proxy under test does
# not depend on the port.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HELLO='{"success":true,"payload":{"data":{"message":"hello world!!"}}}'
PROBE='{"success":true,"payload":{"data":{"parsed":true}}}'
READY_TIMEOUT=180

set -m # background servers get their own process group so the whole tree can be killed

WORK="$(mktemp -d "${TMPDIR:-/tmp}/verify.XXXXXX")" || exit 1
PIDS=""
COMPOSES=""    # "<dir>|<compose project>" of every compose project this run started
INCOMPLETE=0   # real-store checks that could not run because Docker is absent

# stop_all: terminate every background process group started by this script.
stop_all() {
  for pid in $PIDS; do
    kill -TERM -- "-$pid" 2>/dev/null
  done
  for pid in $PIDS; do
    i=0
    while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 20 ]; do
      sleep 0.25
      i=$((i + 1))
    done
    kill -KILL -- "-$pid" 2>/dev/null
    { wait "$pid"; } 2>/dev/null
  done
  PIDS=""
}

# drop_composes: stop and drop every compose project this run started, and only those.
drop_composes() {
  for entry in $COMPOSES; do
    (cd "${entry%%|*}" && docker compose -p "${entry#*|}" -f docker-compose.dev.yml down -v >/dev/null 2>&1)
  done
  COMPOSES=""
}

cleanup() {
  stop_all
  drop_composes
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# die <message>: report a failure and stop.
die() {
  echo "FAIL verify: $1" >&2
  exit 1
}

# step <label> <command...>: run a command; stop the whole run when it fails.
step() {
  label="$1"
  shift
  echo
  echo "##### $label"
  "$@" || die "$label"
}

# port_busy <port>: succeed when something accepts connections on the port.
port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0
  (exec 3<>"/dev/tcp/::1/$1") 2>/dev/null && return 0
  return 1
}

# require_free <port>...: stop when a port is taken, so no assertion meets a foreign process.
require_free() {
  for port in "$@"; do
    port_busy "$port" && die "port $port is already in use"
  done
}

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

# start_bg <name> <dir> <command...>: start a command in the background, log under WORK.
start_bg() {
  name="$1"
  dir="$2"
  shift 2
  (cd "$dir" && exec "$@") >"$WORK/$name.log" 2>&1 </dev/null &
  PIDS="$PIDS $!"
  echo "started $name (pid $!)"
}

# wait_http <name> <url>: wait until the URL answers a 200, or stop.
wait_http() {
  i=0
  while [ "$i" -lt "$READY_TIMEOUT" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$2")"
    [ "$code" = 200 ] && return 0
    sleep 1
    i=$((i + 1))
  done
  echo "--- log of $1" >&2
  tail -n 40 "$WORK/$1.log" >&2
  die "$1 did not answer 200 on $2 within ${READY_TIMEOUT}s"
}

# assert_body <url> <expected>: the URL answers 200 and exactly the expected body.
assert_body() {
  code="$(curl -s -o "$WORK/body" -w '%{http_code}' --max-time 20 "$1")"
  body="$(cat "$WORK/body")"
  if [ "$code" != 200 ] || [ "$body" != "$2" ]; then
    echo "expected 200 and: $2" >&2
    echo "got $code:        $body" >&2
    die "unexpected answer from $1"
  fi
  echo "ok   $1"
}

# extract_template <name> <dir>: fetch a template with the README's command shape.
extract_template() {
  (cd "$2" && tar -xz --strip=2 "project-templates-master/templates/$1" <"$ARCH")
}

# check_template_dir <name>: the three checks plus the .env ignore, on an extracted template.
check_template_dir() {
  name="$1"
  dir="$WORK/t-$name"
  rm -rf "$dir"
  mkdir -p "$dir" || return 1
  extract_template "$name" "$dir" || return 1
  project="$dir/$name"
  bash "$ROOT/scripts/check-template.sh" "$project" || return 1
  bash "$ROOT/scripts/live-check.sh" "$project" || return 1
  node "$ROOT/scripts/check-docs.mjs" "$project" || return 1
  git -C "$project" init -q || return 1
  : >"$project/.env"
  git -C "$project" check-ignore -q .env || {
    echo "FAIL $name: git does not ignore .env in the extracted template" >&2
    return 1
  }
  rm -rf "$dir"
  echo "PASS template $name"
}

# compose <dir> <project> <args...>: run monorepo.sh against the archive in a fresh directory.
compose() {
  dir="$1"
  shift
  rm -rf "$dir"
  mkdir -p "$dir" || return 1
  (cd "$dir" && PROJECT_TEMPLATES_ARCHIVE="$ARCH" bash "$ROOT/monorepo.sh" "$@") || return 1
}

# add_probes <project> <server>: a page and a server handler that import
# @app/contract at runtime, written into the composed project (not the repo).
add_probes() {
  proj="$1"
  mkdir -p "$proj/web/src/app/contract-probe" || return 1
  cat >"$proj/web/src/app/contract-probe/page.tsx" <<'EOF'
import { helloResponseSchema } from '@app/contract';

/** Runtime probe: the page renders what the shared schema says about a valid body. */
export default function Page() {
  const parsed = helloResponseSchema.safeParse({
    success: true,
    payload: { data: { message: 'x' } },
  }).success;
  return <p>contract-probe:{String(parsed)}</p>;
}
EOF
  [ "$2" = nest ] || return 1
  cat >"$proj/server/src/modules/hello/controllers/contract-probe.controller.ts" <<'EOF'
import { helloResponseSchema } from '@app/contract';
import { Controller, Get } from '@nestjs/common';

/** Runtime probe: a handler that parses with the shared schema. */
@Controller('contract-probe')
export class ContractProbeController {
  /** `GET /api/v1/contract-probe`. */
  @Get()
  get(): { parsed: boolean } {
    const parsed = helloResponseSchema.safeParse({
      success: true,
      payload: { data: { message: 'x' } },
    }).success;
    return { parsed };
  }
}
EOF
  node -e '
const fs = require("fs");
const file = process.argv[1] + "/server/src/modules/hello/hello.module.ts";
let text = fs.readFileSync(file, "utf8");
text = "import { ContractProbeController } from \"./controllers/contract-probe.controller.js\";\n" + text;
text = text.replace("controllers: [HelloController]", "controllers: [HelloController, ContractProbeController]");
fs.writeFileSync(file, text);
' "$proj" </dev/null
}

# data_of <compose args...>: print the value that follows --data, nothing without one.
data_of() {
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--data" ]; then
      echo "$2"
      return 0
    fi
    shift
  done
  return 0
}

# move_ports <env-file>: point the file at the ports of this script's own services, 15432
# (PostgreSQL) and 16379 (Redis), in the *_PORT lines and inside the URLs.
move_ports() {
  sed -E \
    -e "s/^POSTGRES_PORT=.*/POSTGRES_PORT=15432/" \
    -e "s/^REDIS_PORT=.*/REDIS_PORT=16379/" \
    -e "/_PORT=/!s/:5432([^0-9]|\$)/:15432\\1/g" \
    -e "/_PORT=/!s/:6379([^0-9]|\$)/:16379\\1/g" \
    "$1" >"$1.moved" && mv "$1.moved" "$1"
}

# prepare_store <proj> <server> <data> <project>: do what the printed next steps say before the
# dev command: .env, the services (their compose project is dropped by the cleanup), the migration.
# Returns 3 when the services need Docker and it is absent.
prepare_store() {
  proj="$1"
  server="$2"
  data="$3"
  project="$4"
  cp "$proj/server/.env.example" "$proj/server/.env" || return 1
  if [ -f "$proj/server/docker-compose.dev.yml" ]; then
    docker_ready || return 3
    require_free 15432 16379
    move_ports "$proj/server/.env" || return 1
    # The header names the project, or two projects on one machine would share containers
    # and volumes, and `down -v` of one would delete the other's data.
    compose_name="$(printf '%s' "$project" | tr 'A-Z.' 'a-z_')"
    grep -q "^# Start:  *docker compose -p $compose_name -f docker-compose.dev.yml" "$proj/server/docker-compose.dev.yml" ||
      { echo "FAIL the header of the composed compose file does not name the project $compose_name" >&2; return 1; }
    COMPOSES="$COMPOSES $proj/server|$compose_name"
    start_cmd="$(sed -n 's/^# Start: *//p' "$proj/server/docker-compose.dev.yml")"
    (cd "$proj/server" && bash -c "$start_cmd") || return 1
  fi
  case "$data" in
    redis) ;;
    *)
      if [ "$server" = fastapi ]; then
        (cd "$proj/server" && make db-migrate) || return 1
      else
        (cd "$proj" && pnpm --filter server db:migrate) || return 1
      fi
      ;;
  esac
}

# compose_and_run <name> <probes:0|1> <web-port...> -- <compose args...>:
# compose, install, check, then run both sides live and assert hello through each web port.
# With --data the store is prepared first, as the printed next steps say.
compose_and_run() {
  cname="$1"
  probes="$2"
  shift 2
  ports=""
  while [ "$1" != "--" ]; do
    ports="$ports $1"
    shift
  done
  shift
  data="$(data_of "$@")"
  project=app
  [ -n "$data" ] && project="ptv$$$cname"
  proj="$WORK/m-$cname/$project"
  web="$1"
  server="$3"
  echo "=== monorepo $cname: $*"
  compose "$WORK/m-$cname" "$project" "$@" || return 1
  (cd "$proj" && pnpm install) || return 1
  if [ "$server" = fastapi ]; then
    (cd "$proj/server" && uv sync --frozen) || return 1
  fi
  node "$ROOT/scripts/check-docs.mjs" "$proj" || return 1
  [ "$probes" = 1 ] && { add_probes "$proj" "$server" || return 1; }
  (cd "$proj" && pnpm typecheck) || return 1

  if [ -n "$data" ]; then
    prepare_store "$proj" "$server" "$data" "$project"
    rc=$?
    if [ "$rc" -eq 3 ]; then
      echo "INCOMPLETE monorepo $cname: needs Docker; its services were not started"
      INCOMPLETE=$((INCOMPLETE + 1))
      rm -rf "$WORK/m-$cname"
      return 0
    fi
    [ "$rc" -eq 0 ] || return 1
  fi

  require_free 8000 $ports
  if [ "$server" = fastapi ]; then
    start_bg server "$proj/server" make start
  else
    (cd "$proj" && pnpm --dir server run build) || return 1
    start_bg server "$proj/server" pnpm run start
  fi
  wait_http server "http://localhost:8000/api/v1/hello"
  assert_body "http://localhost:8000/api/v1/hello" "$HELLO"
  [ "$probes" = 1 ] && assert_body "http://localhost:8000/api/v1/contract-probe" "$PROBE"

  if [ "$web" = vite ]; then
    start_bg web "$proj/web" pnpm run dev --port "${ports# }" --strictPort
  else
    start_bg web "$proj/web" pnpm run dev
  fi
  case " $ports " in *" 3001 "* | *" 5174 "*) start_bg dashboard "$proj/dashboard" pnpm run dev ;; esac
  for port in $ports; do
    wait_http "web" "http://localhost:$port/api/v1/hello"
  done
  for port in $ports; do
    assert_body "http://localhost:$port/api/v1/hello" "$HELLO"
  done
  if [ "$probes" = 1 ]; then
    first="${ports# }"
    first="${first%% *}"
    curl -s --max-time 120 "http://localhost:$first/contract-probe" | grep -Eq 'contract-probe:(<!-- -->)?true' ||
      die "the web page did not render the result of @app/contract at runtime"
    echo "ok   web page imports @app/contract at runtime"
  fi
  stop_all
  drop_composes
  rm -rf "$WORK/m-$cname"
  echo "PASS monorepo $cname"
}

# data_overlays: every data overlay of recipes.mjs through check-overlays.sh, one at a time, so
# an overlay that needs Docker can be told from one that failed.
data_overlays() {
  names="$(node -e 'import(require("url").pathToFileURL(process.argv[1]).href).then((m) => console.log(Object.keys(m.dataOverlays).join("\n")))' "$ROOT/scripts/recipes.mjs")" || return 1
  for overlay in $names; do
    bash "$ROOT/scripts/check-overlays.sh" "$overlay"
    rc=$?
    case "$rc" in
      0) ;;
      3)
        INCOMPLETE=$((INCOMPLETE + 1))
        echo "INCOMPLETE $overlay: needs Docker; no real-store check ran"
        ;;
      *) return 1 ;;
    esac
  done
}

# check_no_docker: a composition made with --no-docker holds none of the Docker files.
check_no_docker() {
  compose "$WORK/m-nodocker" nodocker vite plain nest --data postgres --no-docker || return 1
  proj="$WORK/m-nodocker/nodocker"
  for part in web server; do
    for f in Dockerfile docker-compose.yml .dockerignore nginx; do
      [ ! -e "$proj/$part/$f" ] || { echo "FAIL --no-docker left $part/$f" >&2; return 1; }
    done
  done
  [ ! -e "$proj/docker-compose.yml" ] && [ ! -e "$proj/.dockerignore" ] && [ ! -e "$proj/server/docker-compose.postgres-cluster.yml" ] ||
    { echo "FAIL --no-docker left a Docker file" >&2; return 1; }
  [ -f "$proj/server/docker-compose.dev.yml" ] || { echo "FAIL --no-docker removed docker-compose.dev.yml" >&2; return 1; }
  if grep -q -E '^(COMPOSE_PROJECT_NAME|COMPOSE_FILE|[A-Z_]*_DOCKER_NETWORK|DOCKER_API_HOST|WEB_PORT)=' "$proj/web/.env.example" "$proj/server/.env.example"; then
    echo "FAIL --no-docker left a Docker line in a .env.example" >&2
    return 1
  fi
  node "$ROOT/scripts/check-docs.mjs" "$proj" || return 1
  rm -rf "$WORK/m-nodocker"
  echo "PASS monorepo --no-docker"
}

# docker_run <label> <check-docker args...>: run check-docker.sh; exit 3 counts as incomplete,
# any other failure is a failure.
docker_run() {
  label="$1"
  shift
  bash "$ROOT/scripts/check-docker.sh" "$@"
  rc=$?
  case "$rc" in
    0) ;;
    3)
      INCOMPLETE=$((INCOMPLETE + 1))
      echo "INCOMPLETE $label: needs Docker; no image was built"
      ;;
    *) return 1 ;;
  esac
}

# docker_targets: the images of every DOCKER_LIVE target, then of three compositions.
docker_targets() {
  names="$(node -e 'import(require("url").pathToFileURL(process.argv[1]).href).then((m) => console.log(m.DOCKER_LIVE.join("\n")))' "$ROOT/scripts/recipes.mjs")" || return 1
  for target in $names; do
    docker_run "$target" "$target" || return 1
  done
  compose "$WORK/d-1" dk1 next plain nest --dashboard vite plain --data postgres,redis || return 1
  compose "$WORK/d-2" dk2 vite plain fastapi --data sqlite || return 1
  compose "$WORK/d-3" dk3 next plain fastify --data sqlite || return 1
  for n in 1 2 3; do
    docker_run "composition $n" "$WORK/d-$n/dk$n" || return 1
    rm -rf "$WORK/d-$n"
  done
}

# listing <dir>: print the names inside a directory, including dotfiles.
listing() {
  ls -A "$1"
}

# check_refusals: monorepo.sh refuses bad input with exit 2 (never any other code, never 0)
# and writes nothing.
check_refusals() {
  dir="$WORK/refuse"
  rm -rf "$dir"
  mkdir -p "$dir/existing" || return 1
  echo keep >"$dir/existing/marker"
  before="$(listing "$dir")"
  run() {
    (cd "$dir" && PROJECT_TEMPLATES_ARCHIVE="$ARCH" bash "$ROOT/monorepo.sh" "$@") >"$WORK/refuse.log" 2>&1
  }
  # refused <words...>: the call must end with exit 2; the words are passed as given.
  refused() {
    run "$@"
    rc=$?
    [ "$rc" -eq 2 ] || { echo "FAIL monorepo.sh exited $rc, not 2, for: $*" >&2; return 1; }
  }
  for bad in \
    "p nope plain nest" \
    "p next nope nest" \
    "p next plain nope" \
    "p next plain nest --dashboard nope plain" \
    "p next plain nest --dashboard next nope" \
    "p next plain nest --other next plain" \
    "p next plain nest --data" \
    "p next plain nest --data nope" \
    "p next plain nest --data redis,postgres" \
    "p next plain nest --data redis,mysql" \
    "p next plain nest --data mysql,sqlite" \
    "p next plain fastapi --data mysql" \
    "p next plain fastapi --data mysql,redis" \
    "p next plain nest --data postgres,sqlite" \
    "p next plain nest --data postgres,redis,redis" \
    "p next plain nest --data redis --data redis" \
    "p next plain nest --no-docker --no-docker" \
    "p next plain nest --data redis --dashboard next" \
    "p next plain nest --dashboard next plain --data nope" \
    "p next plain nest --data sqlite --dashboard nope plain" \
    "p next plain" \
    "../escape next plain nest" \
    "-bad next plain nest" \
    "a/b next plain nest" \
    "existing next plain nest"; do
    # shellcheck disable=SC2086 # the words are the point
    refused $bad || return 1
  done
  # An empty value is one word that no split can show, so these are quoted calls.
  refused p next plain nest --data "" || return 1
  refused p next plain nest --data "" --data redis || return 1
  refused p next plain nest --data redis --data "" || return 1
  refused "" next plain nest || return 1
  [ "$(listing "$dir")" = "$before" ] || { echo "FAIL monorepo.sh wrote something while refusing" >&2; return 1; }
  [ "$(cat "$dir/existing/marker")" = keep ] && [ "$(listing "$dir/existing")" = marker ] || {
    echo "FAIL monorepo.sh touched an existing target" >&2
    return 1
  }
  [ ! -e "$WORK/escape" ] || { echo "FAIL monorepo.sh escaped the working directory" >&2; return 1; }
  echo "PASS refusals"
}

step "bash syntax of every script" bash -c 'for f in "$0"/monorepo.sh "$0"/scripts/*.sh; do bash -n "$f" || exit 1; done' "$ROOT"
step "render --check" node "$ROOT/scripts/render.mjs" --check
step "render tests" node "$ROOT/scripts/test-render.mjs"
step "check-docs tests" node "$ROOT/scripts/test-check-docs.mjs"
step "versions tests" node "$ROOT/scripts/test-versions.mjs"

ARCH="$WORK/archive.tar.gz"
step "archive" bash "$ROOT/scripts/make-archive.sh" "$ARCH"
export ARCHIVE="$ARCH"

step "overlays" bash "$ROOT/scripts/check-overlays.sh" next-antd next-mui next-heroui vite-antd vite-mui vite-heroui
step "data overlays" data_overlays

for template in next vite nest fastify fastapi workspace; do
  step "template $template" check_template_dir "$template"
done

step "monorepo next antd nest" compose_and_run first 1 3000 -- next antd nest
step "monorepo vite plain fastapi" compose_and_run second 0 15173 -- vite plain fastapi
step "monorepo next plain nest with dashboard next antd" compose_and_run third 0 3000 3001 -- next plain nest --dashboard next antd
step "monorepo next plain fastify with sqlite" compose_and_run fourth 0 3000 -- next plain fastify --data sqlite
step "monorepo vite plain fastapi with postgres and redis" compose_and_run fifth 0 15173 -- vite plain fastapi --data postgres,redis
step "monorepo refusals" check_refusals
step "monorepo without Docker" check_no_docker
step "docker images" docker_targets

if [ ! -f "$ROOT/scripts/versions.mjs" ]; then
  die "scripts/versions.mjs does not exist yet; VERSIONS.md was not stamped"
fi

# A run that could not reach Docker has checked less than it claims: it is incomplete, it does
# not stamp VERSIONS.md, and its last line says so.
if [ "$INCOMPLETE" -gt 0 ]; then
  echo
  echo "INCOMPLETE verify: $INCOMPLETE overlays not checked against real services"
  exit 3
fi
step "stamp VERSIONS.md" node "$ROOT/scripts/versions.mjs" --stamp

echo
echo "PASS verify: every step passed"
