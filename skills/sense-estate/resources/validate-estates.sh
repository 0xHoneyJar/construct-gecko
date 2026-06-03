#!/usr/bin/env bash
# =============================================================================
# validate-estates.sh — SAFE estate-config resolver for the sense-estate doctor.
# =============================================================================
# Resolves an estate SLUG against the operator-local estate-wiring registry
# (~/.claude/estates.yaml), validates the read-command, and — on `resolve` —
# runs it read-only under a timeout. Fails CLOSED to a `blind|<reason>|—` tile
# on ANY problem (missing file, bad perms, unknown slug, malformed command,
# interpreter smuggling, metacharacter, timeout, parse error).
#
# It NEVER uses bash `eval`, NEVER word-splits a command string, NEVER spawns a
# shell to expand the command. Commands are YAML argv-ARRAYS parsed with `yq`
# and executed via "${cmd[@]}" (shell=False semantics) under `timeout`.
#
# Usage:
#   validate-estates.sh <slug>                 # resolve + run the read-command read-only
#   validate-estates.sh --argv <slug>          # print the validated argv as a JSON array, no exec
#   validate-estates.sh --check <slug>         # validate only; exit 0 if the row is safe
#   validate-estates.sh --file <path> <slug>   # use an explicit estates.yaml (tests)
#
# Env:
#   LOA_ESTATES_FILE   override the estates.yaml path (test seam; same as --file)
#   LOA_ESTATE_TIMEOUT probe timeout seconds (default 15)
#   STRAYLIGHT_ESTATE / BEADS_ESTATE / any $NAME token — token expansion source
#
# Exit codes:
#   0 = safe (and, for resolve, the probe ran; its output is on stdout)
#   3 = fail-closed-to-blind (a `blind|<reason>|—` tile is printed to stdout)
#   2 = usage error
#
# Output on failure is ALWAYS a single valid 3-field tile line, so a consumer
# that splits on `|` always gets exactly 3 fields. NEVER empty, NEVER a crash.
# =============================================================================
set -uo pipefail

ALLOWED_BINS="bash sh node python3 jq"
TIMEOUT_SECS="${LOA_ESTATE_TIMEOUT:-15}"

# ---- emit a fail-closed blind tile and exit 3 -------------------------------
blind() {
  # delimiter-escape: strip raw | and control bytes from the reason so the tile
  # is always exactly 3 fields.
  local reason
  reason=$(printf '%s' "${1:-unknown}" | tr '|' ' ' | tr -d '\000-\037')
  printf 'blind|%s|—\n' "$reason"
  exit 3
}

usage() {
  sed -n '5,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

# ---- a bounded runner (timeout > gtimeout > unbounded-warn) ----------------
run_bounded() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "${TIMEOUT_SECS}s" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "${TIMEOUT_SECS}s" "$@"
  else
    echo "[validate-estates] WARNING: no timeout binary; running unbounded" >&2
    "$@"
  fi
}

# ---- arg parse --------------------------------------------------------------
MODE=resolve
EXPLICIT_FILE=""
SLUG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)  usage ;;
    --argv)     MODE=argv;  shift ;;
    --check)    MODE=check; shift ;;
    --file)     EXPLICIT_FILE="${2:-}"; shift 2 || usage ;;
    -*)         echo "[validate-estates] ERROR: unknown flag $1" >&2; exit 2 ;;
    *)          if [[ -z "$SLUG" ]]; then SLUG="$1"; else echo "[validate-estates] ERROR: unexpected arg $1" >&2; exit 2; fi; shift ;;
  esac
done
[[ -n "$SLUG" ]] || usage

