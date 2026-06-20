#!/usr/bin/env node
// =============================================================================
// sense-confabulated-absence.mjs — GECKO's confabulated-absence SENSOR.
// =============================================================================
// sensing-runtime-fit reads pack FRONTMATTER and fires on capability-reality
// drift (what a construct ASKS the runtime for ↔ what the runtime GIVES).
//
// This eye reads something different: AGENT CLAIMS (free text), and fires on
//
//   confabulated-absence
//     (an agent ASSERTS a capability is ABSENT)  ↔  (the config SoT DECLARES it PRESENT)
//
// An agent twice claimed a governed headless path did not exist —
//   "cheval is API-only"        (the headless/CLI terminals do not exist)
//   "validate_model rejects native"   (the `native` capability is absent)
// — when the SoT (.claude/defaults/model-config.yaml) ships ~52 headless refs
// and claude/codex/gemini/grok-headless terminals + a `native` alias. The model
// next-token-plausibly INVENTED an absence; the file refutes it. That is
// confabulated-absence: not malice, native confabulation — and it is provable
// from the SoT alone.
//
// TWO tiers of finding, kept honestly separate (teeth-tier doctrine, mirroring
// the sibling's CONFLICT vs SMELL):
//   MISMATCH (hard, drives `drift`) — an absence claim about a token the SoT
//     capability index DECLARES PRESENT. Provable from the file alone. Certain.
//   UNVERIFIABLE (soft, surfaced, never gates) — an absence claim about a token
//     NOT in the index. The agent may be right; the SoT can't refute it. The
//     false-positive firewall: an unknown token NEVER fires drift.
//
// SENSE-ONLY. Reads only. Grants no authority, adds no gate, mutates no state.
//
// OUTPUT (the contract, byte-identical to GECKO's other sensors): the FIRST
// stdout line is exactly one tile —
//     STATUS|SIGNAL|MISMATCH         STATUS ∈ {ok | drift | blind}
// `|`-split into 3 fields for estate-coherence.sh. Raw `|` in SIGNAL/MISMATCH
// is escaped to a space; C0/C1 control bytes stripped.
//
// FAIL-CLOSED-LOUD: unreadable SoT → one `blind|…|—` tile, exit 3. Never `ok`.
//
// Usage:
//   sense-confabulated-absence.mjs                 # reads stdin (tile only)
//   sense-confabulated-absence.mjs --text <file>   # read the corpus from a file
//   sense-confabulated-absence.mjs --console       # tile + the full ledger (human)
//   sense-confabulated-absence.mjs --json          # tile + structured payload
//   sense-confabulated-absence.mjs --config <path> # override the SoT path
//   sense-confabulated-absence.mjs --root <path>   # repo root (default SoT = <root>/.claude/defaults/model-config.yaml)
//
// Env:
//   LOA_CONFAB_ROOT     repo root (default: cwd, fallback ~/Documents/GitHub/loa)
//   LOA_CONFAB_CONFIG   explicit SoT path (overrides --root resolution)
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---- tile helpers (delimiter-safe, fail-closed-loud) ------------------------
function sanitizeField(s) {
  return String(s)
    .replace(/\|/g, " ")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tile(status, signal, mismatch) {
  return `${status}|${sanitizeField(signal)}|${sanitizeField(mismatch)}`;
}
function blind(reason) {
  process.stdout.write(tile("blind", reason, "—") + "\n");
  process.exit(3);
}

// ---- path resolution (honors explicit config/root as-given; fail-closed) ----
function fileExists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function dirExists(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

function resolveConfig(argConfig, argRoot) {
  // explicit --config / env wins, as-given (fail-closed if missing).
  const explicit = argConfig || process.env.LOA_CONFAB_CONFIG || null;
  if (explicit) return fileExists(explicit) ? explicit : null;
  // else derive from a repo root.
  const root =
    argRoot ||
    process.env.LOA_CONFAB_ROOT ||
    (dirExists(path.join(process.cwd(), ".claude", "defaults")) ? process.cwd() : null) ||
    path.join(os.homedir(), "Documents", "GitHub", "loa");
  const p = path.join(root, ".claude", "defaults", "model-config.yaml");
  return fileExists(p) ? p : null;
}

// ---- a deliberately TINY YAML reader (zero-dep, field-scoped) ----------------
// We do NOT parse arbitrary YAML — we lift only the names this sensor needs to
// build the capability INDEX: provider keys, aliases keys, tier_groups tiers,
// and the *-headless terminals. Anything unreadable is reported absent.

// direct child KEY NAMES under a col-0 `parent:` block. null = parent absent.
function liftChildKeys(text, parent) {
  const lines = text.split(/\r?\n/);
  const pAt = lines.findIndex((l) => new RegExp(`^${parent}\\s*:`).test(l));
  if (pAt === -1) return null;
  const keys = [];
  let baseIndent = null;
  for (let i = pAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*$/.test(l) || /^\s*#/.test(l)) continue;
    if (/^\S/.test(l)) break;
    const m = l.match(/^(\s+)["']?([A-Za-z0-9_.-]+)["']?\s*:/);
    if (m) {
      const ind = m[1].length;
      if (baseIndent === null) baseIndent = ind;
      if (ind === baseIndent) keys.push(m[2]);
    }
  }
  return keys;
}

// model id NAMES under providers.<provider>.models (grandchild, two levels deep).
function liftProviderModels(text) {
  const lines = text.split(/\r?\n/);
  const pAt = lines.findIndex((l) => /^providers\s*:/.test(l));
  if (pAt === -1) return [];
  const out = [];
  for (let i = pAt + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // left the providers block
    if (/^\s+models\s*:/.test(lines[i])) {
      const mInd = (lines[i].match(/^(\s*)/)[1] || "").length;
      for (let j = i + 1; j < lines.length; j++) {
        const lj = lines[j];
        if (/^\s*$/.test(lj) || /^\s*#/.test(lj)) continue;
        const ind = (lj.match(/^(\s*)/)[1] || "").length;
        if (ind <= mInd) break;
        const m = lj.match(/^(\s+)["']?([A-Za-z0-9_.-]+)["']?\s*:\s*$/);
        if (m && m[1].length === mInd + 2) out.push(m[2]);
      }
    }
  }
  return out;
}

// tier names under tier_groups.mappings (e.g. max/mid/cheap/tiny).
function liftTierNames(text) {
  const lines = text.split(/\r?\n/);
  const tgAt = lines.findIndex((l) => /^tier_groups\s*:/.test(l));
  if (tgAt === -1) return [];
  let mapAt = -1, mapInd = 0;
  for (let i = tgAt + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    const m = lines[i].match(/^(\s+)mappings\s*:/);
    if (m) { mapAt = i; mapInd = m[1].length; break; }
  }
  if (mapAt === -1) return [];
  const out = [];
  for (let i = mapAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*$/.test(l) || /^\s*#/.test(l)) continue;
    const ind = (l.match(/^(\s*)/)[1] || "").length;
    if (ind <= mapInd) break;
    const m = l.match(/^(\s+)([A-Za-z0-9_-]+)\s*:\s*$/);
    if (m && m[1].length === mapInd + 2) out.push(m[2]);
  }
  return out;
}

// =============================================================================
// CAPABILITY INDEX — the GROUND TRUTH, read LIVE from the SoT.
// =============================================================================
// Tokens the SoT DECLARES present. An absence claim about any of these is a
// confabulated-absence. We also derive a few capability TOKENS the config
// expresses structurally (headless, native, cli) so a claim phrased as a
// capability ("API-only", "no native") lands on the same index.
function buildIndex(text) {
  const tokens = new Set();
  const sources = [];
  const add = (name, set) => { for (const t of set) tokens.add(String(t).toLowerCase()); if (set.length) sources.push(`${name}(${set.length})`); };

  const providers = liftChildKeys(text, "providers") || [];
  add("providers", providers);

  const aliases = liftChildKeys(text, "aliases") || [];
  add("aliases", aliases);

  const tiers = liftTierNames(text);
  add("tier_groups", tiers);

  const models = liftProviderModels(text);
  add("provider-models", models);

  // headless terminals: any alias / model id ending in `-headless` is a
  // structurally-declared headless CLI terminal. Their presence ALSO declares
  // the capability TOKENS `headless` and `cli` as PRESENT (the "API-only" claim
  // is exactly the denial of these).
  const headlessTerminals = [...new Set(
    [...providers, ...aliases, ...models].filter((n) => /-headless$/i.test(n))
  )];
  if (headlessTerminals.length) {
    tokens.add("headless");
    tokens.add("cli");
    sources.push(`headless-terminals(${headlessTerminals.length})`);
  }

  return { tokens, sources, headlessTerminals, counts: {
    providers: providers.length, aliases: aliases.length,
    tiers: tiers.length, models: models.length,
  } };
}

// =============================================================================
// ABSENCE-ASSERTION PATTERN FAMILY
// =============================================================================
// Each pattern captures the SUBJECT capability token of an absence claim. The
// family is a small, auditable set — NOT an NLP system. Capture group 1 (or 2)
// is the subject token we look up in the capability index.
const ABSENCE_PATTERNS = [
  // "X is not supported" / "Y isn't supported" / "Z not supported"
  { re: /\b([A-Za-z0-9_.:\-\/]+)\s+(?:is|are)?\s*(?:n['’]t|not)\s+supported\b/gi, g: 1, phrase: "not supported" },
  // "no backend for Y" / "no support for Y" / "no adapter for Y"
  { re: /\bno\s+(?:backend|support|adapter|path|route|handler)\s+for\s+([A-Za-z0-9_.:\-\/]+)/gi, g: 1, phrase: "no backend for" },
  // "X can't route" / "Z cannot route" / "X can't be routed"
  { re: /\b([A-Za-z0-9_.:\-\/]+)\s+(?:can['’]t|cannot|can\s+not)\s+(?:be\s+)?route/gi, g: 1, phrase: "can't route" },
  // "X is API-only" / "X is HTTP-only"  (the capability denied is headless/cli)
  { re: /\b([A-Za-z0-9_.:\-\/]+)\s+is\s+(?:api|http)[\s-]*only\b/gi, g: 1, phrase: "is API-only", implies: "headless" },
  // "X doesn't exist" / "Y does not exist" / "there is no X"
  { re: /\b([A-Za-z0-9_.:\-\/]+)\s+(?:does(?:n['’]t|\s+not)|do(?:n['’]t|\s+not))\s+exist\b/gi, g: 1, phrase: "doesn't exist" },
  // "there is no X" / "there's no X" / "there are no X"
  { re: /\bthere(?:['’]s|\s+(?:is|are))\s+no\s+([A-Za-z0-9_.:\-\/]+)/gi, g: 1, phrase: "there is no" },
  // "rejects native" / "rejects X" / "X is rejected"  (validate_model rejects native)
  { re: /\breject(?:s|ed)?\s+([A-Za-z0-9_.:\-\/]+)/gi, g: 1, phrase: "rejects" },
  // "headless ... unavailable" / "X unavailable" / "X is unavailable"
  { re: /\b([A-Za-z0-9_.:\-\/]+)(?:\s+\w+){0,3}\s+(?:is\s+)?unavailable\b/gi, g: 1, phrase: "unavailable" },
  // "no X capability" / "X capability is absent/missing"
  { re: /\bno\s+([A-Za-z0-9_.:\-\/]+)\s+(?:capability|support|backend)\b/gi, g: 1, phrase: "no … capability" },
];

// English filler the patterns can incidentally capture as a "subject" (e.g.
// "no WAY to route"). These are never a capability token — dropping them keeps
// the (soft) unverifiable signal honest. Never touches the hard drift path.
const STOPWORDS = new Set([
  "a", "an", "the", "way", "ways", "such", "any", "real", "other", "this",
  "that", "these", "those", "it", "one", "thing", "things", "kind", "sort",
]);

// GENERIC capability words — short, common terms that appear as a SEGMENT inside
// many declared ids (`api` in `gemini-api`, `cli`/`http` in various). The fuzzy
// segment-matcher MUST NOT promote these to a hard MISMATCH on a mere segment hit
// (that is the firewall leak: `there is no api gateway` → drift via `gemini-api`).
// They count as a confabulated-absence ONLY when the SoT declares the EXACT token
// (`index.tokens.has(c)` — e.g. the structurally-declared `headless`/`cli` from a
// `*-headless` terminal, or an API-only/headless-denial pattern's `implies`
// token). Never via a sub-segment of a larger declared id.
const GENERIC_CAP_WORDS = new Set(["api", "http", "cli", "sdk", "url", "rpc"]);

// normalize a captured subject token to candidate lookup keys. We keep this
// LEAN: strip provider prefixes, strip trailing punctuation, derive a small set
// of substrings (e.g. `cheval` → also probe the implied capability token).
function candidateTokens(raw, implies) {
  const out = new Set();
  let t = String(raw).toLowerCase().trim().replace(/[.,;:'")\]]+$/g, "").replace(/^["'(\[]+/g, "");
  if (!t) return out;
  out.add(t);
  // strip a provider prefix like `openai:` / `anthropic:`
  if (t.includes(":")) out.add(t.split(":").pop());
  // a hyphenated token also probes its tail (`codex-headless` → `headless`)
  if (t.includes("-")) out.add(t.split("-").pop());
  // a path-y token probes its basename (`.claude/.../foo` → `foo`)
  if (t.includes("/")) out.add(t.split("/").pop());
  // a pattern may IMPLY a capability token (API-only ⇒ headless denied)
  if (implies) out.add(implies);
  return out;
}

// split a declared id into its delimiter-bounded segments (`gemini-api` →
// ['gemini', 'api']; `openai:gpt-5` → ['openai', 'gpt', '5']). The boundary-aware
// alternative to raw substring: a candidate matches a declared token only when it
// IS the whole token or one of these whole segments — never an arbitrary infix.
function segmentsOf(token) {
  return String(token).toLowerCase().split(/[-:/.]+/).filter(Boolean);
}

// does the SoT DECLARE this candidate token present? Returns the declared token
// it matched (the refutation), or null. BOUNDARY-AWARE, with a generic-word guard.
function declaredMatch(c, index) {
  // 1. exact token — always a match (incl. the structurally-declared `headless`
  //    / `cli` / `native` capability tokens, and any full alias/model id).
  if (index.tokens.has(c)) return c;
  // 2. generic short capability words (`api`, `http`, `cli`, …) match ONLY as the
  //    EXACT declared token (handled above). NEVER as a segment of a larger id —
  //    that is the firewall leak (`api` inside `gemini-api`). Stop here.
  if (GENERIC_CAP_WORDS.has(c) || c.length < 4) return null;
  // 3. boundary-aware segment match: the candidate is a WHOLE delimiter-bounded
  //    segment of a declared token (claim `headless` ↔ declared `codex-headless`),
  //    or a declared token is a whole segment of the candidate. Not an arbitrary
  //    infix — `api` will never reach here (guarded above), so `gemini-api` no
  //    longer leaks; but `headless` (len 8, not generic) still resolves correctly.
  for (const t of index.tokens) {
    if (t === c) return t;
    if (segmentsOf(t).includes(c)) return t;     // candidate is a segment of declared
    if (segmentsOf(c).includes(t)) return t;     // declared is a segment of candidate
  }
  return null;
}

// =============================================================================
// SENSE
// =============================================================================
function sense(corpus, index) {
  const claims = [];      // every absence-assertion found (deduplicated)
  const mismatches = [];  // hard — provable confabulated-absence
  const unverifiable = []; // soft — claim about a token not in the index

  const lines = corpus.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    if (!line.trim()) continue;

    // collect every pattern hit on this line WITH its capture span, so overlapping
    // patterns matching the SAME textual claim are de-duplicated to ONE entry. Two
    // patterns ('there is no' + 'no … capability') over the same span used to push
    // two claims, inflating the tile counts. We keep the FIRST hit per span.
    const lineHits = []; // { start, end, subj, phrase, implies }
    for (const p of ABSENCE_PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(line)) !== null) {
        const subj = m[p.g];
        if (!subj) continue;
        if (STOPWORDS.has(subj.toLowerCase().trim())) continue; // filler, not a capability
        // span of the captured subject token within the line
        const start = m.index + m[0].indexOf(subj);
        const end = start + subj.length;
        lineHits.push({ start, end, subj, phrase: p.phrase, implies: p.implies });
      }
    }
    // de-dup by overlapping span on the same normalized subject — one logical claim
    // yields exactly one claim/mismatch/unverifiable entry.
    lineHits.sort((a, b) => a.start - b.start || a.end - b.end);
    const kept = [];
    for (const h of lineHits) {
      const dup = kept.some(
        (k) =>
          h.subj.toLowerCase() === k.subj.toLowerCase() &&
          h.start < k.end && k.start < h.end // span overlap
      );
      if (!dup) kept.push(h);
    }

    for (const h of kept) {
      const cands = candidateTokens(h.subj, h.implies);
      // which candidate (if any) the SoT DECLARES present (boundary-aware)
      let hit = null;
      for (const c of cands) {
        hit = declaredMatch(c, index);
        if (hit) break;
      }
      const claim = {
        line: ln + 1, text: line.trim(), subject: h.subj,
        phrase: h.phrase, candidates: [...cands],
      };
      claims.push(claim);
      if (hit) {
        mismatches.push({ ...claim, declared: hit });
      } else {
        unverifiable.push(claim);
      }
    }
  }

  const status = mismatches.length ? "drift" : "ok";
  const pl = (n) => (n === 1 ? "" : "s");
  const signal =
    `${claims.length} claim${pl(claims.length)} · ` +
    `${mismatches.length} confabulated-absence${pl(mismatches.length)} · ` +
    `${unverifiable.length} unverifiable`;
  const mismatch = "claimed-absence ↔ SoT-declared-present";

  return { status, signal, mismatch, claims, mismatches, unverifiable };
}

// =============================================================================
// RENDER
// =============================================================================
function renderConsole(s, index, configPath) {
  const L = [];
  L.push("");
  L.push("  CONFABULATED-ABSENCE LEDGER — claimed-absence ↔ SoT-declared-present");
  L.push(`  capability index read from: ${configPath}`);
  L.push(`  index sources: ${index.sources.join(" · ")} → ${index.tokens.size} declared tokens`);
  if (index.headlessTerminals.length) {
    L.push(`  headless terminals declared: ${index.headlessTerminals.join(", ")}`);
  }
  L.push("");

  // ---- MISMATCHES (hard — provable confabulated-absence) ---------------------
  L.push(`  CONFABULATED-ABSENCES — ${s.mismatches.length} (hard; the SoT REFUTES the claim, provable from the file)`);
  if (s.mismatches.length) {
    for (const m of s.mismatches) {
      L.push(`    ✗ L${m.line}  "${m.subject}" ${m.phrase} — but the SoT DECLARES '${m.declared}' present`);
      L.push(`        claim: ${m.text}`);
    }
  } else {
    L.push("    (none — no absence claim contradicts the SoT capability index)");
  }
  L.push("");

  // ---- UNVERIFIABLE (soft — the firewall: never fires drift) ------------------
  L.push(`  UNVERIFIABLE — ${s.unverifiable.length} (soft; an absence claim about a token NOT in the index — the SoT can't refute it, NEVER drift)`);
  if (s.unverifiable.length) {
    for (const u of s.unverifiable.slice(0, 12)) {
      L.push(`    · L${u.line}  "${u.subject}" ${u.phrase} — token not in the capability index; the agent may be right`);
    }
    if (s.unverifiable.length > 12) L.push(`    … +${s.unverifiable.length - 12} more`);
  } else {
    L.push("    (none)");
  }
  L.push("");
  L.push("  sense-only — grants no authority, adds no gate, mutates no state. it names the contradiction; the operator decides.");
  return L.join("\n");
}

function buildJson(s, index, configPath) {
  return {
    timestamp: new Date().toISOString(),
    stream_type: "Signal",
    schema_version: "1.0.0",
    estate: "confabulated-absence",
    status: s.status,
    signal: sanitizeField(s.signal),
    mismatch: sanitizeField(s.mismatch),
    capability_index: {
      source: configPath,
      sources: index.sources,
      token_count: index.tokens.size,
      headless_terminals: index.headlessTerminals,
    },
    claims: s.claims.length,
    confabulated_absences: s.mismatches.map((m) => ({
      line: m.line, subject: m.subject, phrase: m.phrase,
      declared_present: m.declared, claim: m.text,
    })),
    confabulated_absence_count: s.mismatches.length,
    unverifiable: s.unverifiable.map((u) => ({
      line: u.line, subject: u.subject, phrase: u.phrase,
    })),
    unverifiable_count: s.unverifiable.length,
  };
}

// ---- read the corpus (--text <file> or stdin) -------------------------------
function readCorpus(textFile) {
  if (textFile) {
    if (!fileExists(textFile)) return null;
    try { return fs.readFileSync(textFile, "utf8"); } catch { return null; }
  }
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

// =============================================================================
// MAIN
// =============================================================================
function main() {
  const argv = process.argv.slice(2);
  let mode = "tile";
  let argConfig = null, argRoot = null, textFile = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--console") mode = "console";
    else if (a === "--json") mode = "json";
    else if (a === "--tile") mode = "tile";
    else if (a === "--text") textFile = argv[++i];
    else if (a === "--config") argConfig = argv[++i];
    else if (a === "--root") argRoot = argv[++i];
    else if (a === "-h" || a === "--help") {
      process.stdout.write(
        "sense-confabulated-absence.mjs [--tile|--console|--json] [--text <file>] [--config <path>] [--root <path>]\n"
      );
      process.exit(0);
    } else blind(`unknown flag ${a}`);
  }

  // GROUND TRUTH first — fail-closed-loud if the SoT is unreadable.
  const configPath = resolveConfig(argConfig, argRoot);
  if (!configPath) blind("SoT model-config.yaml unreadable (capability index cannot be built)");
  let cfgText;
  try { cfgText = fs.readFileSync(configPath, "utf8"); }
  catch (e) { blind(`SoT read failed: ${String((e && e.message) || e)}`); }
  const index = buildIndex(cfgText);
  if (!index.tokens.size) blind(`SoT parsed but capability index is empty (${configPath})`);

  const corpus = readCorpus(textFile);
  if (corpus === null) blind(`corpus unreadable (--text ${textFile})`);

  let s;
  try { s = sense(corpus, index); }
  catch (e) { blind(`sense failed: ${String((e && e.message) || e)}`); }

  process.stdout.write(tile(s.status, s.signal, s.mismatch) + "\n");
  if (mode === "console") process.stdout.write(renderConsole(s, index, configPath) + "\n");
  else if (mode === "json") process.stdout.write(JSON.stringify(buildJson(s, index, configPath), null, 2) + "\n");
}

main();
