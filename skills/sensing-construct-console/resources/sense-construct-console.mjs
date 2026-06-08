#!/usr/bin/env node
// =============================================================================
// sense-construct-console.mjs — GECKO's construct-estate console SENSOR.
// =============================================================================
// Senses the THREE SIDES of the construct estate:
//
//     declared  ↔  governed  ↔  earned
//      (map)        (installed)    (done)
//
// - GOVERNED: walk the consuming repo's .claude/constructs/packs/*/ — the live
//   pack territory (EXCLUDE *.frozen.bak). LOUD on an unreadable OR ABSENT
//   manifest (a pack dir with no readable construct.yaml is a drift signal,
//   not a silent drop).
// - DECLARED: two composition signals from disk + the static index:
//     * intended   — top-level `compose_with:` in each construct.yaml
//     * contracted — `streams.{reads,writes}` overlap (typed-port could-hand-off)
//     * the static .run/construct-index.yaml (the drifted map — phantoms + empty composes_with)
// - EARNED: an append-only ledger grimoires/gecko/observations.jsonl rows with
//   stream_type:"Signal" and outcome:"closed" — co-occurrence of constructs in
//   CLOSED outputs. Does not exist yet → observed = 0 today (cold-start honest).
//
// SENSE-ONLY. Reads only. Grants no authority, adds no gate, mutates no pack.
// Authority(construct, domain) = count of closed rows; 0 ⇒ `authority_unearned`,
// surfaced — never silently honored.
//
// OUTPUT (the contract): the FIRST stdout line is exactly one tile —
//     STATUS|SIGNAL|MISMATCH      STATUS ∈ {ok | drift | blind}
// byte-compatible with estate-coherence.sh's `|`-split into 3 fields. Any raw
// `|` inside SIGNAL/MISMATCH is escaped to a space; C0/C1 control bytes stripped.
//
// FAIL-CLOSED-LOUD: any unreadable root / parse failure → a single `blind|…|—`
// tile. NEVER crash, NEVER emit an empty line, NEVER emit more than 3 fields on
// the tile line.
//
// Usage:
//   sense-construct-console.mjs                 # tile only (default; SessionStart-cheap)
//   sense-construct-console.mjs --console       # tile + Exhibit A + 3-row console (human)
//   sense-construct-console.mjs --json          # tile + structured payload as JSON
//   sense-construct-console.mjs --root <path>   # override the consuming repo root
//
// Env:
//   LOA_CONSOLE_ROOT    consuming repo root (default: cwd, fallback ~/Documents/GitHub/loa-freeside)
//   LOA_CONSOLE_LEDGER  override the earned-ledger path (test seam)
//   LOA_CONSOLE_INDEX   override the .run/construct-index.yaml path (test seam)
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---- tile helpers (delimiter-safe, fail-closed-loud) ------------------------
function sanitizeField(s) {
  // escape raw | to a space; strip C0/C1 control bytes; collapse to one line.
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
  // fail-closed: print exactly one valid 3-field tile and exit non-zero.
  process.stdout.write(tile("blind", reason, "—") + "\n");
  process.exit(3);
}

