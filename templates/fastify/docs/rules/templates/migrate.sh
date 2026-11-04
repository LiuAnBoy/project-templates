#!/usr/bin/env bash
# migrate.sh - hand-written SQL migration runner (bash + psql).
#
# Purpose:
#   Copy this file into a project as db/migrate.sh. It applies db/migrations/*.sql
#   in name order, each file in its own transaction together with its
#   public.schema_migrations row, so a failure leaves neither. It stops, before any file
#   applies, when an already applied file has changed on disk. The same file serves
#   Node and Python projects.
#
# Layout (beside this script):
#   db/init.sql             full schema of a new environment
#   db/migrations/          YYYYMMDD_00X_<name>.sql, rerunnable (IF NOT EXISTS, guarded data changes)
#   db/migrate.sh           this file
#
# Usage:
#   migrate.sh [apply]          apply every migration not yet recorded. A database without
#                               schema_migrations is a new environment: init.sql runs first
#                               (with the creation of schema_migrations, in one transaction),
#                               then every migration, each recorded.
#   migrate.sh check PREV_INIT  schema check: build one empty scratch database from PREV_INIT
#                               plus every migration, another from db/init.sql, and compare
#                               their pg_dump --schema-only output (exit 1 on a difference).
#                               PREV_INIT is a file, e.g. from: git show master:db/init.sql
#
# Environment:
#   DATABASE_URL        postgresql:// URL of the target; when set it is used and the PG*
#                       variables only fill what the URL leaves out. Otherwise psql reads
#                       the libpq PG* variables. The script holds no default host, port
#                       or credential.
#   MIGRATE_SCRATCH_SUFFIX  check only: replaces the random suffix of the scratch database
#                       names (migrate_check_<suffix>_prev / _new); letters, digits, _ .
#
# Rules:
#   - The bookkeeping table is always public.schema_migrations, never resolved through
#     search_path. A scanned file may carry CRLF line endings; a carriage return anywhere
#     else in a line is refused, since it ends a -- comment for psql but not for the scan.
#   - A name in db/migrations/ that does not match YYYYMMDD_00X_<name>.sql stops the run
#     before any file applies.
#   - The runner enforces that a file stays inside its transaction. Before anything applies
#     it scans init.sql and every pending migration, ignoring comments, quoted strings and
#     dollar-quoted bodies (so DO $$ BEGIN ... END $$ is fine), and refuses: a top-level
#     BEGIN, START, COMMIT, END, ROLLBACK, ABORT, SAVEPOINT, RELEASE or PREPARE TRANSACTION
#     (the END closing a CREATE FUNCTION ... BEGIN ATOMIC body is allowed); any psql
#     backslash meta-command outside quotes (the bare \restrict / \unrestrict lines and the
#     SET standard_conforming_strings = on and set_config('search_path', ...) header lines
#     of a pg_dump file are skipped); a statement that starts with a psql variable (:name); and
#     the statements that cannot run in a transaction, such as CREATE INDEX CONCURRENTLY,
#     DROP INDEX CONCURRENTLY, REINDEX CONCURRENTLY, DETACH PARTITION CONCURRENTLY and
#     VACUUM (REFRESH MATERIALIZED VIEW CONCURRENTLY is allowed); and any mention of
#     standard_conforming_strings, backslash_quote or set_config, or a RESET ALL, since
#     changing how strings are lexed would let text the scan reads as a string run as a
#     statement. Every session pins standard_conforming_strings on. As a second layer, each file's
#     transaction id is recorded at its start and asserted equal just before the
#     schema_migrations insert; on any failure the runner asks the server (txid_status)
#     whether the file rolled back, and says "rolled back" only when the server confirms it.
#   - What this guarantees: a file written in good faith either applies with its row or
#     leaves neither. The scan is not a parser: a file built to evade it (dynamic SQL in a
#     DO body that changes the lexing, say) can still commit part of itself, and then the
#     second layer reports "committed outside the runner's transaction", never "rolled
#     back". Whoever writes a migration can already change anything in the database, so
#     the scan guards against mistakes, not against its own authors.
#   - The check refuses a DATABASE_URL whose query has a dbname parameter (any case, or
#     percent-encoded), since it would override the scratch database name. Scratch
#     connections on the PG* route pass the name with psql -d, which beats PGDATABASE.
#   - The check role needs CREATEDB. It creates two scratch databases on the target server
#     and, on exit (failure included), drops only the ones whose CREATE succeeded in this
#     run; a name that already exists makes the check fail and is never dropped.
#   - Two runners against one database at once are not guarded.
#
# Exit codes: 0 success, 1 failure or check difference, 2 usage error.
# Needs bash 3.2+, psql 14+, pg_dump (check only), sha256sum or shasum.

