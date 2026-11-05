#!/usr/bin/env bash
# Creates a monorepo from the templates in one command:
#
#   curl -fsSL https://raw.githubusercontent.com/LiuAnBoy/project-templates/master/monorepo.sh \
#     | bash -s -- <project> <next|vite> <plain|antd|mui|heroui> <nest|fastify|fastapi> \
#       [--dashboard <next|vite> <plain|antd|mui|heroui>] [--data <store>[,redis]] [--no-docker]
#
# --data picks the data store of the server once, when the project is created:
# postgres, sqlite, mysql, redis, postgres,redis, sqlite,redis or mysql,redis
# (exactly these; fastapi takes neither choice with mysql). It
# extracts the data overlay of the server over server/, so the server brings
# its store's code, rules, settings, compose file and lockfile. --dashboard and
# --data come in any order after the four positional words.
#
# The project holds web/ (the chosen web template, with the UI overlay applied
# unless the choice is plain), server/, an optional dashboard/ built the same
# way as web/, and the workspace root with the contract package and the root
# docs. With fastapi there is no contract package (the server is a Python
# project), and the root documents say so.
#
# The project is also ready for Docker: a root docker-compose.yml, .dockerignore and
# .env.example (built by scripts/docker-blocks.mjs from the same blocks the standalone
# templates use), one Dockerfile per part, and the PostgreSQL cluster compose file
# when the store has one. --no-docker leaves all of that out and takes the Docker
# lines out of each part's .env.example; it comes at most once.
#
# The script downloads one archive, composes the project in a temporary
# directory beside the target and moves it into place only when everything
# succeeded. It validates every argument before writing anything, never
# installs, and never runs `git init`; it prints the next steps.
#
# Environment: PROJECT_TEMPLATES_ARCHIVE points at a local codeload-shaped
# archive (top folder project-templates-master/) instead of downloading one.
# Needs bash, curl (only without that variable), tar and node.
#
# Everything lives in functions and the last line calls them, so a truncated
# download defines a few functions and runs nothing.

ARCHIVE_URL="https://codeload.github.com/LiuAnBoy/project-templates/tar.gz/master"
TOP="project-templates-master"

# pt_usage: print the usage text.
pt_usage() {
  cat >&2 <<'EOF'
usage: monorepo.sh <project> <next|vite> <plain|antd|mui|heroui> <nest|fastify|fastapi>
                   [--dashboard <next|vite> <plain|antd|mui|heroui>]
                   [--data <postgres|sqlite|mysql|redis|postgres,redis|sqlite,redis|mysql,redis>]
                   [--no-docker]
EOF
}

# pt_fail <message>: print an error and return non-zero.
pt_fail() {
  echo "monorepo.sh: $1" >&2
  return 1
}

# pt_choice <value> <word>...: succeed when the value is one of the words.
pt_choice() {
  value="$1"
  shift
  for word in "$@"; do
    [ "$value" = "$word" ] && return 0
  done
  return 1
}

# pt_extract <archive> <strip> <dir> <member>: extract one folder of the archive into dir.
pt_extract() {
  tar -xzf "$1" --strip-components="$2" -C "$3" "$TOP/$4" </dev/null || {
    pt_fail "could not extract $4 from the archive"
    return 1
  }
}

# pt_edit_part <dir> <name> <wire> <shift>: rename a Node part, wire @app/contract
# into it (wire=1), and move a dashboard's ports off the web app's (shift=1).
pt_edit_part() {
  node -e '
const fs = require("fs");
const path = require("path");
const [dir, name, wire, shift] = process.argv.slice(1);

const file = path.join(dir, "package.json");
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
pkg.name = name;
if (wire === "1") {
  const deps = { ...(pkg.dependencies || {}), "@app/contract": "workspace:*" };
  pkg.dependencies = Object.fromEntries(Object.keys(deps).sort().map((k) => [k, deps[k]]));
}
if (shift === "1") {
  for (const key of ["dev", "start"]) {
    const script = (pkg.scripts || {})[key];
    if (script && /^next (dev|start)$/.test(script)) pkg.scripts[key] = script + " -p 3001";
  }
}
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");

if (shift === "1") {
  const ports = { 3000: 3001, 3100: 3101, 5173: 5174, 4173: 4174, 5273: 5274 };
  const files = [
    "vite.config.ts",
    "playwright.config.ts",
    "AGENTS.md",
    "docs/README.md",
    "docs/rules/architecture.md",
  ];
  for (const rel of files) {
    const target = path.join(dir, rel);
    if (!fs.existsSync(target)) continue;
    const text = fs.readFileSync(target, "utf8");
    fs.writeFileSync(target, text.replace(/\b(3000|3100|5173|4173|5273)\b/g, (m) => String(ports[m])));
  }
}
' "$1" "$2" "$3" "$4" </dev/null
}