// ---- a deliberately TINY YAML reader (zero-dep, field-scoped) ----------------
// We do NOT parse arbitrary YAML — we lift only the specific fields the sensor
// needs, tolerant of both inline (`[A, B]`) and block (`- A`) list forms and of
// both `compose_with` shapes (bare-slug list AND {slug, relationship} maps).
// Anything unreadable is reported UNKNOWN — never guessed.
function readManifestFields(text) {
  const lines = text.split(/\r?\n/);
  const out = { compose_with: null, reads: null, writes: null, genome_depth: 0, genome_hash: null };

  // top-level key = column-0, `key:` form.
  const topIdx = (key) =>
    lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));

  // ---- genome chain depth (EARNED authority via clew-merge — bd-uze) ----------
  // genome_depth/genome_hash are additive top-level PROVENANCE (NOT the behavioral
  // interface). Depth = conviction = earned authority; 0 = no genome yet. SHADOW:
  // surfaced here, not yet a routing/gate input.
  const gdAt = topIdx("genome_depth");
  if (gdAt !== -1) {
    const m = lines[gdAt].match(/^genome_depth\s*:\s*(\d+)/);
    if (m) out.genome_depth = parseInt(m[1], 10);
  }
  const ghAt = topIdx("genome_hash");
  if (ghAt !== -1) {
    const m = lines[ghAt].match(/^genome_hash\s*:\s*(sha256:[0-9a-f]{64})/);
    if (m) out.genome_hash = m[1];
  }

  // ---- compose_with (top-level only — author's hand-written intent) ----------
  const cwAt = topIdx("compose_with");
  if (cwAt !== -1) {
    const slugs = [];
    // inline-array on the same line? `compose_with: [a, b]`
    const inline = lines[cwAt].match(/^compose_with\s*:\s*\[(.*)\]\s*$/);
    if (inline) {
      inline[1]
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((x) => slugs.push(stripQuotes(x)));
    } else {
      // block list under it — until the next column-0 key
      for (let i = cwAt + 1; i < lines.length; i++) {
        const l = lines[i];
        if (/^\S/.test(l) && !/^\s*-/.test(l)) break; // next top-level key
        if (/^\s*$/.test(l)) continue;
        // bare-slug item:  `  - observer`  (optional trailing `# comment`)
        let m = l.match(/^\s*-\s+([A-Za-z0-9._-]+)\s*(?:#.*)?$/);
        if (m) { slugs.push(m[1]); continue; }
        // map item with slug:  `  - slug: crucible`
        m = l.match(/^\s*-?\s*slug\s*:\s*([A-Za-z0-9._-]+)/);
        if (m) { slugs.push(m[1]); continue; }
      }
    }
    out.compose_with = slugs;
  }

  // ---- streams.{reads,writes} (contracted typed-port signal) -----------------
  const stAt = topIdx("streams");
  if (stAt !== -1) {
    // find the streams block extent (until next column-0 key)
    let end = lines.length;
    for (let i = stAt + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) { end = i; break; }
    }
    out.reads = liftStreamList(lines, stAt + 1, end, "reads");
    out.writes = liftStreamList(lines, stAt + 1, end, "writes");
  }
  return out;
}

