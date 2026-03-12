#!/usr/bin/env bash
# Post-install hook for construct-gecko
# Ensures grimoires/gecko/ output directory exists in the consumer repo.

set -euo pipefail

GRIMOIRE_DIR="${GECKO_GRIMOIRE_DIR:-grimoires/gecko}"

mkdir -p "$GRIMOIRE_DIR/diagnoses"
mkdir -p "$GRIMOIRE_DIR/reports"

echo "gecko | installed — output directory: $GRIMOIRE_DIR/"
echo "gecko | run /observe for a single health check"
echo "gecko | run /patrol for autonomous observation loop"
