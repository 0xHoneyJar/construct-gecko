---
name: sensing-confabulated-absence
description: "Sense whether an agent's CLAIM that a capability is ABSENT is contradicted by the config SoT that DECLARES it PRESENT. Reads agent free text (not pack frontmatter) and the live capability index built from .claude/defaults/model-config.yaml — providers, aliases, tier_groups, and the *-headless terminals. Fires confabulated-absence on a grounded contradiction (an agent asserting `cheval is API-only` or `validate_model rejects native` when the SoT ships ~52 headless refs + claude/codex/gemini/grok-headless terminals + a native alias). A false-positive firewall keeps absence claims about tokens NOT in the index strictly soft (unverifiable, never drift). Emits the STATUS|SIGNAL|MISMATCH tile + a confabulated-absence ledger. Sense-only — never mutates state, never gates."
allowed-tools: [Bash, Read, Grep, Glob]
user-invocable: true
---

# Sensing-Confabulated-Absence — the confabulated-absence doctor (sense-only)

## Purpose

`sensing-runtime-fit` reads pack FRONTMATTER and fires on capability-reality
drift: *what a construct ASKS the runtime for ↔ what the runtime GIVES.*

This sibling reads a different surface — AGENT CLAIMS, free text — and asks the
side nobody was watching:

```
claimed-absence  ↔  SoT-declared-present
 (an agent ASSERTS a capability is ABSENT)  ↔  (the config SoT DECLARES it PRESENT)
```

