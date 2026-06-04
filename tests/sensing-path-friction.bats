#!/usr/bin/env bats
# =============================================================================
# sensing-path-friction.bats — tests for the GECKO path-friction doctor.
#
# Covers:
#   - sense-only grep-gate: the sensor script carries NO act/mutation verbs
#   - the tile is exactly 3 fields (delimiter safety)
#   - blind (valid 3-field tile, never a crash) on an absent trail
#   - the bonfire↔Documents/GitHub symlink is canonicalized (NOT a reach-in)
#   - a true cross-cell reach-in IS detected and flagged
#   - read-only git glances are classified inspect, NOT a desire-path
#   - desire-path threshold: ≥ min-recur (default 2 = "done twice")
#   - the clew is emitted in GECKO's >>clew@gecko/... capture format
#   - --json envelope is valid JSON
#   - construct.yaml registers the skill + command + the event; NO workflow.gates
# =============================================================================

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  SENSOR="$REPO/skills/sensing-path-friction/resources/path-friction.sh"

  # Build a synthetic audit.jsonl whose paths sit under the REAL GitHub root so
  # the script's cell_of() resolves them (it keys off ~/Documents/GitHub).
  ROOT="$HOME/Documents/GitHub"
  TMP="$(mktemp -d)"
  AUDIT="$TMP/audit.jsonl"
  : > "$AUDIT"

  # 1) same-cell write via the bonfire symlink alias → NOT a reach-in
  printf '{"ts":"2026-06-01T00:00:00Z","tool":"Write","file_path":"%s/bonfire/loa-freeside/src/a.ts","cwd":"%s/loa-freeside"}\n' "$HOME" "$ROOT" >> "$AUDIT"
  # 2) two cross-cell file-mutate acts loa-freeside → freeside-auth (a desire-path ≥2)
  printf '{"ts":"2026-06-02T00:00:00Z","tool":"Edit","file_path":"%s/freeside-auth/src/x.ts","cwd":"%s/loa-freeside"}\n' "$ROOT" "$ROOT" >> "$AUDIT"
  printf '{"ts":"2026-06-03T00:00:00Z","tool":"Edit","file_path":"%s/freeside-auth/src/y.ts","cwd":"%s/loa-freeside"}\n' "$ROOT" "$ROOT" >> "$AUDIT"
  # 3) a read-only cross-cell git glance → inspect, NOT a desire-path
  printf '{"ts":"2026-06-04T00:00:00Z","tool":"Bash","command":"git -C %s/freeside-sonar status","cwd":"%s/loa-freeside"}\n' "$ROOT" "$ROOT" >> "$AUDIT"
}

teardown() {
  [[ -n "${TMP:-}" && -d "$TMP" ]] && rm -rf "$TMP"
}

assert_three_fields() {
  local n; n=$(awk -F'|' '{print NF}' <<<"$1"); [ "$n" -eq 3 ]
}

# run the sensor on the synthetic trail ONLY (no default hubs)
sensor() {
  bash "$SENSOR" --no-default-audits --audit "$AUDIT" "$@"
}

@test "sense-only: the sensor invokes no act/mutation verbs" {
  run grep -nE '(^|[;&|][[:space:]]*)(git[[:space:]]+(push|commit|merge|reset)|gh[[:space:]]+pr[[:space:]]+(create|merge)|br[[:space:]]+(update|close)|railway[[:space:]]+up)' "$SENSOR"
  [ "$status" -ne 0 ]
}

@test "sense-only: SKILL.md states the no-act + never-fail-block constraint" {
  run grep -niE 'sense-only|never fail-block|Zero act' "$REPO/skills/sensing-path-friction/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "tile is exactly 3 pipe-delimited fields" {
  run sensor --tile
  [ "$status" -eq 0 ]
  assert_three_fields "$output"
}

@test "blind (valid 3-field tile, no crash) on an absent trail" {
  run bash "$SENSOR" --no-default-audits --audit "$TMP/nope.jsonl" --tile
  [ "$status" -eq 0 ]
  [[ "$output" == blind\|* ]]
  assert_three_fields "$output"
}

@test "the bonfire symlink alias is canonicalized — NOT counted as a reach-in" {
  # the only same-cell act in the fixture is the bonfire-aliased Write. It must
  # NOT show up as a cross-cell mutate. Only the 2 freeside-auth edits count.
  run sensor --json
  [ "$status" -eq 0 ]
  mutates=$(jq -r '.counts.mutates' <<<"$output")
  [ "$mutates" -eq 2 ]
}

@test "a true cross-cell reach-in IS detected" {
  run sensor --json
  reach=$(jq -r '.counts.reach_in' <<<"$output")
  [ "$reach" -ge 2 ]
  # the desire-path src→tgt is loa-freeside→freeside-auth
  run bash -c "bash '$SENSOR' --no-default-audits --audit '$AUDIT' --json | jq -r '.desire_paths[0] | \"\\(.src)->\\(.tgt)\"'"
  [ "$output" == "loa-freeside->freeside-auth" ]
}

@test "read-only git glance is classified inspect, NOT a desire-path" {
  run sensor --json
  glance=$(jq -r '.counts.glance' <<<"$output")
  [ "$glance" -eq 1 ]
  # the glance target (freeside-sonar) must NOT appear in desire_paths
  run bash -c "bash '$SENSOR' --no-default-audits --audit '$AUDIT' --json | jq -r '.desire_paths[].tgt'"
  [[ "$output" != *"freeside-sonar"* ]]
}

@test "desire-path threshold: 2 acts (done twice) => 1 desire-path; min-recur 3 => 0" {
  run bash -c "bash '$SENSOR' --no-default-audits --audit '$AUDIT' --json | jq -r '.counts.desire_paths'"
  [ "$output" -eq 1 ]
  run bash -c "bash '$SENSOR' --no-default-audits --audit '$AUDIT' --min-recur 3 --json | jq -r '.counts.desire_paths'"
  [ "$output" -eq 0 ]
}

@test "clew is emitted in GECKO's >>clew@gecko/ capture format" {
  run sensor
  [ "$status" -eq 0 ]
  [[ "$output" == *">>clew@gecko/sensing-path-friction:"* ]]
}

@test "--json envelope is valid JSON with the tile and status" {
  run sensor --json
  [ "$status" -eq 0 ]
  run jq -e '.tile and .status and .counts' <<<"$output"
  [ "$status" -eq 0 ]
}

@test "construct.yaml registers sensing-path-friction under skills:, commands:, events:" {
  run yq -r '.skills[].slug' "$REPO/construct.yaml"
  [[ "$output" == *"sensing-path-friction"* ]]
  run yq -r '.commands[].name' "$REPO/construct.yaml"
  [[ "$output" == *"sensing-path-friction"* ]]
  run yq -r '.events.emits[].type' "$REPO/construct.yaml"
  [[ "$output" == *"gecko.path_friction_observed"* ]]
}

@test "construct.yaml still declares NO workflow.gates (sense-only)" {
  run yq -r '.workflow.gates // "none"' "$REPO/construct.yaml"
  [ "$output" == "none" ]
}
