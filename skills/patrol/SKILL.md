# Patrol — Autonomous Observation Loop

## Purpose

The Karpathy Loop for network health. Runs time-boxed observation cycles, ratchets the health score, and commits findings to grimoires. This is the autonomous mode — set it running, walk away, come back to a health trail.

## Invocation

```bash
/patrol                     # Default: 3 cycles, 5-minute windows
/patrol --cycles 10         # Run 10 observation cycles
/patrol --once              # Single cycle (alias for /observe + commit)
```

## Workflow

### Step 1: Load State

Check `grimoires/gecko/patrol-state.json` for active patrol state:

```json
{
  "status": "RUNNING|HALTED|COMPLETE",
  "current_cycle": 3,
  "total_cycles": 10,
  "baseline_score": 72,
  "best_score": 75,
  "started_at": "2026-03-12T00:00:00Z",
  "last_activity": "2026-03-12T00:15:00Z"
}
```

If `status: RUNNING`, resume from `current_cycle`. If no state file, initialize fresh.

### Step 2: Execute Observation Cycle

For each cycle:
1. Run `/observe` (the atomic health check)
2. Read the emitted observation from `observations.jsonl`
3. Compare `health_score` against `baseline_score`

### Step 3: Ratchet Decision

| Condition | Action |
|---|---|
| `health_score > best_score` | Update `best_score`, log improvement |
| `health_score == baseline_score ± 2` | Stable — log, continue |
| `health_score < baseline_score - 5` | Flag degradation, surface contributing factors |
| API unreachable | Log as `DEGRADED`, do not halt |

The ratchet only moves up. If the network gets healthier, the new score becomes the baseline. If it degrades, gecko surfaces what changed — but doesn't reset the baseline.

### Step 4: Commit Findings

After each cycle:
1. Stage `grimoires/gecko/observations.jsonl` and `grimoires/gecko/patrol-state.json`
2. Commit with message: `gecko: patrol cycle N — health: XX (delta)`
3. Do NOT push — accumulate locally, push on `/report` or manually

### Step 5: Kaironic Termination

Stop when:
- All cycles completed
- Health score stable across 3 consecutive cycles (no new signal)
- API is down for 2 consecutive cycles (no point observing a dead network)
- User interrupts

Update patrol-state to `COMPLETE` or `HALTED` with reason.

### Step 6: Summary

Output a one-paragraph patrol summary:
```
gecko | patrol complete | 5 cycles | health: 72→75 (+3) | 2 anomalies surfaced | findings in grimoires/gecko/
```

## Outputs

| Path | Description |
|------|-------------|
| `grimoires/gecko/observations.jsonl` | Append-only observation log (one line per cycle) |
| `grimoires/gecko/patrol-state.json` | Patrol loop state for resume |

## Trust Boundary

- Patrol READS: API endpoints, GitHub repos, construct manifests
- Patrol WRITES: only `grimoires/gecko/`
- Patrol COMMITS: only grimoires/gecko/ files
- Patrol NEVER: modifies construct source, pushes to remote, creates PRs

## Constraints

- Time-box each cycle to 5 minutes max (Pi philosophy: constrained windows produce better signal)
- Git-as-memory: the observation log IS the long-term memory, not the conversation context
- If context gets heavy, compact — the JSONL has the truth, not the chat
