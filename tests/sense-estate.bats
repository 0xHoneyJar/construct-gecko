#!/usr/bin/env bats
# =============================================================================
# sense-estate.bats — tests for the GECKO sense-estate doctor (Wave A).
#
# Covers:
#   - sense-only grep-gate: the skill carries NO act/mutation verbs
#   - the estates validator runs against the good example
#   - the validator REJECTS every injection fixture (→ blind, exit 3)
#   - the tile is exactly 3 fields after a raw | is escaped
#   - blind (exit 3, valid tile) on an absent probe
#   - construct.yaml registers the skill + command under both keys
#   - construct.yaml declares NO workflow.gates (sense-only)
# =============================================================================

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  RES="$REPO/skills/sense-estate/resources"
  VALIDATE="$RES/validate-estates.sh"
  FIX="$REPO/tests/fixtures"

  # materialize fixtures into a tmpdir with FIXTURE_DIR resolved + probe copied
  TMP="$(mktemp -d)"
  cp "$FIX/probe-ok.sh" "$TMP/probe-ok.sh"
  chmod +x "$TMP/probe-ok.sh"
  sed "s#PLACEHOLDER_FIXTURE_DIR#$TMP#g" "$FIX/estates.good.yaml"      > "$TMP/estates.good.yaml"
  sed "s#PLACEHOLDER_FIXTURE_DIR#$TMP#g" "$FIX/estates.injection.yaml" > "$TMP/estates.injection.yaml"
}

teardown() {
  [[ -n "${TMP:-}" && -d "$TMP" ]] && rm -rf "$TMP"
}

# ---- a tile MUST be exactly 3 pipe-delimited fields -------------------------
assert_three_fields() {
  local line="$1"
  local n
  n=$(awk -F'|' '{print NF}' <<<"$line")
  [ "$n" -eq 3 ]
}

@test "sense-only: the resolver EXECUTABLE invokes no act/mutation verbs" {
  # The executable is the only place that could ACT. The docs legitimately NAME
  # the forbidden verbs (to forbid them), so the grep-gate targets the script.
  # Match command/execution shapes, not prose.
  run grep -nE '(br[[:space:]]+(update|close)|gh[[:space:]]+pr[[:space:]]+(create|merge)|recall-stamp\.sh[[:space:]]+apply|align\.mjs[^[:space:]]*[[:space:]]+--apply|--confirm)' \
    "$VALIDATE"
  # grep exits non-zero when NOTHING matches — that is the pass condition.
  [ "$status" -ne 0 ]
}

@test "sense-only: the resolver never uses bash eval as a command" {
  # command-position eval only (start-of-line or after ;/&&/|), not comments or
  # the --eval flag-rejection token.
  run grep -nE '(^|[;&|][[:space:]]*|[[:space:]]then[[:space:]]|[[:space:]]do[[:space:]])eval[[:space:]]' "$VALIDATE"
  [ "$status" -ne 0 ]
}

@test "sense-only: SKILL.md states the no-act constraint explicitly" {
  # The doc MUST carry the sense-only boundary (positive assertion).
  run grep -niE 'sense-only|zero act' "$REPO/skills/sense-estate/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "construct.yaml registers sense-estate under skills: and commands:" {
  run yq -r '.skills[].slug' "$REPO/construct.yaml"
  [[ "$output" == *"sense-estate"* ]]
  run yq -r '.commands[].name' "$REPO/construct.yaml"
  [[ "$output" == *"sense-estate"* ]]
}

@test "construct.yaml declares NO workflow.gates (sense-only)" {
  run yq -r '.workflow.gates // "none"' "$REPO/construct.yaml"
  [ "$output" == "none" ]
}

@test "validator resolves a good estate and runs the probe read-only" {
  run env LOA_ESTATES_FILE="$TMP/estates.good.yaml" bash "$VALIDATE" echotest
  [ "$status" -eq 0 ]
  # the probe printed a JSON receipt
  [[ "$output" == *'"mode"'* ]]
}