set -u
export LC_ALL=C

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
INIT_SQL="$SCRIPT_DIR/init.sql"
MIG_DIR="$SCRIPT_DIR/migrations"
NAME_RE='^[0-9]{8}_00[0-9]_[A-Za-z0-9_-]+\.sql$'
TARGET="${DATABASE_URL:-}"
MIGRATIONS=""
CREATED_PREV=0
CREATED_NEW=0
PREV_DB=""
NEW_DB=""
WORK=""
CUR_SUM=""

die() {
  printf 'migrate: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf 'usage: %s [apply | check PREV_INIT_SQL]\n' "$0" >&2
  exit 2
}

# Drop the scratch databases this run created, then remove the work directory.
cleanup() {
  local rc=$?
  trap - EXIT
  if [ "$CREATED_PREV" = 1 ]; then drop_scratch "$PREV_DB"; fi
  if [ "$CREATED_NEW" = 1 ]; then drop_scratch "$NEW_DB"; fi
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
  exit "$rc"
}

# psql_db TARGET ARGS...  (TARGET empty = ambient PG* connection). Every session first
# runs SET standard_conforming_strings = on, before any file: the scan lexes strings by
# that rule, and psql must too. A SET in the session beats an ambient PGOPTIONS, an
# options= parameter in the URL and any database or role default alike.
psql_db() {
  local target="$1"
  shift
  if [ -n "$target" ]; then
    psql -X -q -v ON_ERROR_STOP=1 -d "$target" -c 'SET standard_conforming_strings = on' "$@"
  else
    psql -X -q -v ON_ERROR_STOP=1 -c 'SET standard_conforming_strings = on' "$@"
  fi
}

# scalar TARGET SQL [psql args]: print the single value the SQL returns.
scalar() {
  local target="$1" sql="$2"
  shift 2
  printf '%s\n' "$sql" | psql_db "$target" -At "$@" -f -
}

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# Fill MIGRATIONS (newline-separated, name order) or stop on a bad name.
collect_migrations() {
  [ -d "$MIG_DIR" ] || die "missing directory $MIG_DIR"
  local entry name
  for entry in "$MIG_DIR"/*; do
    [ -e "$entry" ] || continue
    name=${entry##*/}
    if [ ! -f "$entry" ] || ! [[ $name =~ $NAME_RE ]]; then
      die "bad name in migrations/: $name (expected YYYYMMDD_00X_<name>.sql)"
    fi
    MIGRATIONS="${MIGRATIONS}${name}"$'\n'
  done
}

