#!/usr/bin/env bats
# =============================================================================
# sensing-construct-console.bats — tests for GECKO's construct-estate sensor.
#
# Covers:
#   - the tile is ALWAYS stdout line 1 and exactly 3 pipe-delimited fields
#   - STATUS is one of {ok, drift, blind}
#   - GOVERNED: *.frozen.bak excluded from the live set; live count correct
#   - LOUD on an absent/unreadable manifest (drift signal, not a silent drop)
#   - EXHIBIT A: frozen packs indexed-as-live surface as phantoms
#   - DECLARED: compose_with (intended) + streams overlap (contracted) lift from disk
#   - EARNED: closed rows count; open/abandoned rows ignored; undeclared-dep detected
#   - fail-closed-LOUD: explicit bad --root → blind tile, exit 3 (no silent fallback)
#   - sense-only: the script carries NO act/mutation verbs
#   - sense-only: construct.yaml declares NO workflow.gates
#   - construct.yaml registers the skill + command under both keys
# =============================================================================

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  SCRIPT="$REPO/skills/sensing-construct-console/resources/sense-construct-console.mjs"

  command -v node >/dev/null 2>&1 || skip "node not available"

  # ---- materialize a tiny FIXTURE construct estate under a tmp root ----------
  TMP="$(mktemp -d)"
  PACKS="$TMP/.claude/constructs/packs"
  mkdir -p "$PACKS"

  # alpha: live, declares compose_with [beta] (intended) + streams writes Artifact
  mkdir -p "$PACKS/alpha"
  cat > "$PACKS/alpha/construct.yaml" <<'YAML'
slug: alpha
compose_with:
  - beta
streams:
  reads: [Intent]
  writes: [Artifact]
YAML

  # beta: live, reads Artifact (so alpha→beta is a contracted edge), no compose_with
  mkdir -p "$PACKS/beta"
  cat > "$PACKS/beta/construct.yaml" <<'YAML'
slug: beta
streams:
  reads:
    - Artifact     # block-list form with a trailing comment
  writes:
    - Verdict
YAML

  # gamma: live BUT NO MANIFEST — must surface LOUD (drift), not be dropped
  mkdir -p "$PACKS/gamma"

  # alpha.frozen.bak: retired — must be EXCLUDED from the live set
  mkdir -p "$PACKS/alpha.frozen.bak"
  cat > "$PACKS/alpha.frozen.bak/construct.yaml" <<'YAML'
slug: alpha.frozen.bak
YAML

  # ---- the DRIFTED static index: indexes the frozen pack AS LIVE -------------
  mkdir -p "$TMP/.run"
  cat > "$TMP/.run/construct-index.yaml" <<'YAML'
metadata:
  pack_count: 2
constructs:
  - slug: alpha
    composes_with: []
  - slug: alpha.frozen.bak
    composes_with: []
YAML

  # ---- the EARNED ledger (default to empty; tests opt into a populated one) --
  mkdir -p "$TMP/grimoires/gecko"
  LEDGER="$TMP/grimoires/gecko/observations.jsonl"
}

teardown() {
  [[ -n "${TMP:-}" && -d "$TMP" ]] && rm -rf "$TMP"
}

run_sensor() { run node "$SCRIPT" --root "$TMP" "$@"; }

first_line() { printf '%s\n' "$output" | head -1; }

assert_three_fields() {
  local n; n=$(awk -F'|' '{print NF}' <<<"$1"); [ "$n" -eq 3 ]
}

# ---- tile shape -------------------------------------------------------------
@test "tile is stdout line 1 and exactly 3 pipe-delimited fields" {
  run_sensor
  [ "$status" -eq 0 ]
  assert_three_fields "$(first_line)"
}

@test "STATUS is one of ok|drift|blind" {
  run_sensor
  local st; st="$(first_line)"; st="${st%%|*}"
  [[ "$st" == "ok" || "$st" == "drift" || "$st" == "blind" ]]
}

@test "GOVERNED: frozen.bak excluded — live count is 3 (alpha, beta, gamma)" {
  run_sensor --json
  run jq -r '.governed.live' <<<"$(printf '%s\n' "$output" | tail -n +2)"
  [ "$output" -eq 3 ]
}

@test "GOVERNED: frozen.bak counted as frozen, not live" {
  run_sensor --json
  run jq -r '.governed.frozen' <<<"$(printf '%s\n' "$output" | tail -n +2)"
  [ "$output" -eq 1 ]
}

# ---- LOUD on absent manifest ------------------------------------------------
@test "LOUD: a live pack with no manifest surfaces in no_manifest[] (not dropped)" {
  run_sensor --json
  run jq -r '.governed.no_manifest | index("gamma")' <<<"$(printf '%s\n' "$output" | tail -n +2)"
  [ "$output" != "null" ]
}

@test "LOUD: an absent manifest forces drift STATUS" {
  run_sensor
  [[ "$(first_line)" == drift\|* ]]
}

# ---- EXHIBIT A: phantoms ----------------------------------------------------
@test "EXHIBIT A: frozen pack indexed-as-live surfaces as a phantom" {
  run_sensor --json
  run jq -r '.declared.phantoms | index("alpha.frozen.bak")' <<<"$(printf '%s\n' "$output" | tail -n +2)"
  [ "$output" != "null" ]
}

