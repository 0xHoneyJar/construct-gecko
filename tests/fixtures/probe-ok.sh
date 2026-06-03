#!/usr/bin/env bash
# A stand-in estate doctor for tests. Prints a recall-shaped JSON receipt, OR a
# raw tile line if asked. It emits a pipe in its output so the tile-escape test
# has something to escape. Read-only; harmless.
set -euo pipefail
case "${1:-}" in
  --json) printf '{"mode":{"default":"query","ok":true},"coverage":{"indexed":142,"phantoms":[]},"unstamped_recent":[],"freshness_min":10}\n' ;;
  *)      printf 'ok|mode=query · 0 unstamped | 0 phantom · 142 cols|indexed ↔ surfaced\n' ;;
esac