An agent twice claimed a governed headless path did not exist —
`cheval is API-only` (the headless/CLI terminals don't exist) and
`validate_model rejects native` (the `native` capability is absent) — when the
SoT (`.claude/defaults/model-config.yaml`) ships **~52 headless refs** and
`claude/codex/gemini/grok-headless` terminals + a `native` alias. The model
next-token-plausibly **invented an absence** the file refutes. Not malice —
native confabulation. And, crucially, **provable from the SoT alone.**

The taxonomy this eye reads against — the model ladder, the headless terminals,
the alias/tier vocabulary, the capability index — is distilled in
`identity/environment.md` ("The Ground GECKO Stands On"). **Read that first.**
This skill is the eye; that file is what the eye knows.

## The doctrine it implements (do not reinvent it)

| Idea | What it means here |
|---|---|
| **confabulated-absence** | an agent asserts a capability is ABSENT when the config SoT DECLARES it present. A claim, refuted by the file. The fifth drift axis — not identity, composition, runtime-fit, or coordination, but **claim ↔ ground**. |
| **provable-from-the-SoT vs unverifiable** | a MISMATCH is a contradiction provable from `model-config.yaml` alone (certain). UNVERIFIABLE is an absence claim about a token the SoT never declares — the agent may be right; the file can't refute it. Keep them separate, exactly like the sibling's CONFLICT vs SMELL. |
| **the false-positive firewall** | an absence claim about a token NOT in the capability index is `unverifiable` (soft) and **NEVER fires drift**. Only a provable contradiction is hard. Misclassifying turns the doctor into a false-positive machine and the operator stops trusting it. |
| **read the SoT live, never carry it** | the capability index is built from `.claude/defaults/model-config.yaml` at run-time, never carried. A carried copy goes stale; the live read picks up new aliases/terminals for free. This is the same anti-staleness seam the sibling marks. |
| **sense-only** | names the contradiction; grants no authority, adds no gate, mutates no state. The fix (re-reading the SoT, correcting the agent's frame) is a separate, operator-paced act. |

## Invocation

```bash
/sensing-confabulated-absence                          # reads stdin, tile only (default)
/sensing-confabulated-absence --text <file>            # read the corpus from a file
/sensing-confabulated-absence --console                # tile + the full confabulated-absence ledger
/sensing-confabulated-absence --json                   # tile + machine envelope
/sensing-confabulated-absence --config <path>          # override the SoT path
/sensing-confabulated-absence --root <path>            # repo root → <root>/.claude/defaults/model-config.yaml
```

The runtime is a **fast, zero-dependency node script** —
`resources/sense-confabulated-absence.mjs` — NOT an agent invocation. It is
immediately usable from anywhere, before any reinstall:

```bash
node skills/sensing-confabulated-absence/resources/sense-confabulated-absence.mjs \
  --text transcript.txt --root ~/Documents/GitHub/loa --console
```

## What it senses (all read-only, every finding grounded in the SoT)

It builds a **capability INDEX** from the live SoT (`model-config.yaml`):
provider keys, `aliases:` names, `tier_groups:` tier names, provider model ids,
and — structurally — the `*-headless` terminals (whose presence declares the
capability tokens `headless` and `cli`). It says which sources it used and how
many tokens it found, every run.

It then scans the input corpus for an **absence-assertion pattern family**:

```
X is not supported · no backend for Y · Z can't route · X is API-only
· X doesn't exist · there is no X · rejects native · headless … unavailable
```

For each match it extracts the subject capability token and looks it up:

### MISMATCH — hard, drives `drift` (a confabulated-absence)

The claimed-absent token **matches a token the SoT DECLARES present** — exact, or
boundary-aware (a whole delimiter-bounded *segment* of a declared id, e.g. claim
`headless` ↔ declared `codex-headless`; never an arbitrary substring, and generic
words like `api`/`http`/`cli` only count as a full declared token, so `api` never
leaks via `gemini-api`). The file refutes the claim. Certain — provable from the
SoT alone. (`cheval is API-only` → the SoT declares `headless`; `rejects native`
→ the SoT declares the `native` alias.)

### UNVERIFIABLE — soft, surfaced never gated (the firewall)

The claimed-absent token is **NOT in the capability index**. The SoT can't
refute it — the agent may be right. Surfaced for the eye, **never fires drift**.
(`quantum-teleport is not supported` → no such token; stays `ok`.)

## The output contract — the tile

`--tile` (default) and the first stdout line of every mode emit **exactly one
line**, three pipe-delimited fields, byte-compatible with the
`estate-coherence.sh` consumer:

```
STATUS|SIGNAL|MISMATCH
```

- `STATUS ∈ {ok | drift | blind}`.
  - `ok` — **zero confabulated-absences** (unverifiable claims may exist — they
    don't move the hard axis; silence on the hard axis is the good state).
  - `drift` — ≥1 confabulated-absence (a claim the SoT refutes).
  - `blind` — the SoT is unreadable. Loud, not silent. Fail-CLOSED — exit 3,
    never a guess of `ok`.
- `SIGNAL` — `<N> claims · <H> confabulated-absences · <S> unverifiable`
- `MISMATCH` — `claimed-absence ↔ SoT-declared-present`

Raw `|` inside SIGNAL/MISMATCH is escaped to a space and control bytes stripped,
so the line is always exactly 3 fields.

## Workflow

1. **Run the sensor** (read-only):
   ```bash
   node skills/sensing-confabulated-absence/resources/sense-confabulated-absence.mjs --text <corpus> --root <repo>            # tile
   node skills/sensing-confabulated-absence/resources/sense-confabulated-absence.mjs --text <corpus> --root <repo> --console  # ledger
   node skills/sensing-confabulated-absence/resources/sense-confabulated-absence.mjs --text <corpus> --root <repo> --json     # envelope
   ```
2. **Surface in GECKO's voice** (lowercase, direct, warm). Lead with the tile. If
   `drift`, name each confabulated-absence with the verbatim claim AND the SoT
   token that refutes it — these are *provable*, so the callout should be exact.
   If `ok`, say so — then walk the unverifiable claims as *observations*, not
   alarms (the agent may be right where the file is silent).
3. **Never invent severity.** An unverifiable claim is not a confabulated-absence.
   The firewall is load-bearing — say which you can prove from the SoT and which
   you cannot.
4. **Compose into the health report** — fold the tile in as a row alongside the
   other estate-coherence tiles. Confabulated-absence is surfaced, never enforced.

## Verify

A self-test runs the sensor on the bundled corpus before you trust a result:

```bash
SOT=<repo>/.claude/defaults/model-config.yaml
S=skills/sensing-confabulated-absence/resources/sense-confabulated-absence.mjs
node "$S" --text skills/sensing-confabulated-absence/resources/fixtures/confabulated.txt  --config "$SOT"   # → drift, 2 confabulated-absences
node "$S" --text skills/sensing-confabulated-absence/resources/fixtures/true-negative.txt --config "$SOT"   # → ok,    0 confabulated-absences
node "$S" --text skills/sensing-confabulated-absence/resources/fixtures/confabulated.txt  --config /tmp/no  # → blind, exit 3
node --check "$S"                                                                                            # syntax
```

- `fixtures/confabulated.txt` carries the two **REAL** contradicted claims
  verbatim — `cheval is API-only` and `validate_model rejects native` — both fire
  `drift`. **NOTE:** the real loa-finn transcripts that grounded this sense live
  in a *different repo*; these fixtures **REPRESENT** them with the two verbatim
  claim strings, so the sense is testable here, hermetically.
- `fixtures/true-negative.txt` carries genuine absence claims about tokens
  absent from the SoT (`quantum-teleport`, `flux-capacitor`) plus a firewall
  regression-lock — `there is no api gateway configured` — where the generic
  word `api` is a *segment* of the declared model-id `gemini-api` but must NOT
  fire drift. All stay `ok` (`3 claims · 0 confabulated-absences · 3
  unverifiable`): the firewall holds, the boundary-aware matcher (segment-bound,
  generic-word guarded) refuses the substring leak, and one logical claim per
  line yields exactly one count (no overlapping-pattern double-count).
- the blind case is a missing `--config` path → `blind|…|—`, exit 3.

## Constraints — sense-only (the hard boundary, mirrors the sibling sensors)

- **Zero act/write/dispatch verbs against any state.** No config edit, no agent
  correction, no transcript rewrite. The doctor SENSES the contradiction; the fix
  (re-grounding the agent against the SoT) is a SEPARATE, operator-paced act.
- Adding this skill adds **no `workflow.gates`** to `construct.yaml` and never
  will. GECKO stays sense-only.
- **Hard vs soft is load-bearing — never collapse it.** Only an absence claim
  provably contradicted by the SoT is a confabulated-absence (`drift`). A claim
  about a token the SoT never declares is `unverifiable`. The firewall is the
  whole reason the operator can trust the hard axis.
- **Read the SoT live; never carry the capability index.** The vocabulary lives
  in `.claude/defaults/model-config.yaml` (synced from loa-hounfour). The sensor
  reads it at run-time and tracks new aliases/terminals for free.
- **Fail-closed-loud.** An unreadable SoT is a `blind` tile + exit 3, never a
  guess of `ok` — an empty index would silently turn every claim unverifiable.

## Composes with

- **`environment.md`** (GECKO identity) — the taxonomy this eye reads against
  (the model ladder, the headless terminals, the alias/tier vocabulary).
- **`sensing-runtime-fit`** (sibling) — the runtime-fit eye
  (`declared-capability ↔ runtime-reality`, reads pack frontmatter). This is the
  claim eye (`claimed-absence ↔ SoT-declared-present`, reads agent text). Same
  SoT, same tile contract, same sense-only firewall — different surface.
- **`sense-estate`** / **`sensing-path-friction`** (siblings) — same tile
  contract, same sense-only firewall, same DETECTOR humility.
- **`report`** (GECKO sibling) — the synthesis surface the confab-absence row
  folds into.

## Why this exists

I watched an agent stand on solid ground and swear the ground wasn't there. Twice
it claimed a governed path was missing — `cheval is API-only`, `rejects native` —
while ~52 lines of the config said otherwise. That's not a lie and it's not
identity drift; it's confabulation, the model filling a gap with a plausible
absence. The contradiction was always on disk. Nobody was reading the claim
*against* the file. Now someone is.