# pt_web_part <archive> <root> <dir> <framework> <ui> <wire> <shift>: compose one web app.
pt_web_part() {
  mkdir -p "$2/$3" || return 1
  pt_extract "$1" 3 "$2/$3" "templates/$4" || return 1
  if [ "$5" != plain ]; then
    pt_extract "$1" 3 "$2/$3" "overlays/$4-$5" || return 1
  fi
  rm -f "$2/$3/pnpm-lock.yaml" "$2/$3/pnpm-workspace.yaml"
  pt_edit_part "$2/$3" "$3" "$6" "$7"
}

# pt_compose_name <project>: print the name compose gets for the project (lower case, dots as
# underscores, which compose accepts).
pt_compose_name() {
  printf '%s' "$1" | tr 'A-Z.' 'a-z_'
}

# pt_name_compose <file> <project>: name the project in the commands of a compose file's header.
# The file sits in server/, which compose would take as the project name, so two projects on one
# machine would share containers and volumes, and `down -v` would delete another project's data.
# With -p compose sets COMPOSE_PROJECT_NAME itself, so the header stops asking for it.
pt_name_compose() {
  compose_name="$(pt_compose_name "$2")"
  sed -e "/^#/s|docker compose -f|docker compose -p $compose_name -f|" \
    -e 's|^# Needs \.env:.*|# Needs .env: copy .env.example. The -p below names the project for compose.|' \
    -e '/^# unique on this machine, or compose refuses to start\.$/d' "$1" >"$1.named" || return 1
  mv "$1.named" "$1"
}

# pt_edge_subnet <name>: print a /24 inside 10.16.0.0-10.215.255.255 derived from the project's
# compose name, the fixed subnet of the edge network that holds the web parts and the server.
pt_edge_subnet() {
  sum="$(printf '%s' "$1" | cksum | cut -d' ' -f1)"
  echo "10.$((sum % 200 + 16)).$((sum / 200 % 256)).0/24"
}

# pt_docker_root <archive> <root> <web-fw> <server> <dash-fw> <data> <project> <docker:0|1>:
# write the Docker side of the composed tree (docker=1) or take it out (docker=0), by the
# one implementation the standalone templates are rendered with: scripts/docker-blocks.mjs
# and the layers of source/, read from the same archive.
pt_docker_root() {
  src="$(dirname "$2")/src"
  mkdir -p "$src" || return 1
  tar -xzf "$1" --strip-components=1 -C "$src" "$TOP/scripts" "$TOP/source" </dev/null || {
    pt_fail "could not extract scripts/ and source/ from the archive"
    return 1
  }
  compose_name="$(pt_compose_name "$7")"
  set -- "$@" "$(pt_edge_subnet "$compose_name")"
  args=(monorepo --src "$src" --root "$2" --web "$3" --server "$4" --name "$compose_name" --edge-subnet "$9")
  [ -n "$5" ] && args+=(--dashboard "$5")
  [ -n "$6" ] && args+=(--data "$6")
  [ "$8" = 0 ] && args+=(--no-docker)
  node "$src/scripts/docker-blocks.mjs" "${args[@]}" </dev/null || {
    pt_fail "could not compose the Docker files"
    return 1
  }
}

