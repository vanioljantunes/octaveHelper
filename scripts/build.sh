#!/usr/bin/env bash
# Build the JupyterLite + xeus-octave static site.
#
# Must run on Linux (or WSL). The Octave conda packages contain symlinks
# (bin/mkoctfile, lib/libz.so, bin/python) and Windows refuses to create them
# without elevation, so a native Windows build fails in the solver step.
#
# Usage, from the repo root:
#   bash scripts/build.sh
#   OUT=_preview bash scripts/build.sh
set -euo pipefail

OUT="${OUT:-_site}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$ROOT/.tools"
HOST="$ROOT/.host"

cd "$ROOT"

export PATH="$TOOLS:$PATH"
export MAMBA_ROOT_PREFIX="$ROOT/.mamba"

if [ ! -x "$TOOLS/micromamba" ]; then
  echo "micromamba missing; run bash scripts/bootstrap.sh first" >&2
  exit 1
fi

if [ ! -x "$HOST/bin/python" ]; then
  echo "host python env missing; run bash scripts/bootstrap.sh first" >&2
  exit 1
fi

"$HOST/bin/python" -m jupyterlite_core.app build --output-dir="$OUT"

echo
if [ -d "$OUT/xeus" ]; then
  echo "kernel payload: $(du -sh "$OUT/xeus" | cut -f1)"
else
  echo "NO xeus KERNEL DIR - the environment did not solve" >&2
  exit 1
fi
echo "total: $(du -sh "$OUT" | cut -f1)"
