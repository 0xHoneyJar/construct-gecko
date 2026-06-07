#!/usr/bin/env node
// =============================================================================
// sense-runtime-fit.mjs — GECKO's runtime-fit SENSOR (the fourth side).
// =============================================================================
// GECKO's other eyes ask:
//   persona  ↔  manifest  ↔  skill        (identity-reality — /diagnose)
//   declared ↔  governed   ↔  earned       (composition/authority — sensing-construct-console)
//
// This eye asks the side nobody was watching:
//
//   declared-capability  ↔  runtime-reality
//        (what a construct asks the runtime for)  ↔  (what the runtime gives)
//
// A construct declares a CONTRACT WITH THE RUNTIME in its construct.yaml
// `capabilities` block (model_tier, danger_level, downgrade_allowed,
// effort_hint, execution_hint, requires) and in each skill's frontmatter
// (allowed-tools, agent, capabilities, cost-profile). 37/43 packs in the
// reference estate declare a capabilities block — and NOTHING doctors it.
// This sensor reads that contract and checks it against the runtime taxonomy
// GECKO now carries (identity/environment.md) and against the skill's own
// declared tools.
//
// TWO tiers of finding, kept honestly separate (teeth-tier doctrine:
// invariant > gate > detector):
//   CONFLICT (hard, drives `drift`) — a contradiction that SILENTLY BREAKS:
//     · agent-type write-conflict (#553): a skill declares write capability but
//       routes through a read-restricted agent type → output never persists.
//     · write_files:false but Write/Edit in allowed-tools (security smell).
//     · web_access:false but WebFetch/WebSearch in allowed-tools.
//     · model_tier the runtime does not offer (typo / stale tier).
//   SMELL (soft, surfaced, never gates) — a judgment, like path-friction:
//     · opus pinned + downgrade forbidden for small/medium/safe work (cost).
//     · no capabilities block at all (the runtime defaults apply blind).
//     · requires-vocabulary drift across the estate.
//     · a tool in allowed-tools the sensor doesn't recognize (MCP-tolerant).
//   And it SURFACES (not a problem): which packs claim `workflow.gates` —
//   the harness exception that lets a construct write code outside /implement.
//   A gate-owner is a high-authority claim worth the operator's eye.
//
// SENSE-ONLY. Reads only. Grants no authority, adds no gate, mutates no pack.
//
// OUTPUT (the contract, byte-identical to GECKO's other sensors): the FIRST
// stdout line is exactly one tile —
//     STATUS|SIGNAL|MISMATCH         STATUS ∈ {ok | drift | blind}
// `|`-split into 3 fields for estate-coherence.sh. Raw `|` in SIGNAL/MISMATCH
// is escaped to a space; C0/C1 control bytes stripped.
//
// FAIL-CLOSED-LOUD: unreadable root / parse failure → one `blind|…|—` tile, exit 3.
//
// Usage:
//   sense-runtime-fit.mjs                 # tile only (default; SessionStart-cheap)
//   sense-runtime-fit.mjs --console       # tile + the full runtime-fit ledger (human)
//   sense-runtime-fit.mjs --json          # tile + structured payload
//   sense-runtime-fit.mjs --root <path>   # override the consuming repo root
//
// Env:
//   LOA_RUNTIME_FIT_ROOT   consuming repo root (default: cwd, fallback ~/Documents/GitHub/loa-freeside)
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ============================ RUNTIME TAXONOMY (distilled) ====================
// The ONE place GECKO carries runtime facts it CANNOT sense from a file in the
// consuming repo. These are the SLOW-MOVING AXES (the kinds-of-things), NOT a
// snapshot of values. When the Claude Code runtime's tiers / agent allowlist
// change, update HERE (and identity/environment.md) — this is the seam where the
// map meets the part of the territory that lives outside the repo.
// Provenance: the live Claude Code runtime (Agent-tool subagent allowlists +
// model tiers Opus/Sonnet/Haiku) + .claude/scripts/validate-skill-capabilities.sh
// (the WRITE_CAPABLE_AGENTS array — issue #553).
const TAXONOMY = {
  // intelligence tiers — the capability/cost ladder. The RECOGNIZED vocabulary is
  // READ FROM THE HOME at runtime: the consuming repo's
  // .claude/defaults/model-config.yaml (the hounfour/cheval config, synced from
  // loa-hounfour). That is the anti-staleness SEAM — the sensor no longer CARRIES
  // the tier list (a carried list goes stale); it reads the home via
  // readModelConfig() and falls back to the carried union below ONLY when the home
  // file is absent. See identity/environment.md §I.
  //
  //   HOME vocab (model-config.yaml ← loa-hounfour, the SoT): tier_groups
  //     {max, mid, cheap, tiny}; aliases opus, cheap(≡SONNET), tiny(≡haiku).
  //   RECONCILED 2026-06-07 (hounfour = SoT): `cheap` ≡ SONNET is canonical. The
  //     composition emitter (construct-rooms-substrate segment-emitter.py) was
  //     conformed from its old cheap≡haiku to the canonical cheap≡sonnet.
  model_families: ["opus", "sonnet", "haiku"],   // concrete families — always valid
  // carried fallback union of BOTH vocabularies — the bridge used when the home is
  // absent, and to keep the two live vocabularies from false-flagging each other.
  fallback_tier_vocab: ["opus", "sonnet", "haiku", "max", "mid", "cheap", "tiny", "deep", "standard"],
  // the EXPENSIVE rung across every vocabulary — a pin here on light work is the
  // opus-pinned-light cost smell (home `opus`/`max` · emitter `deep`).
  top_tier: ["opus", "max", "deep"],
  // agent types whose tool-allowlist INCLUDES Write/Edit/NotebookEdit. A skill
  // that must PERSIST output may route only through these (or leave agent unset,
  // inheriting the caller). Everything else is read-restricted.
  write_capable_agents: ["general-purpose"],
  // read-restricted agent types we can name positively (for a precise message).
  // An UNKNOWN agent type is treated conservatively as read-restricted and
  // surfaced — never assumed writable.
  read_restricted_agents: ["plan", "explore", "claude-code-guide"],
  danger_levels: ["safe", "moderate", "dangerous"],
  effort_hints: ["small", "medium", "large"],
  execution_hints: ["sequential", "parallel"],
  // the core always-present runtime tools. NOT exhaustive — MCP + deferred tools
  // exist, so an unrecognized tool is a SOFT signal (listed), never a hard fail.
  known_tools: new Set([
    "Bash", "Read", "Write", "Edit", "Glob", "Grep", "Agent", "Workflow",
    "Skill", "WebFetch", "WebSearch", "NotebookEdit", "Task", "TaskCreate",
    "TaskUpdate", "TodoWrite", "BashOutput", "KillShell", "SlashCommand",
    "ToolSearch", "AskUserQuestion", "ScheduleWakeup", "EnterPlanMode",
    "ExitPlanMode",
  ]),
};