write_work_files() {
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/migrate.XXXXXX") || die "cannot create a work directory"
  cat >"$WORK/begin.sql" <<'SQL'
SELECT txid_current() AS mig_tx \gset
\echo MIGRATE_TX :mig_tx
SQL
  # Runs after every file: a pg_dump init.sql empties search_path, and a file may change it,
  # so the bookkeeping that follows does not depend on it; the bookkeeping table is always
  # named public.schema_migrations, so a search_path a file or role sets cannot redirect it.
  cat >"$WORK/check.sql" <<'SQL'
RESET search_path;
SELECT (txid_current() = :mig_tx) AS same_tx \gset
\if :same_tx
\else
DO $$ BEGIN RAISE EXCEPTION 'migrate: the file ended the runner''s transaction and committed outside it'; END $$;
\endif
SQL
  cat >"$WORK/record.sql" <<'SQL'
INSERT INTO public.schema_migrations (filename, checksum) VALUES (:'fname', :'sum');
SQL
  cat >"$WORK/table.sql" <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename   text PRIMARY KEY,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL
  cat >"$WORK/scan.awk" <<'AWK'
# Strip comments, quoted strings and dollar-quoted bodies, then look for
# transaction control at statement start, psql meta-commands and variables,
# and statements that cannot run in a transaction.
# Strip a trailing carriage return first, so a CRLF file matches the header rules and lexes alike.
# A carriage return left inside a line is refused: the server and psql end a -- comment at a
# lone CR, this scan only at a newline, so text after it would run unseen.
{ sub(/\r$/, "") }
/\r/ { print "carriage return inside a line (a lone CR ends a comment for the server but not for this scan)"; exit 1 }
/^\\(un)?restrict [A-Za-z0-9]*$/ { next }
# The two header lines every pg_dump file carries keep the standard lexing; skip them.
/^SET standard_conforming_strings = on;$/ { next }
/^SELECT pg_catalog\.set_config\('search_path', '', false\);$/ { next }
{ buf = buf $0 "\n" }
END {
  n = length(buf); st = 0; depth = 0; rest = ""; i = 1; esc = 0; closed = 0
  while (i <= n) {
    c = substr(buf, i, 1); c2 = substr(buf, i, 2)
    if (st == 0) {
      if (c2 == "--") { st = 1; i += 2; rest = rest " "; continue }
      if (c2 == "/*") { st = 2; depth = 1; i += 2; rest = rest " "; continue }
      if (c == "'") {
        if (closed != i - 1) {
          esc = 0
          if (i > 1 && substr(buf, i - 1, 1) ~ /[eE]/ && !(i > 2 && substr(buf, i - 2, 1) ~ /[A-Za-z0-9_]/)) esc = 1
        }
        st = 3; i++; rest = rest " "; continue
      }
      if (c == "\"") { st = 5; i++; rest = rest " "; continue }
      if (c == "$" && (i == 1 || substr(buf, i - 1, 1) !~ /[A-Za-z0-9_]/)) {
        j = i + 1
        while (substr(buf, j, 1) ~ /[A-Za-z0-9_]/) j++
        if (substr(buf, j, 1) == "$" && substr(buf, i + 1, 1) !~ /[0-9]/) {
          tag = substr(buf, i, j - i + 1); st = 4; i = j + 1; rest = rest " "; continue
        }
      }
      rest = rest c; i++; continue
    }
    if (st == 1) { if (c == "\n") { st = 0; rest = rest "\n" }; i++; continue }
    if (st == 2) {
      if (c2 == "/*") { depth++; i += 2 }
      else if (c2 == "*/") { depth--; i += 2; if (depth == 0) st = 0 }
      else i++
      continue
    }
    if (st == 3) {
      if (esc && c == "\\") { i += 2; continue }
      if (c == "'") { st = 0; closed = i }
      i++; continue
    }
    if (st == 4) {
      if (substr(buf, i, length(tag)) == tag) { st = 0; i += length(tag) } else i++
      continue
    }
    if (st == 5) { if (c == "\"") st = 0; i++; continue }
  }
  if (st != 0) { print "unterminated comment, string or dollar-quoted body"; exit 1 }
  rest = tolower(rest)
  if (index(rest, "\\") > 0) { print "psql backslash meta-command"; exit 1 }
  if (rest ~ /(^|[^a-z0-9_])vacuum([^a-z0-9_]|$)/) { print "VACUUM cannot run in a transaction"; exit 1 }
  if (rest ~ /(^|[^a-z0-9_])(standard_conforming_strings|backslash_quote|set_config)([^a-z0-9_]|$)/) {
    print "changes how strings are lexed (standard_conforming_strings, backslash_quote, set_config)"; exit 1
  }
  # Flatten whitespace first: some awks also split on newlines in split().
  gsub(/[\t\r\n]/, " ", rest)
  m = split(rest, parts, ";")
  atomic = 0
  for (k = 1; k <= m; k++) {
    p = parts[k]
    sub(/^[ \t\r\n]+/, "", p)
    if (p ~ /^:/) { print "statement starts with a psql variable"; exit 1 }
    if (p ~ /(^|[^a-z0-9_])concurrently([^a-z0-9_]|$)/ && p !~ /^refresh[ \t\r\n]/) {
      print "CONCURRENTLY cannot run in a transaction"; exit 1
    }
    if (atomic && p ~ /^end[ \t\r\n]*$/) { atomic = 0; continue }
    if (p ~ /^create[ \t\r\n]+(or[ \t\r\n]+replace[ \t\r\n]+)?(function|procedure)[ \t\r\n]/ && p ~ /(^|[^a-z0-9_])begin[ \t\r\n]+atomic([^a-z0-9_]|$)/) { atomic = 1; continue }
    if (match(p, /^[a-z]+/) == 0) continue
    w = substr(p, 1, RLENGTH)
    if (p ~ /^reset[ \t\r\n]+all([^a-z0-9_]|$)/) {
      print "RESET ALL would undo the session's pinned string lexing"; exit 1
    }
    if (w ~ /^(begin|start|commit|end|rollback|abort|savepoint|release)$/ || (w == "prepare" && p ~ /^prepare[ \t\r\n]+transaction/)) {
      print "top-level transaction control statement: " w; exit 1
    }
  }
}
AWK
}

# scan_sql FILE: stop when the file holds transaction control, CONCURRENTLY or VACUUM.
scan_sql() {
  local why
  why=$(awk -f "$WORK/scan.awk" "$1") || die "refusing ${1##*/}: $why (a file runs inside the runner's transaction)"
}

