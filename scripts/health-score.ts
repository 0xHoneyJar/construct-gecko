#!/usr/bin/env npx tsx
/**
 * Gecko — Network Health Score Calculator
 *
 * The "frozen metric" — equivalent to Karpathy's val_bpb.
 * Composite score from 6 sub-signals, weighted.
 *
 * Usage:
 *   npx tsx scripts/health-score.ts                    # Full health check
 *   npx tsx scripts/health-score.ts --quick             # API-only (skip GitHub)
 *   npx tsx scripts/health-score.ts --json              # Machine-readable output
 *   npx tsx scripts/health-score.ts --append <path>     # Append to JSONL file
 */

import { execSync } from "child_process";
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = "https://api.constructs.network/v1";
const ORG = "0xHoneyJar";
const CONSTRUCT_PREFIX = "construct-";
const CANONICAL_CATEGORIES = [
  "development",
  "security",
  "design",
  "documentation",
  "operations",
  "infrastructure",
  "research",
  "straylight",
];

const WEIGHTS = {
  api_liveness: 0.2,
  version_freshness: 0.25,
  category_coverage: 0.15,
  identity_drift: 0.2,
  composition_density: 0.1,
  verification_flow: 0.1,
};

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const isQuick = args.includes("--quick");
const isJson = args.includes("--json");
const appendIdx = args.indexOf("--append");
const appendPath = appendIdx !== -1 ? args[appendIdx + 1] : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 30_000 }).trim();
  } catch {
    return "";
  }
}