@test "EXHIBIT A: --console prints the Exhibit A header" {
  run_sensor --console
  [[ "$output" == *"EXHIBIT A"* ]]
  [[ "$output" == *"alpha.frozen.bak"* ]]
}

# ---- DECLARED: intended + contracted from disk ------------------------------
@test "DECLARED intended: alpha's compose_with [beta] is lifted" {
  run_sensor --json
  run jq -r '.declared.intended_edges' <<<"$(printf '%s\n' "$output" | tail -n +2)"
  [ "$output" -ge 1 ]
}

@test "DECLARED contracted: alpha.writes(Artifact) ∩ beta.reads(Artifact) is an edge" {
  run_sensor --json
  run jq -r '.declared.contracted_edges' <<<"$(printf '%s\n' "$output" | tail -n +2)"
  [ "$output" -ge 1 ]
}

# ---- EARNED: closed rows count; open ignored; undeclared dep ----------------
@test "EARNED: empty ledger → 0 earned, all live constructs authority_unearned" {
  run_sensor --json
  local body; body="$(printf '%s\n' "$output" | tail -n +2)"
  run jq -r '.earned.rows' <<<"$body"; [ "$output" -eq 0 ]
}

@test "EARNED: a closed row counts; an open row does not" {
  printf '%s\n' \
    '{"stream_type":"Signal","construct":"alpha","domain":"craft","co_constructs":["beta"],"outcome":"closed"}' \
    '{"stream_type":"Signal","construct":"alpha","domain":"craft","co_constructs":["beta"],"outcome":"open"}' \
    > "$LEDGER"
  run env LOA_CONSOLE_LEDGER="$LEDGER" node "$SCRIPT" --root "$TMP" --json
  run jq -r '.earned.rows' <<<"$(printf '%s\n' "$output" | tail -n +2)"
  [ "$output" -eq 1 ]
}

@test "EARNED: undeclared dependency (observed, never intended) is detected" {
  # gamma↔beta co-occur in a closed row but gamma declares no compose_with
  printf '%s\n' \
    '{"stream_type":"Signal","construct":"gamma","domain":"x","co_constructs":["beta"],"outcome":"closed"}' \
    > "$LEDGER"
  run env LOA_CONSOLE_LEDGER="$LEDGER" node "$SCRIPT" --root "$TMP" --json
  run jq -r '.gap.undeclared_deps' <<<"$(printf '%s\n' "$output" | tail -n +2)"
  [ "$output" -ge 1 ]
}

# ---- fail-closed-LOUD -------------------------------------------------------
@test "fail-closed: an explicit bad --root → blind tile, exit 3 (no silent fallback)" {
  run node "$SCRIPT" --root "$TMP/nope-not-here"
  [ "$status" -eq 3 ]
  [[ "$output" == blind\|* ]]
  assert_three_fields "$output"
}

@test "fail-closed: an unknown flag → blind tile, exit 3" {
  run node "$SCRIPT" --bogus-flag
  [ "$status" -eq 3 ]
  [[ "$output" == blind\|* ]]
  assert_three_fields "$output"
}

@test "fail-closed: a corrupt ledger line is tolerated (never crashes)" {
  printf '%s\n' \
    'this is not json' \
    '{"stream_type":"Signal","construct":"alpha","co_constructs":[],"outcome":"closed"}' \
    > "$LEDGER"
  run env LOA_CONSOLE_LEDGER="$LEDGER" node "$SCRIPT" --root "$TMP" --json
  [ "$status" -eq 0 ]
  run jq -r '.earned.rows' <<<"$(printf '%s\n' "$output" | tail -n +2)"
  [ "$output" -eq 1 ]
}

# ---- sense-only firewall ----------------------------------------------------
@test "sense-only: the script invokes no act/mutation verbs" {
  run grep -nE '(br[[:space:]]+(update|close)|gh[[:space:]]+pr[[:space:]]+(create|merge)|construct-adapter-gen|--apply|--confirm)' "$SCRIPT"
  [ "$status" -ne 0 ]
}

@test "sense-only: the script declares the no-act boundary in SKILL.md" {
  run grep -niE 'sense-only|zero act' "$REPO/skills/sensing-construct-console/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "sense-only: construct.yaml declares NO workflow.gates" {
  run yq -r '.workflow.gates // "none"' "$REPO/construct.yaml"
  [ "$output" == "none" ]
}

# ---- registration -----------------------------------------------------------
@test "construct.yaml registers sensing-construct-console under skills: and commands:" {
  run yq -r '.skills[].slug' "$REPO/construct.yaml"
  [[ "$output" == *"sensing-construct-console"* ]]
  run yq -r '.commands[].name' "$REPO/construct.yaml"
  [[ "$output" == *"sensing-construct-console"* ]]
}

@test "the tile MISMATCH is the canonical three-side phrase" {
  run_sensor
  [[ "$(first_line)" == *"declared ↔ governed ↔ earned"* ]]
}