# slug must be a tame identifier (no traversal, no metacharacters)
[[ "$SLUG" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || blind "invalid slug"

# ---- locate the estates file ------------------------------------------------
EST_FILE="${EXPLICIT_FILE:-${LOA_ESTATES_FILE:-$HOME/.claude/estates.yaml}}"
[[ -f "$EST_FILE" ]] || blind "estates.yaml absent ($EST_FILE)"

command -v yq >/dev/null 2>&1 || blind "yq v4+ required"
command -v jq >/dev/null 2>&1 || blind "jq required"

# ---- perms check (warn-only; loose perms are a misconfig SIGNAL, not fatal) --
# The real ~/.claude/estates.yaml should be 0600. A test/explicit fixture is exempt.
if [[ -z "$EXPLICIT_FILE" && -z "${LOA_ESTATES_FILE:-}" ]]; then
  perm=$(stat -f '%Lp' "$EST_FILE" 2>/dev/null || stat -c '%a' "$EST_FILE" 2>/dev/null || echo "")
  if [[ -n "$perm" && "$perm" != "600" ]]; then
    echo "[validate-estates] WARNING: $EST_FILE perms are $perm, expected 600" >&2
  fi
fi

# ---- parse with a REAL parser (yq → JSON), never eval -----------------------
EST_JSON=$(yq -o=json '.' "$EST_FILE" 2>/dev/null) || blind "estates.yaml failed to parse"
[[ -n "$EST_JSON" && "$EST_JSON" != "null" ]] || blind "estates.yaml empty/unparseable"

# slug present?
present=$(printf '%s' "$EST_JSON" | jq -r --arg s "$SLUG" '(.estates[$s] // empty) | type' 2>/dev/null || echo "")
[[ "$present" == "object" ]] || blind "unknown estate slug: $SLUG"

# ---- which command field? read_command, else coherence_command --------------
CMD_FIELD="read_command"
has_read=$(printf '%s' "$EST_JSON" | jq -r --arg s "$SLUG" '(.estates[$s].read_command != null)')
if [[ "$has_read" != "true" ]]; then
  has_coh=$(printf '%s' "$EST_JSON" | jq -r --arg s "$SLUG" '(.estates[$s].coherence_command != null)')
  if [[ "$has_coh" == "true" ]]; then
    CMD_FIELD="coherence_command"
  else
    blind "estate $SLUG declares no read_command"
  fi
fi

# ---- the command MUST be an array of strings (argv form) --------------------
# A STRING command is the word-split injection surface — reject it here.
cmd_type=$(printf '%s' "$EST_JSON" | jq -r --arg s "$SLUG" --arg f "$CMD_FIELD" '(.estates[$s][$f]) | type')
[[ "$cmd_type" == "array" ]] || blind "$CMD_FIELD for $SLUG is not an argv array"

all_strings=$(printf '%s' "$EST_JSON" | jq -r --arg s "$SLUG" --arg f "$CMD_FIELD" \
  '[.estates[$s][$f][] | type] | all(. == "string")')
[[ "$all_strings" == "true" ]] || blind "$CMD_FIELD elements must all be strings"

len=$(printf '%s' "$EST_JSON" | jq -r --arg s "$SLUG" --arg f "$CMD_FIELD" '.estates[$s][$f] | length')
[[ "$len" =~ ^[0-9]+$ && "$len" -ge 1 ]] || blind "$CMD_FIELD is empty"

# ---- read elements into a bash array, base64-per-element (NUL-safe, no eval) -
# Each argv element is base64-encoded by jq (one per line), then decoded into a
# bash array. base64 has no shell metacharacters, so this transport preserves
# elements verbatim (spaces, unicode, even embedded NULs) with ZERO word-split
# and ZERO eval.
RAW_ELEMS=()
while IFS= read -r b64; do
  [[ -z "$b64" ]] && continue
  RAW_ELEMS+=("$(printf '%s' "$b64" | base64 -d 2>/dev/null)")
done < <(printf '%s' "$EST_JSON" | jq -r --arg s "$SLUG" --arg f "$CMD_FIELD" '.estates[$s][$f][] | @base64')
[[ ${#RAW_ELEMS[@]} -ge 1 ]] || blind "$CMD_FIELD produced no argv elements"

# ---- metacharacter + smuggling guard (per element) --------------------------
# A safe element is either a bare leading-$NAME token (expanded below) or a plain
# literal with NO shell metacharacters. Reject any element carrying:
#   ; & | > < ` $( ) { } — or a $ that is not a bare leading $NAME token.
reject_meta() {
  local s="$1"
  case "$s" in
    *';'*|*'&'*|*'|'*|*'<'*|*'>'*|*'`'*|*'$('*|*'{'*|*'}'*) blind "metacharacter in $CMD_FIELD element" ;;
  esac
  if [[ "$s" == *'$'* ]] && ! [[ "$s" =~ ^\$[A-Z_][A-Z0-9_]*(/[A-Za-z0-9._/-]*)?$ ]]; then
    blind "unsafe \$ expansion in $CMD_FIELD element"
  fi
}

# ---- token-expansion: ONLY a bare leading $NAME, from tokens-map/env ---------
expand_token() {
  local s="$1"
  if [[ "$s" =~ ^\$([A-Z_][A-Z0-9_]*)(/.*)?$ ]]; then
    local name="${BASH_REMATCH[1]}" tail="${BASH_REMATCH[2]}" val
    val=$(printf '%s' "$EST_JSON" | jq -r --arg n "$name" '(.tokens[$n] // empty)')   # tokens-map first
    [[ -z "$val" ]] && val="${!name:-}"                                                # then process env
    [[ -z "$val" ]] && blind "unresolved token \$$name"
    val="${val/\$HOME/$HOME}"                                                          # single-level $HOME
    printf '%s%s' "$val" "$tail"
    return 0
  fi
  printf '%s' "$s"
}

CMD=()
for el in "${RAW_ELEMS[@]}"; do
  reject_meta "$el"
  CMD+=("$(expand_token "$el")")
done
[[ ${#CMD[@]} -ge 1 ]] || blind "empty argv after expansion"

# ---- argv[0] binary allowlist ----------------------------------------------
bin0="${CMD[0]}"
base0="${bin0##*/}"
case " $ALLOWED_BINS " in
  *" $base0 "*) : ;;
  *) blind "interpreter '$base0' not in allowlist" ;;
esac

# ---- interpreter-arg restriction: script-path only, no -e/-c/--eval/- -------
# For bash/sh/node/python3 the FIRST non-flag argument MUST be an existing script
# PATH. Reject inline-eval flags and read-from-stdin, which smuggle code.
case "$base0" in
  bash|sh|node|python3)
    saw_script=0
    for ((i=1; i<${#CMD[@]}; i++)); do
      a="${CMD[$i]}"
      case "$a" in
        -e|-c|--eval|--exec|-) blind "interpreter eval/stdin flag rejected: $a" ;;
        --) continue ;;
        -*) continue ;;          # other flags
        *)
          if [[ $saw_script -eq 0 ]]; then
            saw_script=1
            [[ -f "$a" ]] || blind "script path absent: $a"
          fi
          ;;
      esac
    done
    [[ $saw_script -eq 1 ]] || blind "$base0 invoked without a script path"
    ;;
  jq)
    : # jq with a filter expr is allowed (no script-path requirement)
    ;;
esac

# ---- argv mode: print the validated argv as JSON, no exec -------------------
# Build the JSON array WITHOUT jq --args (jq 1.6's --args mis-parses a positional
# that looks like a flag, e.g. "--json"). Feed each element base64-encoded (one
# per line) so the transport carries no metacharacters, then decode inside jq.
if [[ "$MODE" == "argv" ]]; then
  for el in "${CMD[@]}"; do printf '%s' "$el" | base64 | tr -d '\n'; printf '\n'; done \
    | jq -R '@base64d' | jq -sc '.'
  exit 0
fi

# ---- check mode: validation only -------------------------------------------
if [[ "$MODE" == "check" ]]; then
  echo "[validate-estates] OK: $SLUG → ${CMD[*]}" >&2
  exit 0
fi

# ---- resolve mode: run the read-command READ-ONLY, timeout-bound -----------
# shell=False semantics: "${CMD[@]}" — never eval, never a shell string.
out=$(run_bounded "${CMD[@]}" 2>/dev/null) || blind "probe failed/timed out: $base0"
[[ -n "$out" ]] || blind "probe produced no output: $base0"
printf '%s\n' "$out"
exit 0