# run_tx LABEL FILE TAIL_SQL...: run FILE and the tail files in one transaction on the
# target; on failure report from the server whether the transaction rolled back.
run_tx() {
  local label="$1" file="$2" out="$WORK/tx.out" rc tx status tail=() f
  shift 2
  for f in "$@"; do tail+=(-f "$f"); done
  psql_db "$TARGET" --single-transaction -v "fname=$label" -v "sum=$CUR_SUM" \
    -f "$WORK/begin.sql" -f "$file" "${tail[@]}" </dev/null >"$out"
  rc=$?
  grep -v '^MIGRATE_TX ' "$out"
  [ "$rc" != 0 ] || return 0
  tx=$(sed -n 's/^MIGRATE_TX \([0-9][0-9]*\)$/\1/p' "$out" | head -1)
  [ -n "$tx" ] || die "$label failed before it ran; nothing of it was applied"
  status=$(scalar "$TARGET" "SELECT txid_status(:tx)" -v "tx=$tx" 2>/dev/null)
  case "$status" in
    aborted) die "$label failed and the server confirms it rolled back; later files were not applied" ;;
    committed) die "$label committed outside the runner's transaction (its changes are in the database with no schema_migrations row); check the database by hand before rerunning" ;;
    *) die "$label failed and the runner cannot confirm the rollback (transaction status: ${status:-unknown}); check the database by hand" ;;
  esac
}

# recorded_checksum NAME: print the stored checksum, empty when not applied.
recorded_checksum() {
  scalar "$TARGET" "SELECT checksum FROM public.schema_migrations WHERE filename = :'f'" -v "f=$1"
}

run_apply() {
  [ -f "$INIT_SQL" ] || die "missing $INIT_SQL"
  collect_migrations
  local has name rec applied=0 bad=0
  has=$(scalar "$TARGET" "SELECT to_regclass('public.schema_migrations') IS NOT NULL") || die "cannot query the database"

  if [ "$has" = "t" ]; then
    # Checksum stop first, so nothing applies when an applied file changed.
    while IFS= read -r name <&3; do
      [ -n "$name" ] || continue
      rec=$(recorded_checksum "$name") || die "cannot read schema_migrations"
      if [ -n "$rec" ] && [ "$rec" != "$(checksum "$MIG_DIR/$name")" ]; then
        printf 'migrate: checksum changed for applied file %s\n' "$name" >&2
        bad=1
      fi
    done 3<<EOF
$MIGRATIONS
EOF
    [ "$bad" = 0 ] || die "stopped: an applied migration was edited; add a new file instead"
  elif [ "$has" != "f" ]; then
    die "unexpected answer from the database: $has"
  fi

  # Scan everything pending before any file applies.
  if [ "$has" = "f" ]; then scan_sql "$INIT_SQL"; fi
  while IFS= read -r name <&3; do
    [ -n "$name" ] || continue
    if [ "$has" = "t" ]; then
      rec=$(recorded_checksum "$name") || die "cannot read schema_migrations"
      [ -z "$rec" ] || continue
    fi
    scan_sql "$MIG_DIR/$name"
  done 3<<EOF
$MIGRATIONS
EOF

  if [ "$has" = "f" ]; then
    printf 'migrate: new environment, applying init.sql\n'
    CUR_SUM=""
    run_tx init.sql "$INIT_SQL" "$WORK/check.sql" "$WORK/table.sql"
  fi

  while IFS= read -r name <&3; do
    [ -n "$name" ] || continue
    rec=$(recorded_checksum "$name") || die "cannot read schema_migrations"
    [ -z "$rec" ] || continue
    CUR_SUM=$(checksum "$MIG_DIR/$name")
    printf 'migrate: applying %s\n' "$name"
    run_tx "$name" "$MIG_DIR/$name" "$WORK/check.sql" "$WORK/record.sql"
    applied=$((applied + 1))
  done 3<<EOF
$MIGRATIONS
EOF
  printf 'migrate: done, %s file(s) applied\n' "$applied"
}

