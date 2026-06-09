#!/usr/bin/env python3
"""sensing-deployment-seam — GECKO's 4th eye.

The first three eyes look INSIDE a construct (identity-reality, composition-
authority, runtime-fit). This one looks AT THE SEAM between where the Loa
framework PUTS things (the SoT roots) and where each harness consumer LOOKS
for them. It is the sensor for the deployment-seam class — manifest-numbness,
scattered symlinks, source<->installed lag, ghost constructs — every instance
of "a consumer expects an artifact at a root the producer placed elsewhere,
silently, until a dispatch breaks."

Model (operator decision 2026-06-08): SINGLE GLOBAL SoT. `~/.loa/deployment.yaml`
names the canonical roots once; any consumer reading a DIFFERENT pack root is a
CONFLICT, not a legitimate scope.

Sense-only, same firewall as GECKO's other eyes: it NAMES the mismatch, grants
no authority, mutates nothing. CONFLICT (hard, path-provable) vs SMELL (soft,
taxonomy/judgment). Exit code is the finding count for scripting; it never gates.

Reads the SoT it checks — so it tracks the home automatically and says so when
the manifest is absent (anti-staleness seam: a doctor that doctors its own map).
"""

import json
import os
import re
import sys
from pathlib import Path

HOME = Path.home()
MANIFEST = Path(os.environ.get("LOA_DEPLOYMENT_MANIFEST", str(HOME / ".loa" / "deployment.yaml")))

CANONICAL_DEFAULTS = {
    "packs": "~/.loa/constructs/packs",
    "agents": "~/.claude/agents",
    "template": "~/.claude/templates",
    "compositions": "~/bonfire/construct-compositions/compositions",
}


def _expand(p):
    return Path(os.path.expanduser(str(p)))


def load_roots():
    """SoT roots: manifest > canonical default. Names the source so absence is loud."""
    roots, source = dict(CANONICAL_DEFAULTS), "canonical-default (no manifest)"
    if MANIFEST.is_file():
        try:
            import yaml

            declared = (yaml.safe_load(MANIFEST.read_text()) or {}).get("roots", {}) or {}
            roots.update({k: v for k, v in declared.items() if v})
            source = str(MANIFEST)
        except Exception as exc:  # noqa: BLE001 — a malformed SoT is itself a finding
            source = f"{MANIFEST} (UNREADABLE: {exc})"
    return {k: _expand(v) for k, v in roots.items()}, source


def finding(sev, seam, consumer, expects, actual, evidence):
    return {"severity": sev, "seam": seam, "consumer": consumer,
            "expects": str(expects), "actual": str(actual), "evidence": evidence}


def sense_root_coherence(roots):
    """SEAM-ROOT: every pack-root consumer must read packs_root. Any other root = CONFLICT.
    Band-aid symlinks bridging the divergence = SMELL (they encode the bug, not fix it)."""
    out = []
    packs = roots["packs"]
    if not packs.is_dir():
        out.append(finding("CONFLICT", "root", "SoT packs_root", packs, "MISSING",
                            f"packs_root from {'manifest' if MANIFEST.is_file() else 'default'} does not exist"))
        return out

    # The global registration consumer: does adapter-generator resolve to packs_root?
    ag = HOME / ".claude" / "scripts" / "lib" / "adapter-generator.py"
    if ag.is_file():
        try:
            import importlib.util

            spec = importlib.util.spec_from_file_location("ag_probe", ag)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            resolved = Path(os.path.realpath(getattr(mod, "PACKS_DIR")))
            if resolved != Path(os.path.realpath(packs)):
                out.append(finding("CONFLICT", "root", "adapter-generator.py", packs, resolved,
                                    "global registration reads a pack root != SoT packs_root"))
        except Exception as exc:  # noqa: BLE001
            out.append(finding("SMELL", "root", "adapter-generator.py", packs, f"unprobeable ({exc})",
                               "could not import to confirm its resolved PACKS_DIR"))

    # Band-aid symlinks that bridge the .loa<->.claude divergence (should be retired).
    for link in (HOME / ".claude" / "constructs", HOME / ".claude" / "scripts" / "templates"):
        if link.is_symlink():
            out.append(finding("SMELL", "root", str(link), "(retired)", os.readlink(link),
                               "band-aid symlink bridging divergent roots — encodes the bug; retire once consumers read the SoT"))

    # Other consumers that still hardcode the WRONG global pack root (path-arithmetic from an
    # installed location lands on HOME -> ~/.claude/constructs/packs, which is not packs_root).
    scripts_dir = HOME / ".claude" / "scripts"
    bad = HOME / ".claude" / "constructs" / "packs"
    if scripts_dir.is_dir() and Path(os.path.realpath(packs)) != Path(os.path.realpath(bad)):
        for sh in scripts_dir.rglob("*.sh"):
            if ".bak" in sh.name:
                continue
            try:
                txt = sh.read_text(errors="ignore")
            except OSError:
                continue
            # a LIVE assignment (not a comment) of a pack dir to PROJECT_ROOT/.claude/constructs/packs
            for m in re.finditer(r"^[^#\n]*?([A-Z_]+)=.*\.claude/constructs/packs", txt, re.MULTILINE):
                out.append(finding("CONFLICT", "root", sh.name, packs, "~/.claude/constructs/packs",
                                   f"assigns {m.group(1)} to a non-SoT pack root (line: {m.group(0).strip()[:80]})"))
                break
    return out


