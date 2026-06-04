#!/usr/bin/env bash
# =============================================================================
# path-friction.sh — the path-friction doctor's read-only sensor.
# =============================================================================
# Senses CROSS-CELL coordination weight from the mutation/audit trail and emits:
#   1) classified cross-cell ACTS (reach-in / over-ceremony / under-ceremony)
#   2) recurring (source-cell → target-cell → task-shape) DESIRE-PATHS (≥2)
#   3) the one-line estate-coherence tile: STATUS|SIGNAL|MISMATCH
#
# The doctrine it implements (do NOT reinvent — see SKILL.md):
#   - the path gradient: L0 write-own · L1 spawn-in-cell · L2 /coord · L3 /compose
#   - reach-in = a write/command whose TARGET cell != the ACTING cell (posture slip)
#   - done-twice-becomes-a-path: a recurring manual cross-cell act → propose a RAIL
#   - DETECTOR-tier: it SURFACES, it never fail-blocks (you can't fail-block a judgment)
#
# It is SENSE-ONLY. Zero act/write/dispatch verbs against any cell's state. The only
# write it MAY do is its OWN gecko grimoire trail (the caller does that, not this script).
#
# Usage:
#   path-friction.sh                      # full report (acts + desire-paths) to stdout
#   path-friction.sh --tile               # ONE coherence tile line: STATUS|SIGNAL|MISMATCH
#   path-friction.sh --json               # machine envelope (acts + desire_paths + tile)
#   path-friction.sh --audit <path>       # additional audit.jsonl to read (repeatable)
#   path-friction.sh --window <days>      # only acts within the last N days (default: all)
#   path-friction.sh --min-recur <n>      # desire-path threshold (default 2 — "done twice")
#
# Env:
#   PATH_FRICTION_AUDITS   colon-separated extra audit paths (same as --audit, repeatable)
#   PATH_FRICTION_WINDOW   default window in days
#
# Inputs (DISCOVERED, grounded — see SKILL.md §"Real input sources"):
#   - .run/audit.jsonl  (mutation-logger.sh + write-mutation-logger.sh): one JSON obj/line.
#       Bash entries:  {ts, tool:"Bash", command, exit_code, cwd, ...}
#       Write/Edit:    {ts, tool:"Write"|"Edit", file_path, cwd, ...}
#     Default audit set mirrors operator-port.sh: loa-freeside + bonfire .run/audit.jsonl.
#
# Fail-closed: any missing/unparseable input → STATUS=blind, never a crash, never a guess.
# =============================================================================
set -uo pipefail

MODE=full
WINDOW="${PATH_FRICTION_WINDOW:-0}"      # 0 = no window (all history)
MIN_RECUR=2                               # "done twice becomes a path"
EXTRA_AUDITS=()
USE_DEFAULTS=1                            # include the default audit hubs

# The default audit set — the SAME hubs operator-port.sh reads (grounded).
DEFAULT_AUDITS=(
  "$HOME/Documents/GitHub/loa-freeside/.run/audit.jsonl"
  "$HOME/bonfire/.run/audit.jsonl"
)

# allow PATH_FRICTION_AUDITS (colon-separated) to add audits
if [[ -n "${PATH_FRICTION_AUDITS:-}" ]]; then
  IFS=':' read -r -a _env_audits <<< "$PATH_FRICTION_AUDITS"
  EXTRA_AUDITS+=("${_env_audits[@]}")
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tile)      MODE=tile;  shift ;;
    --json)      MODE=json;  shift ;;
    --full)      MODE=full;  shift ;;
    --audit)     EXTRA_AUDITS+=("${2:-}"); shift 2 ;;
    --no-default-audits) USE_DEFAULTS=0; shift ;;
    --window)    WINDOW="${2:-0}"; shift 2 ;;
    --min-recur) MIN_RECUR="${2:-2}"; shift 2 ;;
    -h|--help)   sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           echo "[path-friction] unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- emit a fail-closed blind tile (DETECTOR: loud, never silent) ------------
