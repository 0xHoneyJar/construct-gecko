#!/usr/bin/env node
// GECKO wrapper — resolves sonar-api substrate and delegates (sense-only).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function resolveSonarRoot() {
  const env = process.env.SONAR_API_ROOT?.trim();
  if (env && existsSync(join(env, "scripts/belt-progress.mjs"))) return env;
  const sibling = join(homedir(), "Documents/GitHub/sonar-api");
  if (existsSync(join(sibling, "scripts/belt-progress.mjs"))) return sibling;
  return null;
}

const root = resolveSonarRoot();
if (!root) {
  process.stdout.write(
    "blind|0 chains · sonar-api substrate missing|set SONAR_API_ROOT to sonar-api checkout\n",
  );
  process.exit(3);
}

const substrate = join(root, "scripts/belt-progress.mjs");
const argv = process.argv.slice(2);
const flags = new Set(argv);

let args;
if (flags.has("--sample")) {
  args = ["sample", "--samples", "2", "--interval", "15", "--json"];
} else if (flags.has("--console")) {
  args = ["--robot-triage"];
} else if (flags.has("--json")) {
  const tile = spawnSync(process.execPath, [substrate, "--tile"], {
    encoding: "utf8",
    cwd: root,
    env: process.env,
  });
  process.stdout.write(tile.stdout || "");
  if (tile.status === 3) process.exit(3);
  const triage = spawnSync(process.execPath, [substrate, "--robot-triage", "--json"], {
    encoding: "utf8",
    cwd: root,
    env: process.env,
  });
  process.stdout.write(triage.stdout || "");
  process.exit(triage.status ?? 0);
} else {
  args = ["--tile"];
}

const result = spawnSync(process.execPath, [substrate, ...args], {
  encoding: "utf8",
  cwd: root,
  env: process.env,
});
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
process.exit(result.status ?? 0);
