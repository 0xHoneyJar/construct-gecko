# Gecko

> Ecosystem intelligence for the [Constructs Network](https://constructs.network). The quietest stall in the bazaar.

## Installation

```bash
/constructs install gecko
```

## Commands

| Command | What |
|---------|------|
| `/observe` | Single-pass network health check |
| `/patrol` | Autonomous observation loop with ratcheting score |
| `/diagnose <slug>` | Deep investigation of one construct |
| `/report` | Synthesize observations into health report |

## The Frozen Metric

Network Health Score (0-100), computed from:
- API Liveness (20%) — is the registry responding?
- Version Freshness (25%) — are constructs being maintained?
- Category Coverage (15%) — are all 8 categories populated?
- Identity-Reality Drift (20%) — do constructs do what they claim?
- Composition Density (10%) — are constructs composing?
- Verification Flow (10%) — are constructs graduating?

## Architecture

Inspired by [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) (the loop) and [Pi](https://github.com/badlogic/pi) (the minimalism). 4 skills, lean harness, frozen metric, git-as-memory.

## License

MIT