# scratch_target NAME: connection argument for the scratch database NAME.
scratch_target() {
  local name="$1" base query="" rest
  if [ -z "$TARGET" ]; then
    printf '%s' "$name"
    return
  fi
  case "$TARGET" in
    *\?*) query="?${TARGET#*\?}"; base="${TARGET%%\?*}" ;;
    *) base="$TARGET" ;;
  esac
  rest="${base#*://}"
  case "$rest" in
    */*) base="${base%/*}" ;;
  esac
  printf '%s/%s%s' "$base" "$name" "$query"
}

create_scratch() {
  scalar "$TARGET" 'CREATE DATABASE :"n"' -v "n=$1" >/dev/null
}

drop_scratch() {
  scalar "$TARGET" 'DROP DATABASE :"n"' -v "n=$1" >/dev/null \
    || printf 'migrate: could not drop scratch database %s\n' "$1" >&2
}

# build_scratch NAME INIT_FILE WITH_MIGRATIONS(0|1)
build_scratch() {
  local t name
  t=$(scratch_target "$1")
  psql_db "$t" --single-transaction -f "$2" </dev/null || die "init file $2 failed on $1"
  [ "$3" = 1 ] || return 0
  while IFS= read -r name <&3; do
    [ -n "$name" ] || continue
    psql_db "$t" --single-transaction -f "$MIG_DIR/$name" </dev/null \
      || die "$name failed on scratch database $1"
  done 3<<EOF
$MIGRATIONS
EOF
}

dump_schema() {
  pg_dump --schema-only -d "$(scratch_target "$1")" >"$2.raw" || die "pg_dump failed on $1"
  # Newer pg_dump versions add a random \restrict token; drop it so equal schemas compare equal.
  grep -v -e '^\\restrict ' -e '^\\unrestrict ' "$2.raw" >"$2"
  return 0
}

# A dbname parameter in the URL query would override the database name that
# scratch_target puts in the path, pointing every scratch connection at the target.
refuse_dbname_in_query() {
  local query decoded
  case "$TARGET" in
    *\?*) query="${TARGET#*\?}" ;;
    *) return 0 ;;
  esac
  decoded=$(printf '%s' "$query" | sed -e 's/\\/\\\\/g' -e 's/%\([0-9a-fA-F][0-9a-fA-F]\)/\\x\1/g')
  decoded=$(printf '%b' "$decoded" | tr 'A-Z' 'a-z')
  case "$decoded" in
    *dbname*) die "refusing to run the check: DATABASE_URL has a dbname parameter in its query, which would redirect the scratch connections to the target database" ;;
  esac
}

run_check() {
  local prev="$1" suffix name
  [ -f "$prev" ] || die "previous init file not found: $prev"
  [ -f "$INIT_SQL" ] || die "missing $INIT_SQL"
  command -v pg_dump >/dev/null 2>&1 || die "pg_dump not found"
  case "$TARGET" in
    ""|postgres://*|postgresql://*) ;;
    *) die "DATABASE_URL must be a postgresql:// URL for the check" ;;
  esac
  refuse_dbname_in_query
  collect_migrations
  scan_sql "$INIT_SQL"
  while IFS= read -r name <&3; do
    [ -n "$name" ] || continue
    scan_sql "$MIG_DIR/$name"
  done 3<<EOF
$MIGRATIONS
EOF
  suffix="${MIGRATE_SCRATCH_SUFFIX:-$$_$RANDOM}"
  [[ $suffix =~ ^[A-Za-z0-9_]+$ ]] || die "MIGRATE_SCRATCH_SUFFIX may hold letters, digits and _ only"
  PREV_DB="migrate_check_${suffix}_prev"
  NEW_DB="migrate_check_${suffix}_new"
  [ "${#PREV_DB}" -le 63 ] && [ "${#NEW_DB}" -le 63 ] || die "scratch database name too long; shorten the suffix"

  create_scratch "$PREV_DB" || die "cannot create $PREV_DB (name taken, or the role lacks CREATEDB)"
  CREATED_PREV=1
  create_scratch "$NEW_DB" || die "cannot create $NEW_DB (name taken, or the role lacks CREATEDB)"
  CREATED_NEW=1

  build_scratch "$PREV_DB" "$prev" 1
  build_scratch "$NEW_DB" "$INIT_SQL" 0
  dump_schema "$PREV_DB" "$WORK/prev.dump"
  dump_schema "$NEW_DB" "$WORK/new.dump"
  if diff -u "$WORK/prev.dump" "$WORK/new.dump"; then
    printf 'migrate: schema check passed\n'
  else
    die "schema check failed: previous init.sql + migrations differs from init.sql"
  fi
}

MODE="${1:-apply}"
case "$MODE" in
  apply) [ "$#" -le 1 ] || usage ;;
  check) [ "$#" -eq 2 ] || usage ;;
  *) usage ;;
esac

command -v psql >/dev/null 2>&1 || die "psql not found"
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
write_work_files

if [ "$MODE" = check ]; then
  run_check "$2"
else
  run_apply
fi