// effort tiers for which an opus pin (with no downgrade) reads as a cost smell.
const LIGHT_EFFORT = new Set(["small", "medium"]);

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

// ---- a deliberately TINY YAML reader (zero-dep, field-scoped) ----------------
// We do NOT parse arbitrary YAML — we lift only the specific fields this sensor
// needs. Anything unreadable is reported null/absent — never guessed.
function stripQuotes(s) {
  return String(s).replace(/^['"]|['"]$/g, "").trim();
}

// SKILL.md frontmatter (between the first two --- fences). "" if no fence.
function frontmatterOf(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  return m ? m[1] : "";
}

// top-level `key: value` (col-0, no indent). Returns null if absent / block-scalar.
function liftTopScalar(text, key) {
  const m = text.match(new RegExp(`^${key}\\s*:\\s*(.*?)\\s*(?:#.*)?$`, "m"));
  if (!m) return null;
  const v = stripQuotes(m[1].trim());
  if (v === "" || v === "|" || v === ">") return null;
  return v;
}

// `parent:` at col-0, then `  child: value` indented under it (before next col-0 key).
function liftNestedScalar(text, parent, child) {
  const lines = text.split(/\r?\n/);
  const pAt = lines.findIndex((l) => new RegExp(`^${parent}\\s*:`).test(l));
  if (pAt === -1) return null;
  for (let i = pAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break; // left the block (next col-0 key)
    const m = l.match(new RegExp(`^\\s+${child}\\s*:\\s*(.*?)\\s*(?:#.*)?$`));
    if (m) {
      const v = stripQuotes(m[1].trim());
      return v === "" ? null : v;
    }
  }
  return null;
}

// direct child KEY NAMES under a col-0 `parent:` block. null = parent absent;
// [] = present-but-empty.
function liftChildKeys(text, parent) {
  const lines = text.split(/\r?\n/);
  const pAt = lines.findIndex((l) => new RegExp(`^${parent}\\s*:`).test(l));
  if (pAt === -1) return null;
  const keys = [];
  let baseIndent = null;
  for (let i = pAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*$/.test(l)) continue;
    if (/^\S/.test(l)) break;
    const m = l.match(/^(\s+)([A-Za-z0-9_-]+)\s*:/);
    if (m) {
      const ind = m[1].length;
      if (baseIndent === null) baseIndent = ind;
      if (ind === baseIndent) keys.push(m[2]);
    }
  }
  return keys;
}

// grandchild key names under `parent:` > `child:` (e.g. capabilities > requires).
function liftGrandchildKeys(text, parent, child) {
  const lines = text.split(/\r?\n/);
  const pAt = lines.findIndex((l) => new RegExp(`^${parent}\\s*:`).test(l));
  if (pAt === -1) return null;
  // bound the parent block
  let pEnd = lines.length;
  for (let i = pAt + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) { pEnd = i; break; }
  }
  let cAt = -1, cIndent = 0;
  for (let i = pAt + 1; i < pEnd; i++) {
    const m = lines[i].match(new RegExp(`^(\\s+)${child}\\s*:`));
    if (m) { cAt = i; cIndent = m[1].length; break; }
  }
  if (cAt === -1) return null;
  const keys = [];
  let baseIndent = null;
  for (let i = cAt + 1; i < pEnd; i++) {
    const l = lines[i];
    if (/^\s*$/.test(l)) continue;
    const ind = (l.match(/^(\s*)/)[1] || "").length;
    if (ind <= cIndent) break;
    const m = l.match(/^(\s+)([A-Za-z0-9_-]+)\s*:/);
    if (m && (baseIndent === null || m[1].length === baseIndent)) {
      if (baseIndent === null) baseIndent = m[1].length;
      keys.push(m[2]);
    }
  }
  return keys;
}

