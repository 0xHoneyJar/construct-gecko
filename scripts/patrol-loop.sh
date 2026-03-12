#!/usr/bin/env bash
# =============================================================================
# Gecko — Patrol Loop (cron-compatible)
# =============================================================================
# Autonomous observation cycle orchestrator.
# Runs health-score.ts in a loop, commits findings, tracks state.
#
# Usage:
#   ./scripts/patrol-loop.sh                  # Default: 3 cycles
#   ./scripts/patrol-loop.sh --cycles 10      # 10 cycles
#   ./scripts/patrol-loop.sh --once           # Single cycle
#   ./scripts/patrol-loop.sh --cron           # Cron mode: single cycle, no tty
#
# Designed for:
#   - Manual invocation from terminal
#   - launchd plist (macOS)
#   - GitHub Actions cron
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONSTRUCT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default output to grimoires/gecko/ in the repo that installed this construct
# If running standalone, output to local grimoires/
GRIMOIRE_DIR="${GECKO_GRIMOIRE_DIR:-grimoires/gecko}"
OBSERVATIONS="$GRIMOIRE_DIR/observations.jsonl"
STATE_FILE="$GRIMOIRE_DIR/patrol-state.json"

# Args
CYCLES=3
CRON_MODE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --cycles) CYCLES="$2"; shift 2 ;;
        --once) CYCLES=1; shift ;;
        --cron) CRON_MODE=true; CYCLES=1; shift ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# Ensure output directory exists
mkdir -p "$GRIMOIRE_DIR"

# ---------------------------------------------------------------------------
# State Management
# ---------------------------------------------------------------------------

load_state() {
    if [[ -f "$STATE_FILE" ]]; then
        cat "$STATE_FILE"
    else
        echo '{"status":"FRESH","current_cycle":0,"total_cycles":'"$CYCLES"',"baseline_score":0,"best_score":0}'
    fi
}

save_state() {
    local status="$1"
    local cycle="$2"
    local baseline="$3"
    local best="$4"

    cat > "$STATE_FILE" << EOF
{
  "status": "$status",
  "current_cycle": $cycle,
  "total_cycles": $CYCLES,
  "baseline_score": $baseline,
  "best_score": $best,
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "last_activity": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
}

# ---------------------------------------------------------------------------
# Main Loop
# ---------------------------------------------------------------------------

echo "gecko | patrol starting | $CYCLES cycle(s)"

STATE=$(load_state)
BASELINE=$(echo "$STATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('baseline_score', 0))" 2>/dev/null || echo 0)
BEST=$(echo "$STATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('best_score', 0))" 2>/dev/null || echo 0)
STABLE_COUNT=0

for ((i=1; i<=CYCLES; i++)); do
    echo ""
    echo "gecko | cycle $i/$CYCLES"

    # Run health check
    OUTPUT=$(npx tsx "$CONSTRUCT_ROOT/scripts/health-score.ts" --append "$OBSERVATIONS" --json 2>/dev/null || echo '{"health_score":0,"api_status":"error"}')

    SCORE=$(echo "$OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('health_score', 0))" 2>/dev/null || echo 0)
    API_STATUS=$(echo "$OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('api_status', 'unknown'))" 2>/dev/null || echo "unknown")

    DELTA=$((SCORE - BASELINE))

    # Ratchet logic
    if [[ $SCORE -gt $BEST ]]; then
        BEST=$SCORE
        echo "gecko | health: $SCORE (+$DELTA) | new best"
    elif [[ $DELTA -ge -2 && $DELTA -le 2 ]]; then
        STABLE_COUNT=$((STABLE_COUNT + 1))
        echo "gecko | health: $SCORE (stable) | streak: $STABLE_COUNT"
    else
        STABLE_COUNT=0
        echo "gecko | health: $SCORE ($DELTA) | degradation detected"
    fi

    # Update baseline on improvement
    if [[ $SCORE -gt $BASELINE ]]; then
        BASELINE=$SCORE
    fi

    save_state "RUNNING" "$i" "$BASELINE" "$BEST"

    # Kaironic termination: stable for 3 consecutive cycles
    if [[ $STABLE_COUNT -ge 3 ]]; then
        echo "gecko | stable for 3 cycles — terminating (no new signal)"
        break
    fi

    # API down for 2 consecutive cycles
    if [[ "$API_STATUS" == "down" || "$API_STATUS" == "error" ]]; then
        if [[ $i -ge 2 ]]; then
            echo "gecko | API unreachable for 2+ cycles — halting"
            save_state "HALTED" "$i" "$BASELINE" "$BEST"
            exit 0
        fi
    fi

    # Brief pause between cycles (not needed for single/cron)
    if [[ $i -lt $CYCLES && "$CRON_MODE" == "false" ]]; then
        sleep 5
    fi
done

save_state "COMPLETE" "$CYCLES" "$BASELINE" "$BEST"

echo ""
echo "gecko | patrol complete | $CYCLES cycle(s) | health: $BASELINE | best: $BEST | findings in $GRIMOIRE_DIR/"