function liftStreamList(lines, from, to, key) {
  // find `  reads:` / `  writes:` inside the streams block
  let kAt = -1, kIndent = 0;
  for (let i = from; i < to; i++) {
    const m = lines[i].match(new RegExp(`^(\\s+)${key}\\s*:(.*)$`));
    if (m) { kAt = i; kIndent = m[1].length; var rest = m[2]; break; }
  }
  if (kAt === -1) return null;
  const inline = lines[kAt].match(new RegExp(`^\\s+${key}\\s*:\\s*\\[(.*)\\]\\s*$`));
  if (inline) {
    return inline[1].split(",").map((x) => stripQuotes(x.trim())).filter(Boolean);
  }
  // block list — items more-indented than the key, until a sibling/parent
  const vals = [];
  for (let i = kAt + 1; i < to; i++) {
    const l = lines[i];
    if (/^\s*$/.test(l)) continue;
    const ind = (l.match(/^(\s*)/)[1] || "").length;
    if (ind <= kIndent && !/^\s*-/.test(l)) break;
    // item form: `- Slug`  with an OPTIONAL trailing `# comment` (common on disk).
    const m = l.match(/^\s*-\s+([A-Za-z0-9._-]+)\s*(?:#.*)?$/);
    if (m) vals.push(m[1]);
  }
  return vals;
}

function stripQuotes(s) {
  return s.replace(/^['"]|['"]$/g, "").trim();
}

// ---- root + path resolution -------------------------------------------------
// An EXPLICIT root (--root or LOA_CONSOLE_ROOT) is honored as-given: if it has
// no packs dir we go blind (loud), NEVER silently substituting a fallback —
// substituting would make the operator think they sensed repo A when they sensed
// repo B. The fallback ONLY applies to the auto-detected (cwd) path.
function resolveRoot(argRoot) {
  const explicit = argRoot || process.env.LOA_CONSOLE_ROOT || null;
  if (explicit) {
    return dirExists(path.join(explicit, ".claude", "constructs", "packs"))
      ? explicit
      : null; // explicit-but-invalid → blind
  }
  const cwd = process.cwd();
  if (dirExists(path.join(cwd, ".claude", "constructs", "packs"))) return cwd;
  const fallback = path.join(os.homedir(), "Documents", "GitHub", "loa-freeside");
  if (dirExists(path.join(fallback, ".claude", "constructs", "packs"))) return fallback;
  return null; // caller goes blind
}
function dirExists(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

// =============================================================================
// SENSE
// =============================================================================
function sense(root) {
  const packsDir = path.join(root, ".claude", "constructs", "packs");
  let entries;
  try {
    entries = fs.readdirSync(packsDir);
  } catch (e) {
    return { blind: `packs dir unreadable (${packsDir})` };
  }

  const live = [];          // {slug, manifestReadable, compose_with, reads, writes}
  const frozen = [];        // slugs of *.frozen.bak
  const unreadableManifests = []; // LOUD: live pack dir whose manifest is absent/unreadable

  for (const name of entries.sort()) {
    const full = path.join(packsDir, name);
    // follow symlinks (packs are symlinks into ~/.loa/constructs/packs)
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isDirectory()) continue;

    if (name.endsWith(".frozen.bak")) { frozen.push(name); continue; }

    const manifest = path.join(full, "construct.yaml");
    if (!fileExists(manifest)) {
      // ABSENT manifest on a LIVE pack — a drift signal, NOT a silent drop.
      unreadableManifests.push(name);
      live.push({ slug: name, manifestReadable: false });
      continue;
    }
    let text;
    try { text = fs.readFileSync(manifest, "utf8"); }
    catch { unreadableManifests.push(name); live.push({ slug: name, manifestReadable: false }); continue; }

    const f = readManifestFields(text);
    live.push({
      slug: name,
      manifestReadable: true,
      compose_with: f.compose_with || [],
      reads: f.reads || [],
      writes: f.writes || [],
      genome_depth: f.genome_depth || 0,
      genome_hash: f.genome_hash || null,
    });
  }

  // ---- DECLARED side: the static index (the drifted map) ---------------------
  const indexPath =
    process.env.LOA_CONSOLE_INDEX ||
    path.join(root, ".run", "construct-index.yaml");
  const index = readIndex(indexPath);

  // ---- EARNED side: the append-only ledger -----------------------------------
  const ledgerPath =
    process.env.LOA_CONSOLE_LEDGER ||
    path.join(root, "grimoires", "gecko", "observations.jsonl");
  const earned = readEarned(ledgerPath);

  // ---- intended composition pairs (from compose_with) ------------------------
  const liveSlugs = new Set(live.map((p) => p.slug));
  const intendedPairs = [];     // {from, to, dangling}
  let intendedCount = 0;        // packs declaring compose_with
  for (const p of live) {
    if (!p.manifestReadable) continue;
    if (Array.isArray(p.compose_with) && p.compose_with.length) {
      intendedCount++;
      for (const to of p.compose_with) {
        intendedPairs.push({ from: p.slug, to, dangling: !liveSlugs.has(to) });
      }
    }
  }

  // ---- contracted pairs (streams.writes ∩ other.reads) -----------------------
  const contractedPairs = [];   // {from, to, via:[stream-types]}
  let contractedCount = 0;      // packs declaring a streams block
  const withStreams = live.filter(
    (p) => p.manifestReadable && (p.reads.length || p.writes.length)
  );
  for (const p of withStreams) contractedCount++;
  for (const a of withStreams) {
    for (const b of withStreams) {
      if (a.slug === b.slug) continue;
      const via = a.writes.filter((w) => b.reads.includes(w));
      if (via.length) contractedPairs.push({ from: a.slug, to: b.slug, via });
    }
  }

  // ---- index drift: phantoms (frozen indexed as live) + unmapped live --------
  const indexedSlugs = new Set(index.constructs.map((c) => c.slug));
  const phantoms = index.constructs
    .map((c) => c.slug)
    .filter((s) => s.endsWith(".frozen.bak")); // a retired pack presented as routable
  const liveNonFrozen = live.map((p) => p.slug);
  const unmapped = liveNonFrozen.filter((s) => !indexedSlugs.has(s));

  // ---- GAP rows: intended-but-not-observed; observed-but-not-intended --------
  const observedPairs = earned.pairs; // [{a,b,count}]
  const intendedKey = new Set(intendedPairs.map((p) => pairKey(p.from, p.to)));
  const intendedUndirected = new Set(
    intendedPairs.map((p) => undirKey(p.from, p.to))
  );
  const deadIntentions = intendedPairs.filter(
    (p) => !observedPairs.some((o) => undirKey(o.a, o.b) === undirKey(p.from, p.to))
  );
  const undeclaredDeps = observedPairs.filter(
    (o) => !intendedUndirected.has(undirKey(o.a, o.b))
  );

  // ---- authority per construct (count of closed rows) ------------------------
  const authority = earned.authority; // {slug: count}
  const authorityUnearned = live
    .filter((p) => !(authority[p.slug] > 0))
    .map((p) => p.slug);

  // ---- GENOME depth: earned authority via clew-merge (bd-uze, SHADOW) ---------
  // A second, independent earned-authority signal (complements the closed-row
  // ledger): genome_depth = count of operator-merged, run-verified clews a
  // construct has absorbed. Surfaced; NOT yet a routing/gate input (shadow-first).
  const withGenome = live
    .filter((p) => p.manifestReadable && p.genome_depth > 0)
    .map((p) => ({ slug: p.slug, depth: p.genome_depth, head: p.genome_hash }))
    .sort((a, b) => b.depth - a.depth);
  const genomeTotalDepth = withGenome.reduce((s, p) => s + p.depth, 0);
  const genomeMaxDepth = withGenome.reduce((m, p) => Math.max(m, p.depth), 0);

  // ---- STATUS classification (the estate's own thresholds) -------------------
  // blind: territory unreadable (handled above by early-return)
  // drift: any phantom OR any unmapped-live OR any unreadable manifest OR
  //        any dangling intended target OR zero earned trail (cold authority).
  let status = "ok";
  const driftReasons = [];
  if (phantoms.length) driftReasons.push(`${phantoms.length} phantom`);
  if (unmapped.length) driftReasons.push(`${unmapped.length} unmapped`);
  if (unreadableManifests.length)
    driftReasons.push(`${unreadableManifests.length} no-manifest`);
  if (earned.rows === 0) driftReasons.push("0 earned");
  if (driftReasons.length) status = "drift";

  const liveCount = live.length;
  const signal =
    `${liveCount} live · ${phantoms.length} phantom · ` +
    `${unmapped.length} unmapped · ${earned.rows} earned`;
  const mismatch = "declared ↔ governed ↔ earned (map ↔ installed ↔ done)";

  return {
    blind: null,
    root, packsDir, indexPath, ledgerPath,
    status, signal, mismatch,
    live, frozen,
    unreadableManifests,
    index,
    phantoms, unmapped,
    intendedPairs, intendedCount,
    contractedPairs, contractedCount,
    earned, observedPairs,
    deadIntentions, undeclaredDeps,
    authority, authorityUnearned,
    withGenome, genomeTotalDepth, genomeMaxDepth,
  };
}

function pairKey(a, b) { return `${a} ${b}`; }
function undirKey(a, b) { return [a, b].sort().join(" "); }

// ---- index reader (tolerant; the index is the DRIFTED map we EXHIBIT) --------
function readIndex(p) {
  const out = { present: false, pack_count: null, constructs: [] };
  if (!fileExists(p)) return out;
  let text;
  try { text = fs.readFileSync(p, "utf8"); } catch { return out; }
  out.present = true;
  const pc = text.match(/^\s*pack_count:\s*(\d+)/m);
  if (pc) out.pack_count = parseInt(pc[1], 10);
  // construct-level slugs are at exactly 2-space indent: `  - slug: <name>`
  const re = /^  - slug:\s*([A-Za-z0-9._-]+)\s*$/gm;
  let m;
  while ((m = re.exec(text)) !== null) out.constructs.push({ slug: m[1] });
  return out;
}

// ---- earned-ledger reader (append-only JSONL; empty today) -------------------
function readEarned(p) {
  const out = { present: false, rows: 0, pairs: [], authority: {} };
  if (!fileExists(p)) return out;
  out.present = true;
  let text;
  try { text = fs.readFileSync(p, "utf8"); } catch { return out; }
  const pairMap = new Map(); // undirKey -> {a,b,count}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { continue; } // tolerate a bad line, never crash
    if (rec.stream_type !== "Signal") continue;
    if (rec.outcome !== "closed") continue;
    out.rows++;
    const c = rec.construct;
    if (c) {
      out.authority[c] = (out.authority[c] || 0) + 1;
      // domain-scoped authority key too
      if (rec.domain) {
        const dk = `${c}:${rec.domain}`;
        out.authority[dk] = (out.authority[dk] || 0) + 1;
      }
    }
    const co = Array.isArray(rec.co_constructs) ? rec.co_constructs : [];
    for (const other of co) {
      if (!c || !other || other === c) continue;
      const k = undirKey(c, other);
      const cur = pairMap.get(k) || { a: c < other ? c : other, b: c < other ? other : c, count: 0 };
      cur.count++;
      pairMap.set(k, cur);
    }
  }
  out.pairs = [...pairMap.values()];
  return out;
}

// =============================================================================
// RENDER
// =============================================================================
function renderConsole(s) {
  const L = [];
  L.push(""); // blank line after the tile

  // ---- EXHIBIT A first --------------------------------------------------------
  L.push("  EXHIBIT A — the live confabulation");
  if (s.phantoms.length) {
    L.push(
      `  .run/construct-index.yaml (pack_count: ${s.index.pack_count}) indexes ` +
      `${s.phantoms.length} retired *.frozen.bak packs AS LIVE routable capabilities:`
    );
    for (const ph of s.phantoms) {
      L.push(`    ☠︎ ${ph}  — a corpse presented as a capability; earns 0; self-evicts from a work-sensing console`);
    }
  } else {
    L.push("  (no frozen packs indexed as live — the map agrees with the territory)");
  }
  L.push("");

  // ---- LOUD: live packs with no readable manifest ----------------------------
  if (s.unreadableManifests.length) {
    L.push(`  ⚠︎ NO MANIFEST (drift signal, NOT a silent drop) — ${s.unreadableManifests.length} pack dir(s):`);
    for (const u of s.unreadableManifests) L.push(`    ⚠︎ ${u}  — a pack dir with no readable construct.yaml`);
    L.push("");
  }

  // ---- the three-row composition console -------------------------------------
  L.push("  COMPOSITION CONSOLE — intended / contracted / observed");
  L.push(`    intended   (compose_with on disk)        : ${s.intendedCount} packs declare · ${s.intendedPairs.length} directed edges`);
  L.push(`    contracted (streams writes∩reads)         : ${s.contractedCount} packs typed · ${s.contractedPairs.length} could-hand-off edges`);
  L.push(`    observed   (earned co-occurrence ledger)  : ${s.earned.rows} closed rows · ${s.observedPairs.length} earned edges`);
  L.push("");

  // a sample of the intended edges (two rows light from disk TODAY)
  const sampleIntended = s.intendedPairs.slice(0, 8);
  if (sampleIntended.length) {
    L.push("  intended edges (sample, from disk):");
    for (const e of sampleIntended) {
      const obs = s.observedPairs.some((o) => undirKey(o.a, o.b) === undirKey(e.from, e.to));
      const dead = !obs;
      const flag = e.dangling
        ? "  ☠︎ DANGLING (target not a live pack)"
        : dead
          ? "  — DEAD INTENTION (intended, never observed)"
          : "  ✓ observed";
      L.push(`    ${e.from} → ${e.to}${flag}`);
    }
    L.push("");
  }

  // a sample of contracted edges
  const sampleContracted = s.contractedPairs.slice(0, 6);
  if (sampleContracted.length) {
    L.push("  contracted edges (sample, typed-port overlap):");
    for (const e of sampleContracted) {
      L.push(`    ${e.from} → ${e.to}  via {${e.via.join(", ")}}`);
    }
    L.push("");
  }

  // ---- the GAP (the highest-value signal) ------------------------------------
  L.push("  THE GAP — the confabulation detector applied to composition");
  L.push(`    dead intentions   (intended, 0 observed)  : ${s.deadIntentions.length}`);
  L.push(`    undeclared deps   (observed, 0 intended)  : ${s.undeclaredDeps.length}`);
  L.push("");

  // ---- earned authority ------------------------------------------------------
  L.push("  EARNED AUTHORITY — authority(construct, domain) = count of closed rows");
  if (s.earned.rows === 0) {
    L.push(`    ledger empty (${s.ledgerPath}) — ${s.authorityUnearned.length}/${s.live.length} live constructs are authority_unearned`);
    L.push("    → authority today is 100% map-granted = 100% confabulation (the disease this cures)");
  } else {
    const top = Object.entries(s.authority)
      .filter(([k]) => !k.includes(":"))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    for (const [k, v] of top) L.push(`    ${k}: ${v} closed`);
    if (s.authorityUnearned.length)
      L.push(`    authority_unearned (0 closed): ${s.authorityUnearned.length} constructs`);
  }
  L.push("");

  // ---- GENOME depth (the second earned-authority signal — bd-uze, shadow) ----
  L.push("  GENOME — earned authority via clew-merge (bd-uze)  [SHADOW: surfaced, not yet routed]");
  if (s.withGenome.length === 0) {
    L.push(`    0/${s.live.length} live constructs carry a genome (depth 0 everywhere)`);
    L.push("    → the clew loop hasn't compounded yet; depth grows only via run-verified --mark-distilled");
  } else {
    L.push(`    ${s.withGenome.length}/${s.live.length} carry a genome · total depth ${s.genomeTotalDepth} · deepest ${s.genomeMaxDepth}`);
    for (const g of s.withGenome.slice(0, 8))
      L.push(`    🧬 ${g.slug}: genome-depth ${g.depth}  (${g.head ? g.head.slice(0, 19) + "…" : "—"})`);
    L.push("    deeper chain = more earned conviction = the lower-risk choice (routing on this is the deferred step)");
  }
  L.push("");
  L.push("  sense-only — grants no authority, adds no gate, mutates no pack. the act-construct grants.");
  return L.join("\n");
}

function buildJson(s) {
  return {
    timestamp: new Date().toISOString(),
    stream_type: "Signal",
    schema_version: "1.0.0",
    estate: "constructs-console",
    status: s.status,
    signal: sanitizeField(s.signal),
    mismatch: sanitizeField(s.mismatch),
    sources: {
      packs_dir: s.packsDir,
      index_path: s.indexPath,
      index_present: s.index.present,
      ledger_path: s.ledgerPath,
      ledger_present: s.earned.present,
    },
    governed: {
      live: s.live.length,
      frozen: s.frozen.length,
      no_manifest: s.unreadableManifests,
    },
    declared: {
      index_pack_count: s.index.pack_count,
      phantoms: s.phantoms,
      unmapped: s.unmapped,
      intended_packs: s.intendedCount,
      intended_edges: s.intendedPairs.length,
      contracted_packs: s.contractedCount,
      contracted_edges: s.contractedPairs.length,
    },
    earned: {
      rows: s.earned.rows,
      edges: s.observedPairs.length,
      authority_unearned: s.authorityUnearned.length,
      genome: {
        with_genome: s.withGenome.length,
        total_depth: s.genomeTotalDepth,
        max_depth: s.genomeMaxDepth,
        routed: false,
      },
    },
    gap: {
      dead_intentions: s.deadIntentions.length,
      undeclared_deps: s.undeclaredDeps.length,
    },
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
    else if (a === "--root") { argRoot = argv[++i]; }
    else if (a === "-h" || a === "--help") {
      process.stdout.write(
        "sense-construct-console.mjs [--tile|--console|--json] [--root <path>]\n"
      );
      process.exit(0);
    } else blind(`unknown flag ${a}`);
  }

  const root = resolveRoot(argRoot);
  if (!root) blind("no .claude/constructs/packs found (consuming repo root unresolved)");

  let s;
  try { s = sense(root); }
  catch (e) { blind(`sense failed: ${String(e && e.message || e)}`); }

  if (s.blind) blind(s.blind);

  // The tile is ALWAYS line 1.
  process.stdout.write(tile(s.status, s.signal, s.mismatch) + "\n");

  if (mode === "console") {
    process.stdout.write(renderConsole(s) + "\n");
  } else if (mode === "json") {
    process.stdout.write(JSON.stringify(buildJson(s), null, 2) + "\n");
  }
}

main();