// allowed-tools list — inline `[A, B]` OR block `- A`. Returns [] if absent.
function liftToolList(text) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^allowed-tools\s*:/.test(l));
  if (at === -1) return [];
  const inline = lines[at].match(/^allowed-tools\s*:\s*\[(.*)\]\s*$/);
  if (inline) {
    return inline[1].split(",").map((x) => stripQuotes(x.trim())).filter(Boolean);
  }
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*$/.test(l)) continue;
    if (/^\S/.test(l)) break;
    const m = l.match(/^\s*-\s+([A-Za-z0-9_-]+)\s*(?:#.*)?$/);
    if (m) out.push(m[1]);
  }
  return out;
}

function hasTool(tools, name) {
  return tools.some((t) => t.toLowerCase() === name.toLowerCase());
}

// ---- root + path resolution (honors explicit root as-given; fail-closed) ----
function dirExists(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function fileExists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function resolveRoot(argRoot) {
  const explicit = argRoot || process.env.LOA_RUNTIME_FIT_ROOT || null;
  if (explicit) {
    return dirExists(path.join(explicit, ".claude", "constructs", "packs")) ? explicit : null;
  }
  const cwd = process.cwd();
  if (dirExists(path.join(cwd, ".claude", "constructs", "packs"))) return cwd;
  const fb = path.join(os.homedir(), "Documents", "GitHub", "loa-freeside");
  if (dirExists(path.join(fb, ".claude", "constructs", "packs"))) return fb;
  return null;
}

// ---- HOME read: the canonical tier vocabulary (the anti-staleness seam) ------
// Reads <root>/.claude/defaults/model-config.yaml — the hounfour/cheval config
// (System Zone default, synced from loa-hounfour). Extracts the recognized tier
// vocabulary (alias names + tier_groups tier names) so the sensor TRACKS the home
// automatically instead of carrying a copy that drifts. Absent home → caller uses
// the carried fallback and SAYS SO (loud, never silent).
function readModelConfig(root) {
  const p = path.join(root, ".claude", "defaults", "model-config.yaml");
  const empty = { present: false, path: p, aliases: [], tiers: [], cheapTarget: null };
  if (!fileExists(p)) return empty;
  let text;
  try { text = fs.readFileSync(p, "utf8"); } catch { return empty; }
  return {
    present: true, path: p,
    aliases: liftChildKeys(text, "aliases") || [],
    tiers: liftGrandchildKeys(text, "tier_groups", "mappings") || [],
    cheapTarget: liftNestedScalar(text, "aliases", "cheap"), // e.g. "anthropic:claude-sonnet-4-6"
  };
}

// =============================================================================
// SENSE
// =============================================================================
function sense(root) {
  const packsDir = path.join(root, ".claude", "constructs", "packs");
  let entries;
  try { entries = fs.readdirSync(packsDir); }
  catch { return { blind: `packs dir unreadable (${packsDir})` }; }

  const packs = []; // per-pack runtime-fit record
  const conflicts = []; // hard
  const smells = []; // soft
  const gateOwners = []; // surfaced
  const requiresVocab = new Map(); // key -> count (vocab drift detection)

  // ---- HOME vocabulary: read it, don't carry it (the anti-staleness seam) -----
  const home = readModelConfig(root);
  const recognizedTiers = new Set(
    [
      ...TAXONOMY.model_families,
      ...TAXONOMY.fallback_tier_vocab,                          // bridge: both live vocabularies
      ...(home.present ? [...home.aliases, ...home.tiers] : []), // + the live home (picks up CUSTOM aliases/tiers for free)
    ].map((t) => String(t).toLowerCase())
  );
  const tierSource = home.present
    ? `home: ${path.relative(root, home.path) || home.path}`
    : "carried fallback (home model-config.yaml absent)";
  // grounded SoT affirmation: name loa-hounfour as the tier SoT and report the
  // home's canonical `cheap` resolution (read live). RECONCILED 2026-06-07 — the
  // composition emitter was conformed (cheap→sonnet), so this affirms the canonical
  // rather than warning of a collision. The sensor states what consumers conform TO.
  const tierSotNote =
    home.present && home.cheapTarget
      ? `tier SoT = loa-hounfour; home model-config.yaml resolves cheap ≡ sonnet (${home.cheapTarget}) — canonical; consumers conform`
      : null;

  for (const name of entries.sort()) {
    if (name.endsWith(".frozen.bak")) continue;
    const full = path.join(packsDir, name);
    let st; try { st = fs.statSync(full); } catch { continue; }
    if (!st.isDirectory()) continue;

    const manifestPath = path.join(full, "construct.yaml");
    const rec = {
      slug: name, manifestReadable: false,
      model_tier: null, danger_level: null, downgrade_allowed: null,
      effort_hint: null, execution_hint: null,
      has_capabilities: false, requires_keys: [],
      gate_owner: false, skills: [],
    };

    if (!fileExists(manifestPath)) {
      // No manifest = a different sensor's signal (sensing-construct-console
      // owns no-manifest drift). Here we just can't read the runtime contract.
      rec.no_manifest = true;
      packs.push(rec);
      continue;
    }
    let yaml; try { yaml = fs.readFileSync(manifestPath, "utf8"); }
    catch { rec.no_manifest = true; packs.push(rec); continue; }
    rec.manifestReadable = true;

    // ---- construct-level capability contract --------------------------------
    const capKeys = liftChildKeys(yaml, "capabilities");
    rec.has_capabilities = capKeys !== null;
    rec.model_tier = liftNestedScalar(yaml, "capabilities", "model_tier");
    rec.danger_level = liftNestedScalar(yaml, "capabilities", "danger_level");
    rec.downgrade_allowed = liftNestedScalar(yaml, "capabilities", "downgrade_allowed");
    rec.effort_hint = liftNestedScalar(yaml, "capabilities", "effort_hint");
    rec.execution_hint = liftNestedScalar(yaml, "capabilities", "execution_hint");
    const reqKeys = liftGrandchildKeys(yaml, "capabilities", "requires") || [];
    rec.requires_keys = reqKeys;
    for (const k of reqKeys) requiresVocab.set(k, (requiresVocab.get(k) || 0) + 1);

    // workflow.gates — a high-authority claim to SURFACE (not a problem).
    const wfKeys = liftChildKeys(yaml, "workflow");
    if (wfKeys && wfKeys.includes("gates")) {
      rec.gate_owner = true;
      gateOwners.push(name);
    }

    // SMELL: model_tier not recognized by the HOME vocabulary (read live) nor the
    // carried bridge. SOFT, deliberately — an unknown tier falls back to a default;
    // it doesn't silently corrupt output, and the map is fallible (an unknown rung
    // may be NEW, not stale). So: surface, never gate.
    if (rec.model_tier && !recognizedTiers.has(rec.model_tier.toLowerCase())) {
      smells.push({ slug: name, kind: "unknown-model-tier",
        detail: `capabilities.model_tier:'${rec.model_tier}' not recognized by ${tierSource} — stale vocabulary or a tier not yet in the home config` });
    }

    // SMELL: the top (most expensive) rung pinned + downgrade forbidden for
    // light/safe work. top_tier spans every vocabulary (home opus/max · emitter
    // deep). This is the cost-correction WORKLIST: the emitter HONORS
    // downgrade_allowed, so a light construct pinned to the top rung actually routes
    // there (real money) until the declaration is fixed.
    const isTopTier = rec.model_tier && TAXONOMY.top_tier.includes(rec.model_tier.toLowerCase());
    if (isTopTier && rec.downgrade_allowed === "false") {
      const light = rec.effort_hint && LIGHT_EFFORT.has(rec.effort_hint.toLowerCase());
      const safe = rec.danger_level && rec.danger_level.toLowerCase() === "safe";
      if (light || safe) {
        smells.push({ slug: name, kind: "opus-pinned-light",
          detail: `${rec.model_tier} (top tier) + downgrade_allowed:false for ${light ? `effort:${rec.effort_hint}` : ""}${light && safe ? " " : ""}${safe ? `danger:${rec.danger_level}` : ""} — pins the most expensive rung with no escape hatch for light work` });
      }
    }

    // SMELL: no capabilities block at all → runtime defaults apply blind.
    if (!rec.has_capabilities) {
      smells.push({ slug: name, kind: "no-capabilities",
        detail: "no capabilities block — declares nothing about its runtime needs; the runtime defaults apply blind" });
    }

    // ---- skill-level frontmatter contracts ----------------------------------
    const unknownTier = new Map(); // value -> #skills (grouped: one root cause, one line)
    const skillsDir = path.join(full, "skills");
    let skillDirs = [];
    try { skillDirs = fs.readdirSync(skillsDir); } catch { skillDirs = []; }
    for (const sName of skillDirs.sort()) {
      const sFull = path.join(skillsDir, sName);
      let sst; try { sst = fs.statSync(sFull); } catch { continue; }
      if (!sst.isDirectory()) continue;

      // prefer SKILL.md frontmatter; index.yaml carries the capabilities block.
      const skillMd = path.join(sFull, "SKILL.md");
      const indexYaml = path.join(sFull, "index.yaml");
      let fm = "";
      if (fileExists(skillMd)) { try { fm = frontmatterOf(fs.readFileSync(skillMd, "utf8")); } catch {} }
      let idx = "";
      if (fileExists(indexYaml)) { try { idx = fs.readFileSync(indexYaml, "utf8"); } catch {} }
      if (!fm && !idx) continue;

      const tools = liftToolList(fm);
      const agent = liftTopScalar(fm, "agent");
      // write capability declared at skill OR index level
      const wf = liftNestedScalar(fm, "capabilities", "write_files")
        || liftNestedScalar(idx, "capabilities", "write_files");
      const web = liftNestedScalar(fm, "capabilities", "web_access")
        || liftNestedScalar(idx, "capabilities", "web_access");
      const sModelTier = liftNestedScalar(idx, "capabilities", "model_tier")
        || liftNestedScalar(fm, "capabilities", "model_tier");

      const needsWrite = (wf === "true") || hasTool(tools, "Write") || hasTool(tools, "Edit");
      const skillRec = { slug: sName, agent, tools, needsWrite, model_tier: sModelTier };
      rec.skills.push(skillRec);

      // CONFLICT (#553): write capability routed through a read-restricted agent.
      if (agent && needsWrite &&
          !TAXONOMY.write_capable_agents.includes(agent.toLowerCase())) {
        conflicts.push({ slug: `${name}/${sName}`, kind: "agent-write-conflict",
          detail: `skill declares write capability but agent: '${agent}' is read-restricted — output is produced then SILENTLY not persisted (issue #553). Unset agent: or use ${TAXONOMY.write_capable_agents.join("/")}` });
      }
      // CONFLICT: write_files:false but a write tool present (security smell).
      if (wf === "false" && (hasTool(tools, "Write") || hasTool(tools, "Edit"))) {
        conflicts.push({ slug: `${name}/${sName}`, kind: "write-denied-but-tooled",
          detail: "capabilities.write_files:false but Write/Edit in allowed-tools" });
      }
      // CONFLICT: web_access:false but a web tool present.
      if (web === "false" && (hasTool(tools, "WebFetch") || hasTool(tools, "WebSearch"))) {
        conflicts.push({ slug: `${name}/${sName}`, kind: "web-denied-but-tooled",
          detail: "capabilities.web_access:false but WebFetch/WebSearch in allowed-tools" });
      }
      // skill model_tier not recognized by the home/bridge vocab → accumulate per
      // value, emit ONE grouped smell below. Never 34 lines for one copy-pasted template.
      if (sModelTier && !recognizedTiers.has(sModelTier.toLowerCase())) {
        unknownTier.set(sModelTier, (unknownTier.get(sModelTier) || 0) + 1);
      }
      // SMELL: a tool the sensor doesn't recognize (MCP-tolerant — listed, soft).
      for (const t of tools) {
        if (!TAXONOMY.known_tools.has(t) && !t.startsWith("mcp__")) {
          smells.push({ slug: `${name}/${sName}`, kind: "unknown-tool",
            detail: `allowed-tools lists '${t}' — not a recognized core runtime tool (ok if MCP/custom; surfaced for the eye)` });
        }
      }
    }

    // grouped skill-level unknown-tier smell (one line per distinct value — the
    // root cause is usually one copy-pasted frontmatter template, not N bugs).
    for (const [val, n] of unknownTier) {
      smells.push({ slug: name, kind: "unknown-model-tier", count: n,
        detail: `skill capabilities.model_tier:'${val}' on ${n} skill(s) — not recognized by ${tierSource}; one template, foreign/stale vocabulary` });
    }

    packs.push(rec);
  }

  // SMELL: requires-vocabulary drift across the estate.
  const vocabKeys = [...requiresVocab.keys()].sort();

  // ---- STATUS classification --------------------------------------------------
  // drift iff any HARD conflict. smells + gate-owners are surfaced, never gate.
  const status = conflicts.length ? "drift" : "ok";

  const liveCount = packs.filter((p) => p.manifestReadable).length;
  const signal =
    `${liveCount} packs · ${conflicts.length} conflicts · ` +
    `${smells.length} smells · ${gateOwners.length} gate-owners`;
  const mismatch = "declared-capability ↔ runtime-reality (what it asks for ↔ what the runtime gives)";

  return {
    blind: null, root, packsDir,
    status, signal, mismatch,
    packs, conflicts, smells, gateOwners,
    vocabKeys, requiresVocab,
    tierSource, tierSotNote, home,
    recognizedTierCount: recognizedTiers.size,
  };
}

// =============================================================================
// RENDER
// =============================================================================
function renderConsole(s) {
  const L = [];
  L.push("");
  L.push("  RUNTIME-FIT LEDGER — declared-capability ↔ runtime-reality");
  L.push(`  tier vocab read from: ${s.tierSource}  (the home is the SoT; the sensor reads it, never carries it)`);
  if (s.tierSotNote) L.push(`  ${s.tierSotNote}`);
  L.push(`  write-capable agents {${TAXONOMY.write_capable_agents.join(", ")}} · everything else read-restricted · downgrade_allowed governs routing`);
  L.push("");

  // ---- CONFLICTS (hard — these silently break) -------------------------------
  L.push(`  CONFLICTS — ${s.conflicts.length} (hard; a contradiction that breaks silently)`);
  if (s.conflicts.length) {
    for (const c of s.conflicts) L.push(`    ✗ ${c.slug}  [${c.kind}]  ${c.detail}`);
  } else {
    L.push("    (none — the declared runtime contracts cohere with the runtime)");
  }
  L.push("");

  // ---- SMELLS (soft — judgments, surfaced never gated) -----------------------
  L.push(`  SMELLS — ${s.smells.length} (soft; a judgment for the operator's eye, never a gate)`);
  const byKind = {};
  for (const sm of s.smells) (byKind[sm.kind] ||= []).push(sm);
  for (const kind of Object.keys(byKind)) {
    L.push(`    · ${kind} (${byKind[kind].length}):`);
    for (const sm of byKind[kind].slice(0, 8)) L.push(`        ${sm.slug}  ${sm.detail}`);
    if (byKind[kind].length > 8) L.push(`        … +${byKind[kind].length - 8} more`);
  }
  if (!s.smells.length) L.push("    (none)");
  L.push("");

  // ---- requires-vocabulary drift ---------------------------------------------
  L.push("  REQUIRES VOCABULARY — the sub-keys packs declare under capabilities.requires");
  if (s.vocabKeys.length) {
    for (const k of s.vocabKeys) L.push(`    ${k}: ${s.requiresVocab.get(k)} packs`);
    L.push("    (a key used by only one or two packs is a candidate drift — the estate hasn't agreed on the vocabulary)");
  } else {
    L.push("    (no requires blocks found)");
  }
  L.push("");

  // ---- gate owners (surfaced; high-authority claim) --------------------------
  L.push(`  GATE OWNERS — ${s.gateOwners.length} (packs declaring workflow.gates — the /implement-bypass exception)`);
  if (s.gateOwners.length) {
    for (const g of s.gateOwners) L.push(`    ⚑ ${g}  — claims to own a quality pipeline; worth the operator's eye`);
  } else {
    L.push("    (none — no construct claims pipeline ownership; all code flows through the harness gates)");
  }
  L.push("");

  // ---- per-pack capability snapshot ------------------------------------------
  L.push("  PER-PACK CONTRACT (model_tier · downgrade · effort · danger · #skills)");
  for (const p of s.packs.filter((x) => x.manifestReadable)) {
    const mt = p.model_tier || "—";
    const da = p.downgrade_allowed === null ? "—" : p.downgrade_allowed;
    const eff = p.effort_hint || "—";
    const dl = p.danger_level || "—";
    const cap = p.has_capabilities ? "" : "  (no capabilities block)";
    L.push(`    ${p.slug.padEnd(26)} ${String(mt).padEnd(7)} dgr:${String(da).padEnd(5)} eff:${String(eff).padEnd(7)} dngr:${String(dl).padEnd(9)} ${p.skills.length} skills${cap}`);
  }
  L.push("");
  L.push("  sense-only — grants no authority, adds no gate, mutates no pack. it names the mismatch; the operator decides.");
  return L.join("\n");
}

function buildJson(s) {
  return {
    timestamp: new Date().toISOString(),
    stream_type: "Signal",
    schema_version: "1.0.0",
    estate: "runtime-fit",
    status: s.status,
    signal: sanitizeField(s.signal),
    mismatch: sanitizeField(s.mismatch),
    tier_vocabulary: {
      source: s.tierSource,
      home_present: s.home ? s.home.present : false,
      recognized_count: s.recognizedTierCount,
      sot_note: s.tierSotNote,
      top_tier: TAXONOMY.top_tier,
    },
    write_capable_agents: TAXONOMY.write_capable_agents,
    sources: { packs_dir: s.packsDir, model_config: s.home ? s.home.path : null },
    packs_checked: s.packs.filter((p) => p.manifestReadable).length,
    conflicts: s.conflicts,
    smells: s.smells.map((x) => ({ slug: x.slug, kind: x.kind })),
    smell_count: s.smells.length,
    gate_owners: s.gateOwners,
    requires_vocabulary: Object.fromEntries(s.requiresVocab),
  };
}

// =============================================================================
// MAIN
// =============================================================================
function main() {
  const argv = process.argv.slice(2);
  let mode = "tile";
  let argRoot = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--console") mode = "console";
    else if (a === "--json") mode = "json";
    else if (a === "--tile") mode = "tile";
    else if (a === "--root") argRoot = argv[++i];
    else if (a === "-h" || a === "--help") {
      process.stdout.write("sense-runtime-fit.mjs [--tile|--console|--json] [--root <path>]\n");
      process.exit(0);
    } else blind(`unknown flag ${a}`);
  }

  const root = resolveRoot(argRoot);
  if (!root) blind("no .claude/constructs/packs found (consuming repo root unresolved)");

  let s;
  try { s = sense(root); }
  catch (e) { blind(`sense failed: ${String((e && e.message) || e)}`); }
  if (s.blind) blind(s.blind);

  process.stdout.write(tile(s.status, s.signal, s.mismatch) + "\n");
  if (mode === "console") process.stdout.write(renderConsole(s) + "\n");
  else if (mode === "json") process.stdout.write(JSON.stringify(buildJson(s), null, 2) + "\n");
}

main();