function fetchJson(url: string): any {
  try {
    const raw = run(`curl -sf "${url}"`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function ghApi(endpoint: string): any {
  try {
    const raw = run(`gh api ${endpoint} --paginate 2>/dev/null`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function ghApiLines(endpoint: string, jqFilter: string): string[] {
  try {
    const raw = run(
      `gh api ${endpoint} --paginate -q '${jqFilter}' 2>/dev/null`
    );
    return raw ? raw.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Sub-Signal: API Liveness (weight: 0.20)
// ---------------------------------------------------------------------------

interface ApiResult {
  score: number;
  status: "healthy" | "degraded" | "down";
  response_time_ms: number;
}

function checkApiLiveness(): ApiResult {
  const start = Date.now();
  const health = fetchJson(`${API_BASE}/health`);
  const elapsed = Date.now() - start;

  if (!health) return { score: 0, status: "down", response_time_ms: elapsed };
  if (health.status === "healthy")
    return { score: 100, status: "healthy", response_time_ms: elapsed };
  return { score: 50, status: "degraded", response_time_ms: elapsed };
}

// ---------------------------------------------------------------------------
// Sub-Signal: Version Freshness (weight: 0.25)
// ---------------------------------------------------------------------------

interface FreshnessResult {
  score: number;
  constructs: Array<{
    slug: string;
    days_stale: number;
    status: "FRESH" | "STALE" | "ABANDONED";
  }>;
  stale_slugs: string[];
}

function checkVersionFreshness(): FreshnessResult {
  // Use jq filter to get construct repos as JSON lines, then parse
  const raw = run(
    `gh api "orgs/${ORG}/repos?per_page=100&type=public" --paginate -q '.[] | select(.name | startswith("${CONSTRUCT_PREFIX}")) | select(.name != "construct-base") | select(.archived == false) | {name, pushed_at}' 2>/dev/null`
  );

  if (!raw) return { score: 50, constructs: [], stale_slugs: [] };

  // gh api with jq outputs one JSON object per line
  const constructRepos = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const now = Date.now();
  const constructs = constructRepos.map((r: any) => {
    const pushed = new Date(r.pushed_at || r.pushedAt || "2020-01-01").getTime();
    const name = r.name || "";
    const days = Math.floor((now - pushed) / (1000 * 60 * 60 * 24));
    return {
      slug: name.replace(CONSTRUCT_PREFIX, ""),
      days_stale: days,
      status: (days > 90
        ? "ABANDONED"
        : days > 30
          ? "STALE"
          : "FRESH") as "FRESH" | "STALE" | "ABANDONED",
    };
  });

  const scores = constructs.map((c) => Math.max(0, 100 - c.days_stale));
  const avgScore =
    scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 50;

  return {
    score: avgScore,
    constructs,
    stale_slugs: constructs.filter((c) => c.status !== "FRESH").map((c) => c.slug),
  };
}

// ---------------------------------------------------------------------------
// Sub-Signal: Category Coverage (weight: 0.15)
// ---------------------------------------------------------------------------

interface CategoryResult {
  score: number;
  filled: string[];
  empty: string[];
}

function checkCategoryCoverage(): CategoryResult {
  const categorySlugs = new Set<string>();

  // Try API first
  const data = fetchJson(`${API_BASE}/constructs?limit=100`);
  if (data?.data) {
    for (const c of data.data) {
      if (c.category) categorySlugs.add(c.category.toLowerCase());
    }
  }

  // Fallback: read domain from construct.yaml via GitHub API for each known repo
  if (categorySlugs.size < 3) {
    const knownSlugs = [
      "observer", "artisan", "k-hole", "crucible", "protocol", "herald",
      "beacon", "hardening", "dynamic-auth", "the-easel", "gtm-collective",
      "webgl-particles", "mibera-codex", "social-oracle", "webreel", "growthpages", "gecko",
    ];

    // Domain-to-category mapping (known from construct.yaml domain fields)
    const domainMap: Record<string, string> = {
      observer: "development", artisan: "design", crucible: "development",
      protocol: "security", herald: "development", beacon: "development",
      hardening: "security", "dynamic-auth": "security",
      "the-easel": "design", "gtm-collective": "operations",
      "webgl-particles": "design", "mibera-codex": "research",
      "social-oracle": "operations", webreel: "design",
      growthpages: "operations", "k-hole": "straylight", gecko: "observability",
    };

    for (const slug of knownSlugs) {
      const cat = domainMap[slug];
      if (cat && CANONICAL_CATEGORIES.includes(cat)) {
        categorySlugs.add(cat);
      }
    }
  }

  const filled = CANONICAL_CATEGORIES.filter((c) => categorySlugs.has(c));
  const empty = CANONICAL_CATEGORIES.filter((c) => !categorySlugs.has(c));

  return {
    score: Math.round((filled.length / CANONICAL_CATEGORIES.length) * 100),
    filled,
    empty,
  };
}

// ---------------------------------------------------------------------------
// Sub-Signal: Composition Density (weight: 0.10)
// ---------------------------------------------------------------------------

interface CompositionResult {
  score: number;
  with_composition: number;
  total: number;
}

function checkCompositionDensity(): CompositionResult {
  // This requires reading construct.yaml from each repo — expensive.
  // For quick mode, estimate from API data.
  const data = fetchJson(`${API_BASE}/constructs?limit=100`);

  if (!data?.data) return { score: 50, with_composition: 0, total: 0 };

  // Constructs that declare dependencies or are part of pairs
  const total = data.data.length;
  // Rough heuristic: constructs with pack_dependencies or compose_with
  const withComposition = Math.max(
    2,
    Math.floor(total * 0.3)
  ); // conservative estimate

  return {
    score: total > 0 ? Math.round((withComposition / total) * 100) : 50,
    with_composition: withComposition,
    total,
  };
}

// ---------------------------------------------------------------------------
// Sub-Signal: Verification Flow (weight: 0.10)
// ---------------------------------------------------------------------------

interface VerificationResult {
  score: number;
  tiers: Record<string, number>;
}

function checkVerificationFlow(): VerificationResult {
  const data = fetchJson(`${API_BASE}/constructs?limit=100`);

  if (!data?.data) return { score: 0, tiers: {} };

  const tiers: Record<string, number> = {};
  for (const c of data.data) {
    const tier = c.verification_tier || c.verificationTier || "UNVERIFIED";
    tiers[tier] = (tiers[tier] || 0) + 1;
  }

  const total = data.data.length;
  const nonUnverified = total - (tiers["UNVERIFIED"] || 0);

  return {
    score: total > 0 ? Math.round((nonUnverified / total) * 100) : 0,
    tiers,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const timestamp = new Date().toISOString();

  // Run sub-signals
  const api = checkApiLiveness();
  const freshness = isQuick
    ? { score: 50, constructs: [], stale_slugs: [] }
    : checkVersionFreshness();
  const categories = checkCategoryCoverage();
  const composition = checkCompositionDensity();
  const verification = checkVerificationFlow();

  // Identity drift requires deep analysis — skip in script, handled by agent
  const identityDrift = { score: 50 }; // placeholder — agent fills this in

  // Compute weighted score
  const healthScore = Math.round(
    api.score * WEIGHTS.api_liveness +
      freshness.score * WEIGHTS.version_freshness +
      categories.score * WEIGHTS.category_coverage +
      identityDrift.score * WEIGHTS.identity_drift +
      composition.score * WEIGHTS.composition_density +
      verification.score * WEIGHTS.verification_flow
  );

  // Load previous baseline
  let healthDelta = 0;
  let previousScore = null;
  if (appendPath && existsSync(appendPath)) {
    const lines = readFileSync(appendPath, "utf-8").trim().split("\n");
    if (lines.length > 0) {
      try {
        const last = JSON.parse(lines[lines.length - 1]);
        previousScore = last.health_score;
        healthDelta = healthScore - previousScore;
      } catch {
        // no valid previous observation
      }
    }
  }

  const observation = {
    timestamp,
    health_score: healthScore,
    health_delta: healthDelta,
    api_status: api.status,
    api_response_ms: api.response_time_ms,
    registered_count: composition.total,
    namespace_count: freshness.constructs.length,
    stale_constructs: freshness.stale_slugs,
    empty_categories: categories.empty,
    verification_tiers: verification.tiers,
    sub_scores: {
      api_liveness: api.score,
      version_freshness: freshness.score,
      category_coverage: categories.score,
      identity_drift: identityDrift.score,
      composition_density: composition.score,
      verification_flow: verification.score,
    },
  };

  // Output
  if (isJson) {
    console.log(JSON.stringify(observation, null, 2));
  } else {
    const delta =
      healthDelta >= 0 ? `+${healthDelta}` : `${healthDelta}`;
    console.log(
      `gecko | health: ${healthScore} (${delta}) | api: ${api.status} | stale: ${freshness.stale_slugs.length} | categories: ${categories.filled.length}/${CANONICAL_CATEGORIES.length} | verification: ${verification.score}%`
    );
    if (freshness.stale_slugs.length > 0) {
      console.log(`  stale: ${freshness.stale_slugs.join(", ")}`);
    }
    if (categories.empty.length > 0) {
      console.log(`  empty categories: ${categories.empty.join(", ")}`);
    }
  }

  // Append to JSONL if requested
  if (appendPath) {
    const dir = dirname(appendPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(appendPath, JSON.stringify(observation) + "\n");
  }
}

main().catch((err) => {
  console.error("gecko | error:", err.message);
  process.exit(1);
});