blind() {
  local reason
  reason=$(printf '%s' "${1:-unknown}" | tr '|' ' ' | tr -d '\000-\037')
  case "$MODE" in
    json) printf '{"status":"blind","reason":"%s","acts":[],"desire_paths":[],"tile":"blind|%s|—"}\n' "$reason" "$reason" ;;
    *)    printf 'blind|%s|—\n' "$reason" ;;
  esac
  exit 0   # blind is a VALID surfaced state, not a script error
}

command -v python3 >/dev/null 2>&1 || blind "python3 unavailable"

# assemble the audit set: defaults that exist (unless suppressed) + any extra that exist
AUDITS=()
_SET=()
[[ "$USE_DEFAULTS" == 1 ]] && _SET+=("${DEFAULT_AUDITS[@]}")
_SET+=(${EXTRA_AUDITS[@]+"${EXTRA_AUDITS[@]}"})
for a in ${_SET[@]+"${_SET[@]}"}; do
  [[ -n "$a" && -f "$a" ]] && AUDITS+=("$a")
done
[[ ${#AUDITS[@]} -ge 1 ]] || blind "no audit trail found (.run/audit.jsonl absent)"

# Hand off to python for the JSONL parse + classification. Pure read.
# Args: MODE WINDOW MIN_RECUR <audit...>
python3 - "$MODE" "$WINDOW" "$MIN_RECUR" "${AUDITS[@]}" <<'PY'
import sys, json, os, re, time

mode      = sys.argv[1]
window    = int(sys.argv[2])      # days; 0 = all
min_recur = int(sys.argv[3])
audits    = sys.argv[4:]

now = time.time()
cut = (now - window * 86400) if window > 0 else 0.0

HOME = os.path.expanduser("~")
ROOT = os.path.join(HOME, "Documents", "GitHub")

# non-repo top-level segments under the work roots. These are NOT cells — they are the
# operator's own workspace dirs (bonfire's grimoire, the .run audit dir, scratch, tmp).
# Counting them as "cells" produced phantom desire-paths (e.g. "(unknown)→grimoires") —
# closed here by excluding them from cell_of.
NON_REPO = {"grimoires", ".run", ".beads", ".ck", ".loa", "tmp", "scratch", "node_modules"}

def canon(p):
    """Collapse the bonfire→Documents/GitHub symlink so a path under one alias
    is recognized as the SAME logical cell as the other. This is load-bearing:
    ~/bonfire/loa-freeside IS a symlink to ~/Documents/GitHub/loa-freeside, so a
    cwd under bonfire writing a file_path under Documents/GitHub is NOT a reach-in.
    The bonfire root itself (~/bonfire, no repo segment) is the operator's workspace
    hub, NOT a cell — its own grimoire/.run live there and are excluded by cell_of."""
    if not p:
        return p
    p = p.replace(HOME + "/bonfire/", ROOT + "/")
    p = p.replace("/Users/zksoju/bonfire/", "/Users/zksoju/Documents/GitHub/")
    # case-fold the GitHub root variants seen in the trail (documents/github vs Documents/GitHub)
    p = re.sub(r"/Users/zksoju/documents/github/", "/Users/zksoju/Documents/GitHub/", p, flags=re.I)
    return p

def cell_of(path):
    """The cell (repo) a path belongs to = the first dir segment under the GitHub root.
    Returns the cell NAME, or None if the path is not under a known cell root OR the
    segment is a non-repo workspace dir (grimoires/.run/tmp/…)."""
    cp = canon(path)
    m = re.match(re.escape(ROOT) + r"/([^/]+)", cp)
    if not m:
        # not under the work root (e.g. /tmp, $HOME bare, an unresolved cwd) → not a cell
        return None
    seg = m.group(1)
    if seg in NON_REPO:
        return None
    return seg

def te(s):
    try:
        return time.mktime(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ"))
    except Exception:
        return 0.0

# --- extract cross-cell TARGETS from a Bash command --------------------------
# A Bash act targets ANOTHER cell when it operates on a path outside the acting cell.
# We recognize the two dominant, grounded shapes in the trail:
#   git -C <path> ...      (operate on another repo's git)
#   cd <path> && ...       (switch into another repo to act)
# plus an explicit absolute path argument under the GitHub root.
GITC = re.compile(r"git\s+-C\s+(\S+)")
CDC  = re.compile(r"(?:^|&&|;|\|)\s*cd\s+(~?/[^\s;&|]+)")
ABSP = re.compile(r"(/Users/zksoju/(?:bonfire|Documents/GitHub|documents/github)/[^\s;&|'\"]+)", re.I)

# --- task-shape: classify the VERB of a cross-cell act (for desire-path grouping) ---
# We bucket the command into a coarse task-shape so a recurring (src→tgt→shape) is legible.
def task_shape(cmd):
    c = cmd.lower()
    if re.search(r"\bgit\s+(-c\s+\S+\s+)?(push|commit|merge|rebase|reset|cherry-pick)\b", c):
        return "git-mutate"
    if re.search(r"\bgit\s+(-c\s+\S+\s+)?(worktree|checkout\s+-b|switch\s+-c|branch)\b", c):
        return "git-branch"
    if re.search(r"\bgit\s+(-c\s+\S+\s+)?(status|log|diff|show|fetch|rev-parse|remote)\b", c):
        return "git-inspect"
    if re.search(r"\bgh\s+(pr|issue|api|repo|release|workflow)\b", c):
        return "gh-op"
    if re.search(r"\b(railway|vercel)\b", c):
        return "deploy"
    if re.search(r"\b(npm|pnpm|bun|yarn|npx|tsx|node|python3?|cargo|make)\b", c):
        return "build/run"
    if re.search(r"\b(sed\s+-i|tee|cat\s*>|>>?\s*\S+)\b", c):
        return "file-mutate"
    return "other"

# reversibility / risk heuristic for the WEIGHT-NEEDED inference (cost-of-failure axis).
# We can't read intent; we infer from the verb. Mutating/deploy/gh-write = higher cost.
def needed_weight(shape, n_targets, cmd):
    c = cmd.lower()
    # read-only inspection (git status/log/diff/fetch/rev-parse/remote) is the LIGHTEST act —
    # a cross-cell GLANCE mutates nothing and reverses for free. It never needs coordination,
    # and arguably is fine even direct (it's just looking over the blanket, not reaching through).
    if shape == "git-inspect":
        return "glance"    # L0-read: cost-of-failure ~0, reversible, zero blast-radius
    irreversible = bool(re.search(r"git\s+(-c\s+\S+\s+)?push|--force|-f\b|reset\s+--hard|"
                                  r"gh\s+(pr|release)\s+(create|merge|edit)|railway\s+(up|redeploy)|"
                                  r"vercel\s+(deploy|--prod)|gh\s+api.*--method\s+(POST|PATCH|PUT|DELETE)", c))
    # blast radius: ≥2 distinct target cells in one act → needs coordination (L2)
    multi = n_targets >= 2
    if multi or irreversible or shape in ("deploy", "git-mutate", "gh-op"):
        return "coord"     # L2: coordinator + branch + review-gated PR
    if shape in ("git-branch", "build/run", "file-mutate"):
        return "spawn"     # L1: spawn an agent inside the target cell
    return "spawn"         # default: a cross-cell act still wants at least spawn-in-cell

# weight-USED inference: how the agent ACTUALLY reached the target cell.
# From the audit trail we observe the MECHANISM, not the ceremony label, so this is an
# inference, marked as such. A raw `git -C <other>` / `cd <other>` from a foreign cwd is a
# direct reach-in (L0-against-another-cell — the posture slip). We CANNOT see /coord or
# /compose in the bash trail directly (they leave their own trails elsewhere) → those are
# UNKNOWN from this source and we conservatively label the observed mechanism "reach-in".
def used_weight():
    return "reach-in"   # the only weight observable in THIS source; documented limitation.

# --- walk the trail ----------------------------------------------------------
acts = []                 # classified cross-cell acts
desire = {}               # (src,tgt,shape) -> {count, last_ts, sample, needed}
parse_errors = 0
total_lines = 0
seen = set()              # de-dupe identical (ts,cmd) across overlapping audit files

for a in audits:
    try:
        fh = open(a, errors="replace")
    except Exception:
        continue
    for ln in fh:
        ln = ln.strip()
        if not ln:
            continue
        total_lines += 1
        try:
            o = json.loads(ln)
        except Exception:
            parse_errors += 1
            continue
        ts = o.get("ts", "")
        t  = te(ts)
        if cut and t and t < cut:
            continue
        tool = o.get("tool", "")
        cwd  = o.get("cwd", "")
        # source cell of the acting agent. A cwd at the workspace ROOT (~/bonfire or the
        # GitHub root, no repo segment) means the agent acted UNMOUNTED — from the hub, not
        # from inside any cell. That is itself a posture observation, so we name it "(hub)"
        # rather than discard it: an unmounted agent reaching into a cell is the strongest
        # reach-in shape (no blanket of its own to act within).
        src_cell = cell_of(cwd) or "(hub)"

        targets = set()
        cmd = ""
        if tool == "Bash":
            cmd = o.get("command", "") or ""
            key = (ts, cmd[:200])
            if key in seen:
                continue
            seen.add(key)
            cand = GITC.findall(cmd) + CDC.findall(cmd) + ABSP.findall(cmd)
            for raw in cand:
                raw = raw.replace("~", HOME)
                tc = cell_of(raw)
                if tc and tc != src_cell:
                    targets.add(tc)
        elif tool in ("Write", "Edit"):
            fp = o.get("file_path", "") or ""
            key = (ts, fp)
            if key in seen:
                continue
            seen.add(key)
            tc = cell_of(fp)
            if tc and tc != src_cell:
                targets.add(tc)
            cmd = f"{tool} {fp}"
        else:
            continue

        if not targets:
            continue   # same-cell act (write-own / L0) — the GOOD, silent case

        n_t = len(targets)
        shape = task_shape(cmd) if tool == "Bash" else "file-mutate"
        needed = needed_weight(shape, n_t, cmd)
        used = used_weight()

        # FLAG logic:
        #   inspect        — a cross-cell read-only GLANCE (needed=glance) — NOT a slip, informational
        #   under-ceremony — used reach-in but the act wanted a coordinator (L2) — the RISKY slip
        #   reach-in       — a cross-cell write/branch done direct that wanted spawn-in-cell (L1)
        #   over-ceremony  — used HEAVIER than needed — NOT observable from this source (UNKNOWN)
        if needed == "glance":
            flag = "inspect"          # lightest act; a glance over the blanket, no posture concern
        elif used == "reach-in" and needed == "coord":
            flag = "under-ceremony"   # reached in for something that wanted a coordinator
        else:
            flag = "reach-in"         # posture slip, but light enough that spawn-in-cell is the fix

        for tgt in sorted(targets):
            acts.append({
                "ts": ts, "src": src_cell, "tgt": tgt, "shape": shape,
                "used": used, "needed": needed, "flag": flag,
                "sample": cmd[:160],
            })
            # desire-paths only accumulate ACTING patterns (writes/branches/mutations) — a
            # recurring read-only GLANCE is observability, not a rail that wants to exist, so
            # inspect-flagged acts are excluded from the rails proposal.
            if flag == "inspect":
                continue
            k = (src_cell, tgt, shape)
            d = desire.setdefault(k, {"count": 0, "last_ts": "", "sample": cmd[:160], "needed": needed})
            d["count"] += 1
            if ts > d["last_ts"]:
                d["last_ts"] = ts
            # escalate needed to the heaviest seen for this pattern
            if needed == "coord":
                d["needed"] = "coord"

# --- desire-paths: recurring (src→tgt→shape) ≥ min_recur ---------------------
desire_paths = []
for (src, tgt, shape), d in desire.items():
    if d["count"] >= min_recur:
        desire_paths.append({
            "src": src, "tgt": tgt, "shape": shape,
            "count": d["count"], "last_ts": d["last_ts"],
            "needed": d["needed"], "sample": d["sample"],
        })
desire_paths.sort(key=lambda x: (-x["count"], x["src"], x["tgt"]))

n_acts = len(acts)
n_inspect = sum(1 for a in acts if a["flag"] == "inspect")
n_reachin = sum(1 for a in acts if a["flag"] == "reach-in")
n_under = sum(1 for a in acts if a["flag"] == "under-ceremony")
# acts that actually MUTATE another cell (the posture-relevant subset; glances excluded)
n_acting = n_reachin + n_under
n_paths = len(desire_paths)

# --- STATUS classification (DETECTOR thresholds — surface, never block) ------
# ok   : no recurring desire-paths AND no under-ceremony slips (clean coordination)
# drift: a rail wants to exist (≥1 desire-path) OR ≥1 under-ceremony (a risky reach-in)
# blind: handled above (no parseable input)
status = "ok"
if n_paths > 0 or n_under > 0:
    status = "drift"

# top desire-path for the signal phrase
top = desire_paths[0] if desire_paths else None
top_str = (f"{top['src']}→{top['tgt']}/{top['shape']} ×{top['count']}" if top else "none")

signal = f"{n_acting} cross-cell mutates · {n_reachin} reach-in · {n_under} under-ceremony · {n_inspect} glance · {n_paths} desire-paths (top: {top_str})"
mismatch = "path-used ↔ path-needed (lightest-that-fits ↔ mounted-posture)"

# delimiter-safety: tile must split into exactly 3 fields
def desc(s): return s.replace("|", " ").replace("\n", " ")
tile = f"{status}|{desc(signal)}|{desc(mismatch)}"

if mode == "tile":
    print(tile)
    sys.exit(0)

if mode == "json":
    print(json.dumps({
        "status": status,
        "scanned_lines": total_lines,
        "parse_errors": parse_errors,
        "window_days": window,
        "min_recur": min_recur,
        "counts": {"acts": n_acts, "mutates": n_acting, "reach_in": n_reachin,
                   "under_ceremony": n_under, "glance": n_inspect, "desire_paths": n_paths},
        "acts": acts[:500],
        "desire_paths": desire_paths,
        "tile": tile,
    }))
    sys.exit(0)

# --- full human report -------------------------------------------------------
print(f"path-friction | {tile}")
print()
if parse_errors:
    print(f"  (scanned {total_lines} lines, {parse_errors} unparseable — read-only)")
print(f"  cross-cell mutates: {n_acting}  ·  reach-in: {n_reachin}  ·  under-ceremony: {n_under}"
      f"  ·  glances (informational): {n_inspect}")
print()
if desire_paths:
    print("desire-paths (recurring src→tgt→shape ≥ %d — rails that want to exist):" % min_recur)
    print()
    print("  count  src → tgt  ·  shape            needs   last seen")
    print("  -----  --------------------------------  ------  ----------")
    for p in desire_paths[:25]:
        date = (p["last_ts"][:10] if p["last_ts"] else "?")
        line = f"  {p['count']:5d}  {p['src']} → {p['tgt']} · {p['shape']}"
        line = f"{line:<46s}  {p['needed']:<6s}  {date}"
        print(line)
    print()
    print("  each row ≥ %d is a candidate RAIL. clew it (one per invocation, operator's eye):" % min_recur)
    for p in desire_paths[:5]:
        print(f"  >>clew@gecko/sensing-path-friction: pave {p['src']}→{p['tgt']}/{p['shape']} "
              f"(×{p['count']}, wants {p['needed']}) as a composable rail")
else:
    print("no recurring cross-cell desire-paths. coordination is clean (silence is the good state).")
PY