@test "validator --argv prints the validated argv as a JSON array (no exec)" {
  run env LOA_ESTATES_FILE="$TMP/estates.good.yaml" bash "$VALIDATE" --argv echotest
  [ "$status" -eq 0 ]
  # argv[0] is bash, argv[1] is the resolved (token-expanded) absolute script path
  run jq -r '.[0]' <<<"$output"
  [ "$output" == "bash" ]
}

@test "blind (exit 3, valid 3-field tile) on an absent probe script" {
  run env LOA_ESTATES_FILE="$TMP/estates.good.yaml" bash "$VALIDATE" absent
  [ "$status" -eq 3 ]
  [[ "$output" == blind\|* ]]
  assert_three_fields "$output"
}

@test "blind on an unknown slug" {
  run env LOA_ESTATES_FILE="$TMP/estates.good.yaml" bash "$VALIDATE" nosuchslug
  [ "$status" -eq 3 ]
  [[ "$output" == blind\|* ]]
  assert_three_fields "$output"
}

@test "blind on an absent estates.yaml (fail-closed, not crash)" {
  run env LOA_ESTATES_FILE="$TMP/does-not-exist.yaml" bash "$VALIDATE" echotest
  [ "$status" -eq 3 ]
  [[ "$output" == blind\|* ]]
  assert_three_fields "$output"
}

# ---- the injection fixtures: EVERY one must be rejected to a blind tile ------
@test "injection: metacharacter command-chaining is rejected" {
  run env LOA_ESTATES_FILE="$TMP/estates.injection.yaml" bash "$VALIDATE" metachar
  [ "$status" -eq 3 ]
  assert_three_fields "$output"
}

@test "injection: bash -c inline-eval is rejected" {
  run env LOA_ESTATES_FILE="$TMP/estates.injection.yaml" bash "$VALIDATE" evalsmuggle
  [ "$status" -eq 3 ]
  assert_three_fields "$output"
}

@test "injection: node -e inline-eval is rejected" {
  run env LOA_ESTATES_FILE="$TMP/estates.injection.yaml" bash "$VALIDATE" nodeeval
  [ "$status" -eq 3 ]
  assert_three_fields "$output"
}

@test "injection: a STRING command (not argv array) is rejected" {
  run env LOA_ESTATES_FILE="$TMP/estates.injection.yaml" bash "$VALIDATE" stringcmd
  [ "$status" -eq 3 ]
  assert_three_fields "$output"
}

@test "injection: a non-allowlisted interpreter is rejected" {
  run env LOA_ESTATES_FILE="$TMP/estates.injection.yaml" bash "$VALIDATE" badbin
  [ "$status" -eq 3 ]
  assert_three_fields "$output"
}

@test "injection: command-substitution token is rejected" {
  run env LOA_ESTATES_FILE="$TMP/estates.injection.yaml" bash "$VALIDATE" cmdsub
  [ "$status" -eq 3 ]
  assert_three_fields "$output"
}

# ---- tile robustness: a raw | in a probe's output is escaped to 3 fields -----
@test "tile: a raw | in SIGNAL is escaped so the line splits to exactly 3 fields" {
  # probe-ok.sh (no --json) prints a tile whose SIGNAL contains a raw '|'.
  # Apply the skill's documented escape (tr '|' ' ' on SIGNAL/MISMATCH) and
  # assert the consumer split yields exactly 3 fields.
  raw="$("$TMP/probe-ok.sh")"
  # raw deliberately has >3 fields (an unescaped pipe in SIGNAL)
  rawn=$(awk -F'|' '{print NF}' <<<"$raw")
  [ "$rawn" -gt 3 ]
  # the doctor's escape: keep STATUS, collapse the rest, escaping inner pipes
  status_field="${raw%%|*}"
  rest="${raw#*|}"
  signal="${rest%%|*}"
  mismatch="${rest#*|}"
  signal_esc="$(tr '|' ' ' <<<"$signal")"
  mismatch_esc="$(tr '|' ' ' <<<"$mismatch")"
  tile="$status_field|$signal_esc|$mismatch_esc"
  assert_three_fields "$tile"
}