# pt_compose <archive> <root> <web-fw> <web-ui> <server> <dash-fw> <dash-ui> <data> <project> <docker>:
# build the project tree in root. dash-fw is empty without a dashboard, data without a store;
# docker is 1, or 0 for --no-docker.
pt_compose() {
  archive="$1"
  root="$2"
  contract=1
  [ "$5" = fastapi ] && contract=0

  pt_extract "$archive" 3 "$root" templates/workspace || return 1
  rm -f "$root/pnpm-lock.yaml"
  if [ "$contract" -eq 0 ]; then
    rm -rf "$root/contract" "$root/docs/contract.md"
    pt_extract "$archive" 3 "$root" overlays/workspace-no-contract || return 1
  fi

  pt_web_part "$archive" "$root" web "$3" "$4" "$contract" 0 || return 1
  if [ -n "$6" ]; then
    pt_web_part "$archive" "$root" dashboard "$6" "$7" "$contract" 1 || return 1
  fi

  mkdir -p "$root/server" || return 1
  pt_extract "$archive" 3 "$root/server" "templates/$5" || return 1
  if [ -n "$8" ]; then
    # The overlay of a store pair is named after both: postgres,redis -> nest-postgres-redis.
    pt_extract "$archive" 3 "$root/server" "overlays/$5-${8//,/-}" || return 1
    if [ -f "$root/server/docker-compose.dev.yml" ]; then
      pt_name_compose "$root/server/docker-compose.dev.yml" "$9" || return 1
    fi
  fi
  if [ "$5" != fastapi ]; then
    rm -f "$root/server/pnpm-lock.yaml" "$root/server/pnpm-workspace.yaml"
    pt_edit_part "$root/server" server "$contract" 0 || return 1
  fi
  pt_docker_root "$archive" "$root" "$3" "$5" "$6" "$8" "$9" "${10}" || return 1

  for expected in package.json AGENTS.md CLAUDE.md docs/README.md web/package.json server/AGENTS.md; do
    [ -e "$root/$expected" ] || { pt_fail "the archive did not provide $expected"; return 1; }
  done
}

# pt_data_steps <server> <data> <project>: print the steps a chosen store adds, nothing without one.
# The compose file sits in server/, so compose would name its project `server` and
# two projects on one machine would share containers and volumes: the project's own
# name (lower case, dots as underscores, which compose accepts) is given instead.
pt_data_steps() {
  [ -n "$2" ] || return 0
  echo "  cp server/.env.example server/.env   # the server refuses to start without its settings"
  case "$2" in
    sqlite) ;;
    *)
      echo "  docker compose -p $(pt_compose_name "$3") -f server/docker-compose.dev.yml up -d --wait   # starts the store(s); stop them with the same -p"
      ;;
  esac
  case "$2" in
    redis) ;;
    *)
      if [ "$1" = fastapi ]; then
        echo "  make -C server db-migrate            # applies the migrations"
      else
        echo "  pnpm --filter server db:migrate      # applies the migrations"
      fi
      ;;
  esac
}

# pt_docker_steps <docker:0|1>: print the optional Docker start, nothing with --no-docker.
# The image build installs from the lockfile, which the printed `pnpm install` writes.
pt_docker_steps() {
  [ "$1" = 1 ] || return 0
  echo
  echo "Docker (optional, after pnpm install has written the lockfile):"
  echo "  cp .env.example .env && docker compose up -d --build --wait"
}

# pt_next_steps <project> <server> <dashboard-fw> <web-fw> <data> <docker>: print what to do next.
# A server with a store refuses to start until its .env exists and its services run;
# its queries need the database migrated, so all three come before the dev command.
pt_next_steps() {
  echo
  echo "Created $1."
  echo
  echo "Next:"
  echo "  cd $1"
  if [ "$2" = fastapi ]; then
    echo "  pnpm install            # installs the web app(s)"
    echo "  (cd server && uv sync)  # installs the Python server"
    pt_data_steps "$2" "$5" "$1"
    echo "  pnpm dev                # starts the web app(s)"
    echo "  make -C server dev      # starts the server on port 8000, in another terminal"
  else
    echo "  pnpm install            # installs every package and builds the contract package"
    pt_data_steps "$2" "$5" "$1"
    echo "  pnpm dev                # starts the web app(s) and the server on port 8000"
  fi
  if [ "$4" = next ]; then web_port=3000; else web_port=5173; fi
  echo
  echo "web: http://localhost:$web_port"
  if [ -n "$3" ]; then
    if [ "$3" = next ]; then dash_port=3001; else dash_port=5174; fi
    echo "dashboard: http://localhost:$dash_port"
  fi
  echo "server: http://localhost:8000/api/v1/hello"
  pt_docker_steps "$6"
  echo
  echo "Optional: git init && git add -A && git commit -m 'chore: initial commit'"
}

