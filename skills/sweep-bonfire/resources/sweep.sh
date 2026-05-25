#!/usr/bin/env bash
# sweep-bonfire — walk the operator's bonfire, classify each stall by lifecycle glyph,
# emit a sweep block to the wall. observes; never mutates source.
#
# usage:
#   sweep.sh                          # default: ~/bonfire/* → ~/bonfire/WALL.md
#   sweep.sh --root <path>            # alternative bonfire location
#   sweep.sh --wall <path>            # alternative wall location
#   sweep.sh --dry-run                # print classification, don't write wall
#   sweep.sh --json                   # JSON classification to stdout, don't write wall
#   sweep.sh --trigger "<note>"       # human-readable trigger (default: "manual")

set -euo pipefail

ROOT="${BONFIRE_ROOT:-$HOME/bonfire}"
WALL=""
DRY_RUN=0
JSON_OUT=0
TRIGGER="manual"

while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --wall) WALL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --json) JSON_OUT=1; shift ;;
    --trigger) TRIGGER="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

WALL="${WALL:-${BONFIRE_WALL:-$ROOT/WALL.md}}"

if [ ! -d "$ROOT" ]; then
  echo "sweep: root dir not found: $ROOT" >&2
  exit 1
fi

# --- classify one stall ---------------------------------------------------
# inputs: $1 = stall path
# outputs: writes one row to $STALL_ROWS_FILE: glyph|name|note
#          writes one JSON object to $STALL_JSON_FILE
classify_stall() {
  local dir="$1"
  local name
  name=$(basename "$dir")

  # is it a stall at all?
  local has_charter=0
  local has_construct_yaml=0
  [ -f "$dir/CHARTER.md" ] && has_charter=1
  [ -f "$dir/construct.yaml" ] && has_construct_yaml=1
  local has_git=0
  [ -d "$dir/.git" ] && has_git=1

  if [ "$has_git" = 0 ] && [ "$has_charter" = 0 ] && [ "$has_construct_yaml" = 0 ]; then
    return  # not a stall, skip silently
  fi

  # operator-declared lifecycle (from construct.yaml)
  local operator_state=""
  if [ "$has_construct_yaml" = 1 ]; then
    operator_state=$(awk '/^lifecycle:/ {print $2; exit}' "$dir/construct.yaml" 2>/dev/null | tr -d '"' || true)
  fi

  local glyph note now_epoch
  now_epoch=$(date +%s)

  # seed path: no git, but has charter/construct.yaml
  if [ "$has_git" = 0 ]; then
    glyph="🌱"
    note="seed — charter/construct.yaml present, not yet planted"
    emit_row "$glyph" "$name" "$note" "seed" "$dir" ""
    return
  fi

  # operator-declared states (honor over observation)
  case "$operator_state" in
    archived)
      emit_row "⚫" "$name" "operator-declared: archived" "archived" "$dir" "$operator_state"
      return ;;
    crystallized)
      emit_row "🔵" "$name" "operator-declared: crystallized (at rest)" "crystallized" "$dir" "$operator_state"
      return ;;
    absorbing)
      emit_row "♻︎" "$name" "operator-declared: absorbing into another construct" "absorbing" "$dir" "$operator_state"
      return ;;
  esac

  # observed git states
  local dirty_count
  dirty_count=$(git -C "$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')

  local branch
  branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null)

  local default_branch
  default_branch=$(git -C "$dir" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||' || echo "main")

  local upstream
  upstream=$(git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo "")

  local unpushed_count=0
  if [ -n "$upstream" ]; then
    unpushed_count=$(git -C "$dir" log "$upstream"..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')
  fi

  local last_commit_age_sec last_commit_age_days
  last_commit_age_sec=$(( now_epoch - $(git -C "$dir" log -1 --format=%ct 2>/dev/null || echo "$now_epoch") ))
  last_commit_age_days=$(( last_commit_age_sec / 86400 ))

  # branch fatigue check
  local branch_fatigue=""
  if [ "$branch" != "$default_branch" ] && [ "$branch" != "master" ] && [ "$branch" != "main" ]; then
    local branch_age_sec branch_age_days
    branch_age_sec=$(( now_epoch - $(git -C "$dir" log -1 --format=%ct "$branch" 2>/dev/null || echo "$now_epoch") ))
    branch_age_days=$(( branch_age_sec / 86400 ))
    if [ "$branch_age_days" -gt 7 ]; then
      branch_fatigue=" · branch-fatigue: on '$branch' ${branch_age_days}d"
    fi
  fi

  # classification ladder
  if [ "$dirty_count" -gt 0 ]; then
    glyph="🟡"
    note="warm — $dirty_count dirty file(s), last commit ${last_commit_age_days}d${branch_fatigue}"
    emit_row "$glyph" "$name" "$note" "warm" "$dir" ""
    return
  fi

  if [ "$unpushed_count" -gt 0 ]; then
    local oldest_unpushed_age_sec oldest_unpushed_age_days
    oldest_unpushed_age_sec=$(( now_epoch - $(git -C "$dir" log -1 --reverse --format=%ct "$upstream"..HEAD 2>/dev/null || echo "$now_epoch") ))
    oldest_unpushed_age_days=$(( oldest_unpushed_age_sec / 86400 ))

    if [ "$oldest_unpushed_age_days" -gt 30 ]; then
      glyph="🔴"
      note="ghost — $unpushed_count unpushed commit(s), oldest ${oldest_unpushed_age_days}d. operator decision needed.${branch_fatigue}"
      emit_row "$glyph" "$name" "$note" "ghost" "$dir" ""
    elif [ "$oldest_unpushed_age_days" -gt 7 ]; then
      glyph="🟠"
      note="cooling — $unpushed_count unpushed commit(s), oldest ${oldest_unpushed_age_days}d${branch_fatigue}"
      emit_row "$glyph" "$name" "$note" "cooling" "$dir" ""
    else
      glyph="🟡"
      note="warm — $unpushed_count unpushed commit(s), ${oldest_unpushed_age_days}d${branch_fatigue}"
      emit_row "$glyph" "$name" "$note" "warm" "$dir" ""
    fi
    return
  fi

  # clean tree, no unpushed
  if [ "$last_commit_age_days" -lt 1 ]; then
    glyph="🟢"
    note="hot — clean, last push <24h${branch_fatigue}"
    emit_row "$glyph" "$name" "$note" "hot" "$dir" ""
    return
  fi

  if [ "$last_commit_age_days" -gt 30 ]; then
    glyph="🔵"
    note="crystallized (heuristic) — clean, ${last_commit_age_days}d at rest${branch_fatigue}"
    emit_row "$glyph" "$name" "$note" "crystallized" "$dir" "$branch_fatigue"
    return
  fi

  glyph="🟢"
  note="hot — clean, last push ${last_commit_age_days}d${branch_fatigue}"
  emit_row "$glyph" "$name" "$note" "hot" "$dir" ""
}

# --- emit one row (markdown + JSON) --------------------------------------
emit_row() {
  local glyph="$1" name="$2" note="$3" lane="$4" path="$5" extra="$6"
  printf "| %s | %s %s | %s |\n" "$name" "$glyph" "$lane" "$note" >> "$STALL_ROWS_FILE"

  # JSON: append a comma+line so we can wrap as array later
  jq -n \
    --arg name "$name" \
    --arg glyph "$glyph" \
    --arg lane "$lane" \
    --arg note "$note" \
    --arg path "$path" \
    '{name: $name, glyph: $glyph, lane: $lane, note: $note, path: $path}' \
    >> "$STALL_JSON_FILE"
  echo "," >> "$STALL_JSON_FILE"
}

STALL_ROWS_FILE=$(mktemp)
STALL_JSON_FILE=$(mktemp)
trap 'rm -f "$STALL_ROWS_FILE" "$STALL_JSON_FILE"' EXIT

# walk
for dir in "$ROOT"/*/; do
  [ -d "$dir" ] || continue
  # skip dot dirs and the WALL itself
  base=$(basename "$dir")
  [[ "$base" == .* ]] && continue
  classify_stall "${dir%/}"
done

# --- output --------------------------------------------------------------
STALL_COUNT=$(wc -l < "$STALL_ROWS_FILE" | tr -d ' ')

if [ "$JSON_OUT" = 1 ]; then
  # wrap rows as JSON array
  echo "["
  # remove trailing comma+newline from last entry
  sed '$d' "$STALL_JSON_FILE" 2>/dev/null | head -c -1
  echo ""
  echo "]"
  echo "sweep: $STALL_COUNT stalls observed → json" >&2
  exit 0
fi

# build the wall block
TODAY=$(date +%Y-%m-%d)
TIME=$(date +%H:%M)
BLOCK=$(cat <<EOF

## $TODAY — sweep ($TIME) — $TRIGGER

| stall | state | note |
|---|---|---|
$(cat "$STALL_ROWS_FILE")

---
EOF
)

if [ "$DRY_RUN" = 1 ]; then
  echo "$BLOCK"
  echo "sweep: $STALL_COUNT stalls observed (dry-run; no wall write)" >&2
  exit 0
fi

# atomic wall insert: find the first "## " header after the front matter,
# insert the new block just before it. if wall doesn't exist yet, create with a stub header.
if [ ! -f "$WALL" ]; then
  cat > "$WALL" <<HDR
# the wall

gecko writes here. lowercase. newest at top. operator and agents read before entering the bazaar.

---
HDR
fi

TMP=$(mktemp)
trap 'rm -f "$STALL_ROWS_FILE" "$STALL_JSON_FILE" "$TMP"' EXIT

awk -v block="$BLOCK" '
  BEGIN { inserted = 0 }
  /^## / && !inserted { print block; inserted = 1 }
  { print }
  END { if (!inserted) print block }
' "$WALL" > "$TMP"

mv "$TMP" "$WALL"

echo "sweep: $STALL_COUNT stalls observed → $WALL" >&2
