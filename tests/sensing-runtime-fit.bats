#!/usr/bin/env bats
# =============================================================================
# sensing-runtime-fit.bats — tests for the GECKO runtime-fit doctor.
#
# Covers:
#   - the tile is exactly 3 fields, STATUS first
#   - a CLEAN estate → ok, exit 0
#   - a #553 fixture (Write tool + read-only agent) → drift + agent-write-conflict
#   - an unknown model_tier is a SMELL (soft), never a CONFLICT (it must NOT flip drift)
#   - fail-closed-loud: an unreadable root → blind, exit 3
#   - sense-only: the script carries NO act/mutation verbs against pack state
#   - construct.yaml registers the skill + command, and declares NO workflow.gates
# =============================================================================

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  SENSOR="$REPO/skills/sensing-runtime-fit/resources/sense-runtime-fit.mjs"

  # CLEAN estate
  OKROOT="$(mktemp -d)"
  mkdir -p "$OKROOT/.claude/constructs/packs/goodpack/skills/reader"
  cat > "$OKROOT/.claude/constructs/packs/goodpack/construct.yaml" <<'Y'
schema_version: 3
name: Goodpack
slug: goodpack
version: 0.1.0
capabilities:
  model_tier: sonnet
  downgrade_allowed: true
  effort_hint: medium
Y
  cat > "$OKROOT/.claude/constructs/packs/goodpack/skills/reader/SKILL.md" <<'Y'
---
name: reader
allowed-tools: [Read, Grep]
agent: general-purpose
---
# reader
Y

  # DRIFT estate: a #553 conflict + an unknown tier smell
  BADROOT="$(mktemp -d)"
  mkdir -p "$BADROOT/.claude/constructs/packs/badpack/skills/writer"
  cat > "$BADROOT/.claude/constructs/packs/badpack/construct.yaml" <<'Y'
schema_version: 3
name: Badpack
slug: badpack
version: 0.1.0
capabilities:
  model_tier: turbo
  downgrade_allowed: false
  effort_hint: small
Y
  cat > "$BADROOT/.claude/constructs/packs/badpack/skills/writer/SKILL.md" <<'Y'
---
name: writer
allowed-tools: [Read, Write, Edit]
agent: Explore
---
# writer
Y
}

teardown() {
  [[ -n "${OKROOT:-}"  && -d "$OKROOT"  ]] && rm -rf "$OKROOT"
  [[ -n "${BADROOT:-}" && -d "$BADROOT" ]] && rm -rf "$BADROOT"
}

assert_three_fields() {
  local n; n=$(awk -F'|' '{print NF}' <<<"$1"); [ "$n" -eq 3 ]
}

@test "tile is exactly 3 pipe-delimited fields" {
  run node "$SENSOR" --root "$OKROOT"
  [ "$status" -eq 0 ]
  assert_three_fields "${lines[0]}"
}

@test "a clean estate senses ok" {
  run node "$SENSOR" --root "$OKROOT"
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == ok\|* ]]
}

@test "a #553 conflict (Write + read-only agent) flips drift" {
  run node "$SENSOR" --root "$BADROOT" --json
  [[ "${lines[0]}" == drift\|* ]]
  [[ "$output" == *agent-write-conflict* ]]
  [[ "$output" == *"SILENTLY not persisted"* ]]
}

@test "an unknown model_tier is a SMELL, not a CONFLICT" {
  # badpack/writer is the only CONFLICT; model_tier:turbo must be a smell, so the
  # conflict count is exactly 1 (the #553 one), proving turbo did NOT add a conflict.
  run node "$SENSOR" --root "$BADROOT"
  [[ "${lines[0]}" == *"1 conflicts"* ]]
  run node "$SENSOR" --root "$BADROOT" --json
  [[ "$output" == *unknown-model-tier* ]]
}

@test "abstract tier vocab (standard ≡ sonnet) is recognized, not flagged" {
  AB="$(mktemp -d)"
  mkdir -p "$AB/.claude/constructs/packs/abs/skills/x"
  cat > "$AB/.claude/constructs/packs/abs/construct.yaml" <<'Y'
schema_version: 3
name: Abs
slug: abs
version: 0.1.0
capabilities:
  model_tier: standard
  downgrade_allowed: true
  effort_hint: medium
Y
  run node "$SENSOR" --root "$AB" --json
  [[ "${lines[0]}" == ok\|* ]]
  [[ "$output" != *unknown-model-tier* ]]
  rm -rf "$AB"
}

@test "deep (abstract opus) on light work triggers opus-pinned-light" {
  DP="$(mktemp -d)"
  mkdir -p "$DP/.claude/constructs/packs/dp"
  cat > "$DP/.claude/constructs/packs/dp/construct.yaml" <<'Y'
schema_version: 3
name: Dp
slug: dp
version: 0.1.0
capabilities:
  model_tier: deep
  downgrade_allowed: false
  effort_hint: small
Y
  run node "$SENSOR" --root "$DP" --json
  [[ "$output" == *opus-pinned-light* ]]
  rm -rf "$DP"
}

@test "fail-closed-loud: unreadable root is blind, exit 3" {
  run node "$SENSOR" --root /tmp/no-such-runtime-fit-root-xyz
  [ "$status" -eq 3 ]
  [[ "${lines[0]}" == blind\|* ]]
  assert_three_fields "${lines[0]}"
}

@test "sense-only: the script carries no act/mutation verbs against pack state" {
  # the script is the only place that could ACT. it's JS, so the gate targets JS
  # fs-write / subprocess APIs + br/gh act verbs — NOT shell redirects (a `>` in a
  # path comment like `<root>/x.yaml` is not a write). process.stdout.write is the
  # sensor's OUTPUT channel (allowed); it is intentionally not matched.
  run grep -nE '(br[[:space:]]+(update|close)|gh[[:space:]]+(pr|issue|release)[[:space:]]|writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|renameSync|execSync|spawnSync)' \
    "$SENSOR"
  [ "$status" -ne 0 ]
}

@test "construct.yaml registers the skill + command" {
  run grep -c 'sensing-runtime-fit' "$REPO/construct.yaml"
  [ "$status" -eq 0 ]
  [ "$output" -ge 3 ]   # description mention + skill slug + command name
}

@test "construct.yaml declares NO workflow.gates (GECKO stays sense-only)" {
  run grep -nE '^\s*workflow:' "$REPO/construct.yaml"
  [ "$status" -ne 0 ]
}