# pt_main <args...>: validate, compose in a temporary directory, move into place.
pt_main() {
  export LC_ALL=C
  if [ "$#" -lt 4 ]; then
    pt_usage
    return 2
  fi
  project="$1"
  web_fw="$2"
  web_ui="$3"
  server="$4"
  shift 4
  dash_fw=""
  dash_ui=""
  data=""
  data_given=0
  docker=1
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dashboard)
        { [ "$#" -ge 3 ] && [ -z "$dash_fw" ]; } || { pt_usage; return 2; }
        dash_fw="$2"
        dash_ui="$3"
        shift 3
        ;;
      --data)
        { [ "$#" -ge 2 ] && [ "$data_given" -eq 0 ]; } || { pt_usage; return 2; }
        data="$2"
        data_given=1
        shift 2
        ;;
      --no-docker)
        [ "$docker" -eq 1 ] || { pt_usage; return 2; }
        docker=0
        shift
        ;;
      *)
        pt_usage
        return 2
        ;;
    esac
  done

  case "$project" in
    "" | [!A-Za-z0-9]* | *[!A-Za-z0-9._-]*)
      pt_fail "invalid project name \"$project\" (letters, digits, dot, underscore and dash; it must start with a letter or digit)"
      return 2
      ;;
  esac
  pt_choice "$web_fw" next vite || { pt_fail "unknown web framework \"$web_fw\" (next or vite)"; return 2; }
  pt_choice "$web_ui" plain antd mui heroui || { pt_fail "unknown UI choice \"$web_ui\" (plain, antd, mui or heroui)"; return 2; }
  pt_choice "$server" nest fastify fastapi || { pt_fail "unknown server \"$server\" (nest, fastify or fastapi)"; return 2; }
  if [ -n "$dash_fw" ]; then
    pt_choice "$dash_fw" next vite || { pt_fail "unknown dashboard framework \"$dash_fw\" (next or vite)"; return 2; }
    pt_choice "$dash_ui" plain antd mui heroui || { pt_fail "unknown dashboard UI choice \"$dash_ui\" (plain, antd, mui or heroui)"; return 2; }
  fi
  if [ "$data_given" -eq 1 ]; then
    pt_choice "$data" postgres sqlite mysql redis postgres,redis sqlite,redis mysql,redis || { pt_fail "unknown data choice \"$data\" (postgres, sqlite, mysql, redis, postgres,redis, sqlite,redis or mysql,redis)"; return 2; }
    case "$server,$data" in
      fastapi,mysql | fastapi,mysql,redis) pt_fail "fastapi has no MySQL overlay (nest or fastify)"; return 2 ;;
    esac
  fi

  target="$PWD/$project"
  if [ -e "$target" ] || [ -L "$target" ]; then
    pt_fail "$project already exists here; choose another name"
    return 2
  fi
  archive="${PROJECT_TEMPLATES_ARCHIVE:-}"
  if [ -n "$archive" ] && [ ! -f "$archive" ]; then
    pt_fail "PROJECT_TEMPLATES_ARCHIVE is not a file: $archive"
    return 1
  fi
  command -v tar >/dev/null 2>&1 || { pt_fail "tar is required"; return 1; }
  command -v node >/dev/null 2>&1 || { pt_fail "node is required"; return 1; }
  if [ -z "$archive" ]; then
    command -v curl >/dev/null 2>&1 || { pt_fail "curl is required"; return 1; }
  fi

  work="$(mktemp -d "$PWD/.$project.XXXXXX")" || { pt_fail "cannot write in $PWD"; return 1; }
  trap 'rm -rf "$work"' EXIT
  trap 'exit 130' INT TERM

  if [ -z "$archive" ]; then
    echo "Downloading the templates..."
    curl -fsSL "$ARCHIVE_URL" -o "$work/archive.tar.gz" </dev/null || { pt_fail "download failed: $ARCHIVE_URL"; return 1; }
    archive="$work/archive.tar.gz"
  fi

  mkdir "$work/root" || return 1
  pt_compose "$archive" "$work/root" "$web_fw" "$web_ui" "$server" "$dash_fw" "$dash_ui" "$data" "$project" "$docker" || return 1

  if [ -e "$target" ] || [ -L "$target" ]; then
    pt_fail "$project appeared while the project was being composed; nothing was moved"
    return 1
  fi
  mv "$work/root" "$target" || { pt_fail "could not move the project into place"; return 1; }
  pt_next_steps "$project" "$server" "$dash_fw" "$web_fw" "$data" "$docker"
}

pt_main "$@"
