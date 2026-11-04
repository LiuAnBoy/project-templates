#!/usr/bin/env bash
# Whole verification of the repository, the way a user receives it.
#
# Usage: bash scripts/verify.sh
# Stops at the first failing step and exits non-zero; exits 0 only when every
# step passed, and then stamps VERSIONS.md with today's date.
#
# Steps, in order:
#   1. tooling: bash syntax of every script, render --check, the tooling tests
#      (render, check-docs, versions)
#   2. a codeload-shaped archive of the files on disk (make-archive.sh)
#   3. every UI overlay through check-overlays.sh
#   4. every template, extracted from that archive with the README's tar flags
#      into an empty directory: check-template, live-check, check-docs, then
#      `git init` there and `git check-ignore .env`
#   5. monorepo.sh against the archive, three compositions: install, check-docs,
#      typecheck, then both sides started and /api/v1/hello curled through the
#      web port(s) with the whole envelope asserted
#   6. monorepo.sh refuses an unknown name and an existing target and writes nothing
#   7. node scripts/versions.mjs --stamp
# Needs network access (package installs), pnpm, uv, git, curl and node.
# The ports a composition uses must be free: 8000 plus its web ports (3000, 3001, 15173).
# The Vite composition runs on 15173 rather than its default 5173, because a Vite dev
# server is often running for other work on the machine, and the proxy under test does
# not depend on the port.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HELLO='{"success":true,"payload":{"data":{"message":"hello world!!"}}}'
PROBE='{"success":true,"payload":{"data":{"parsed":true}}}'
READY_TIMEOUT=180

set -m # background servers get their own process group so the whole tree can be killed

WORK="$(mktemp -d "${TMPDIR:-/tmp}/verify.XXXXXX")" || exit 1
PIDS=""

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

cleanup() {
  stop_all
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

# compose <dir> <args...>: run monorepo.sh against the archive in a fresh directory.
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

# compose_and_run <name> <probes:0|1> <web-port...> -- <compose args...>:
# compose, install, check, then run both sides live and assert hello through each web port.
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
  proj="$WORK/m-$cname/app"
  web="$1"
  server="$3"
  echo "=== monorepo $cname: $*"
  compose "$WORK/m-$cname" app "$@" || return 1
  (cd "$proj" && pnpm install) || return 1
  if [ "$server" = fastapi ]; then
    (cd "$proj/server" && uv sync --frozen) || return 1
  fi
  node "$ROOT/scripts/check-docs.mjs" "$proj" || return 1
  [ "$probes" = 1 ] && { add_probes "$proj" "$server" || return 1; }
  (cd "$proj" && pnpm typecheck) || return 1

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
  rm -rf "$WORK/m-$cname"
  echo "PASS monorepo $cname"
}

# listing <dir>: print the names inside a directory, including dotfiles.
listing() {
  ls -A "$1"
}

# check_refusals: monorepo.sh refuses bad input and writes nothing.
check_refusals() {
  dir="$WORK/refuse"
  rm -rf "$dir"
  mkdir -p "$dir/existing" || return 1
  echo keep >"$dir/existing/marker"
  before="$(listing "$dir")"
  run() {
    (cd "$dir" && PROJECT_TEMPLATES_ARCHIVE="$ARCH" bash "$ROOT/monorepo.sh" "$@") >"$WORK/refuse.log" 2>&1
  }
  for bad in \
    "p nope plain nest" \
    "p next nope nest" \
    "p next plain nope" \
    "p next plain nest --dashboard nope plain" \
    "p next plain nest --dashboard next nope" \
    "p next plain nest --other next plain" \
    "p next plain" \
    "../escape next plain nest" \
    "-bad next plain nest" \
    "a/b next plain nest" \
    "existing next plain nest"; do
    # shellcheck disable=SC2086 # the words are the point
    run $bad && { echo "FAIL monorepo.sh accepted: $bad" >&2; return 1; }
  done
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

for template in next vite nest fastify fastapi workspace; do
  step "template $template" check_template_dir "$template"
done

step "monorepo next antd nest" compose_and_run first 1 3000 -- next antd nest
step "monorepo vite plain fastapi" compose_and_run second 0 15173 -- vite plain fastapi
step "monorepo next plain nest with dashboard next antd" compose_and_run third 0 3000 3001 -- next plain nest --dashboard next antd
step "monorepo refusals" check_refusals

if [ ! -f "$ROOT/scripts/versions.mjs" ]; then
  die "scripts/versions.mjs does not exist yet; VERSIONS.md was not stamped"
fi
step "stamp VERSIONS.md" node "$ROOT/scripts/versions.mjs" --stamp

echo
echo "PASS verify: every step passed"