def _pack_bundled_skills(yaml_path):
    """(slug, pack-relative-path) for PACK-BUNDLED skills only. Skills whose declared path is
    under .claude/skills (harness-installed, a different scope — e.g. hivemind-os) are NOT
    pack lag and are excluded. Returns None if the yaml is unreadable."""
    try:
        import yaml

        data = yaml.safe_load(Path(yaml_path).read_text()) or {}
    except Exception:  # noqa: BLE001
        return None
    out = []
    for s in data.get("skills") or []:
        if isinstance(s, str):
            out.append((s, f"skills/{s}"))
        elif isinstance(s, dict):
            slug = s.get("slug") or s.get("name") or s.get("id")
            path = s.get("path")
            if not slug:
                continue
            if path and (".claude/" in str(path) or str(path).startswith("/")):
                continue  # harness-installed skill — different scope, not pack-bundled lag
            out.append((slug, path or f"skills/{slug}"))
    return out


def sense_install_lag(roots):
    """SEAM-INSTALL-LAG (the sensing-runtime-fit-not-installed class). Two precise checks,
    pack-bundled scope only: (a) the installed pack must SHIP every pack-bundled skill IT
    declares; (b) the installed pack must not LAG its source repo's pack-bundled skills."""
    out = []
    packs = roots["packs"]
    if not packs.is_dir():
        return out
    gh = HOME / "Documents" / "GitHub"
    for pack in sorted(packs.iterdir()):
        if not pack.is_dir() or pack.name.endswith(".bak"):
            continue
        inst_yaml = pack / "construct.yaml"
        if not inst_yaml.is_file():
            continue
        sdir = pack / "skills"
        inst_dirs = {p.name for p in sdir.iterdir() if p.is_dir()} if sdir.is_dir() else set()

        # (a) installed self-consistency: every pack-bundled skill the installed yaml declares must exist.
        for slug, rel in (_pack_bundled_skills(inst_yaml) or []):
            if not (pack / rel).is_dir():
                out.append(finding("CONFLICT", "install-lag", f"{pack.name}/{slug}", f"pack/{rel}", "absent",
                                   f"installed construct.yaml declares pack-bundled {rel}/ but it is missing"))

        # (b) source -> installed: if a local source repo exists, the installed pack must not lag the
        #     skills the SOURCE declares pack-bundled (how the review caught gecko's 9th skill).
        src_yaml = gh / f"construct-{pack.name}" / "construct.yaml"
        if src_yaml.is_file():
            for slug, _ in (_pack_bundled_skills(src_yaml) or []):
                if slug not in inst_dirs:
                    out.append(finding("CONFLICT", "install-lag", f"{pack.name}/{slug}",
                                       "installed (source ships it)", "absent",
                                       f"source construct-{pack.name} declares pack-bundled '{slug}' but the installed "
                                       f"pack lacks skills/{slug}/ — installed lags source"))
    return out


def load_substrate_constructs():
    """The declared substrate constructs from the SoT manifest (the 'different kind' of
    construct — runtime + deck, not skill-packs)."""
    if not MANIFEST.is_file():
        return []
    try:
        import yaml

        data = yaml.safe_load(MANIFEST.read_text()) or {}
        return data.get("substrate_constructs") or []
    except Exception:  # noqa: BLE001
        return []


def sense_substrate_home(roots, substrates):
    """SEAM-SUBSTRATE-HOME: each declared substrate construct must be INSTALLED at its SoT
    home (substrates/<name>, a real dir). Symlinked to a dev source (the runtime-symlink->
    branch seam) or read from ~/bonfire is the scatter — a CONFLICT."""
    out = []
    sub_root = roots.get("substrates")
    if not sub_root or not substrates:
        return out
    for s in substrates:
        name = s.get("name") if isinstance(s, dict) else s
        if not name:
            continue
        install = sub_root / name
        if install.is_dir() and not install.is_symlink():
            continue  # at its SoT home — good
        where = "absent"
        if install.is_symlink():
            where = f"SYMLINK -> {os.readlink(install)}"
        else:
            for legacy in (HOME / ".loa" / "runtime" / name, HOME / "bonfire" / name, HOME / "Documents" / "GitHub" / name):
                if legacy.exists():
                    tgt = f" -> {os.readlink(legacy)}" if legacy.is_symlink() else ""
                    where = f"at {legacy}{tgt}"
                    break
        out.append(finding("CONFLICT", "substrate-home", name, str(install), where,
                           f"substrate construct not at its SoT home; {where} — re-home to substrates/<name>"))
    return out


def main():
    roots, source = load_roots()
    findings = (sense_root_coherence(roots) + sense_install_lag(roots)
                + sense_substrate_home(roots, load_substrate_constructs()))
    as_json = "--json" in sys.argv
    if as_json:
        print(json.dumps({"sot_source": source, "packs_root": str(roots["packs"]), "findings": findings}, indent=2))
    else:
        c = sum(1 for f in findings if f["severity"] == "CONFLICT")
        s = sum(1 for f in findings if f["severity"] == "SMELL")
        print(f"∴ sensing-deployment-seam  ·  SoT: {source}")
        print(f"  packs_root: {roots['packs']}")
        print(f"  {c} CONFLICT · {s} SMELL\n")
        for f in findings:
            mark = "✗" if f["severity"] == "CONFLICT" else "~"
            print(f"  {mark} [{f['severity']}] {f['seam']}: {f['consumer']}")
            print(f"      expects {f['expects']}  ·  actual {f['actual']}")
            print(f"      {f['evidence']}")
        if not findings:
            print("  (no deployment-seam drift sensed — consumers agree with the SoT)")
    return len(findings)


if __name__ == "__main__":
    sys.exit(main())
