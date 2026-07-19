---
name: sensing-belt-progress
description: "Sense sonar-api Belt sync progression (Envio chain_metadata) via the belt-progress substrate — tip lag, stall class, ETA. GECKO tile + --json. Sense-only; never sets ENVIO_RESTART."
allowed-tools: [Bash, Read, Grep, Glob]
user-invocable: true
---

# Sensing-Belt-Progress (GECKO lens)

Sense-only eye for the **sonar-api** Belt indexer. The substrate lives in the consuming repo:

```bash
# From sonar-api root (preferred)
node scripts/belt-progress.mjs --tile
node scripts/belt-progress.mjs --robot-triage --json

# Or via this skill's wrapper (resolves SONAR_API_ROOT / sibling checkout)
node skills/sensing-belt-progress/resources/sense-belt-progress.mjs
node skills/sensing-belt-progress/resources/sense-belt-progress.mjs --json
```

## Env

| Var | Role |
|-----|------|
| `SONAR_API_ROOT` | Path to sonar-api checkout (default: `~/Documents/GitHub/sonar-api`) |
| `BELT_GRAPHQL_URL` | Hasura GraphQL (default public sonar gateway) |

## Tile

`STATUS|SIGNAL|MISMATCH` with `STATUS ∈ {ok|drift|blind}` — byte-compatible with estate-coherence consumers.

## Hard rule

Never set `ENVIO_RESTART`. KF-013 wipe/resume is operator Railway procedure.
