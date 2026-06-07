# Proposal — loa-hounfour as the model-tier Source of Truth

> Author: GECKO (runtime-fit eye). Date: 2026-06-07. Status: **partially landed**
> (emitter + sensor conformed); **proposed** (hounfour vocabulary + kernel line).
> Trigger: the `sensing-runtime-fit` sensor surfaced a live tier-vocabulary
> collision — the word `cheap` resolved to **sonnet** in the cheval runtime and
> **haiku** in the composition emitter.

## The decision (operator, 2026-06-07)

**loa-hounfour is the Source of Truth for model intelligence tiers.** `cheap` ≡
**sonnet** is canonical (the live-runtime meaning — changing the runtime is
dangerous; changing the newer emitter is safe). Consumers READ the SoT; none carry
a private tier list.

The canonical vocabulary (all collapsing to the 3 native Workflow models):

| Tier | → native model | Notes |
|------|---------------|-------|
| `max` | opus | cheval `tier_groups.max` |
| `opus` | opus | concrete family |
| `deep` | opus | deprecated emitter alias |
| `mid` | sonnet | cheval `tier_groups.mid` |
| `cheap` | **sonnet** | cheval alias `cheap: claude-sonnet-4-6` — **NOT haiku** |
| `standard` | sonnet | deprecated emitter alias |
| `sonnet` | sonnet | concrete family |
| `tiny` | haiku | cheval `tier_groups.tiny` — the cheapest native rung |
| `haiku` | haiku | concrete family |

The seam contract: a construct's `capabilities.model_tier` + `downgrade_allowed`
govern routing — `downgrade_allowed: false` PINS the tier; `true` is a ceiling the
cost-heuristic may route under. (cycle 2026-06-06, parallel session.)

## Landed this session (DONE, verified)

1. **Emitter conformed** — `construct-rooms-substrate/scripts/lib/segment-emitter.py`:
   `_TIER_TO_MODEL` rebuilt to accept the canonical vocabulary; `cheap` reconciled
   haiku → **sonnet**; the `_NORMALIZE_TIER` indirection removed (every tier maps
   directly to a native model). Functional smoke: 9 tier cases + gate-floor +
   unknown-tier fallthrough all correct. **Uncommitted** — operator commits.
2. **GECKO sensor conformed** — `construct-gecko/skills/sensing-runtime-fit`: reads
   the home (`model-config.yaml`) live, names **loa-hounfour as SoT**, and AFFIRMS
   `cheap ≡ sonnet` instead of warning a collision. 10/10 bats. `environment.md` §I
   + `SKILL.md` updated to the reconciled state.

## Proposed (NOT applied — operator's call)

### A. Make hounfour the SoT *structurally*, not just documentarily

loa-hounfour today has `model-capabilities.schema.json` + `model-provider-spec`
but **no intelligence-tier vocabulary** — the canonical tier names live only in
cheval's `model-config.yaml` (a deployment) and (until today) the emitter's private
table. To make hounfour the real SoT, add a vocabulary file following its existing
conventions (cf. `src/vocabulary/conformance-category.ts`, `pools.ts`):

```ts
// loa-hounfour/src/vocabulary/intelligence-tier.ts  (PROPOSED)
import { Type, type Static } from '@sinclair/typebox';

/** Canonical model intelligence tiers. Abstract tiers + concrete families. */
export const INTELLIGENCE_TIERS = [
  'max', 'mid', 'cheap', 'tiny',        // routing tiers (cheval tier_groups)
  'opus', 'sonnet', 'haiku',            // concrete families (unambiguous)
] as const;
export type IntelligenceTier = (typeof INTELLIGENCE_TIERS)[number];

/** Canonical tier → concrete model family. `cheap` ≡ sonnet (NOT haiku). */
export const TIER_TO_FAMILY: Record<IntelligenceTier, 'opus'|'sonnet'|'haiku'> = {
  max: 'opus', opus: 'opus',
  mid: 'sonnet', cheap: 'sonnet', sonnet: 'sonnet',
  tiny: 'haiku', haiku: 'haiku',
};

/** Deprecated emitter aliases retained for back-compat (not in the enum). */
export const DEPRECATED_TIER_ALIASES = { standard: 'sonnet', deep: 'opus' } as const;
```

Then: cheval's `model-config.yaml`, the compose emitter, and GECKO's sensor all
reference this one definition. (Requires hounfour's own build/test/SCHEMA-CHANGELOG
process — hence proposed, not applied. Hounfour was deliberately NOT modified here.)

### B. Kernel line (the [C] artifact — operator places it; global-kernel is yours)

One line, naming the SoT (NOT the deprecated emitter vocab the earlier draft proposed):

> Model intelligence-tier SoT = **loa-hounfour** (deployed as
> `.claude/defaults/model-config.yaml`). Tiers: `max`→opus · `mid`/`cheap`→sonnet ·
> `tiny`→haiku (+ concrete opus/sonnet/haiku). `cheap` ≡ sonnet, NOT haiku. The seam:
> a construct's `model_tier` + `downgrade_allowed` govern routing (`false` = pin).
> Consumers READ the SoT; none carry a private tier list.

## Residual / follow-ups

- `model-config.yaml` should carry a one-line comment naming loa-hounfour as the
  tier-vocabulary SoT (it's a System-Zone framework default — framework owner's edit).
- Audit any other consumer that hardcodes `cheap`≡haiku (none found in the construct
  estate; the emitter was the only one).
- [D] declaration-honesty worklist (separate): constructs opus-pinned on light work
  (`the-arcade`) — surfaced by `sensing-runtime-fit`'s `opus-pinned-light` smell.
