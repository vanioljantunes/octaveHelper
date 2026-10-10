#!/usr/bin/env bash
# Build the JupyterLite + xeus-octave static site, with the MATLAB toolbar
# extension baked in.
#
# Must run on Linux (or WSL). The Octave conda packages contain symlinks
# (bin/mkoctfile, lib/libz.so, bin/python) and Windows refuses to create them
# without elevation, so a native Windows build fails in the solver step.
#
# Usage, from the repo root:
#   bash scripts/build.sh
#   OUT=_preview bash scripts/build.sh
#   SKIP_EXTENSION=1 bash scripts/build.sh    # site only, faster
set -euo pipefail

OUT="${OUT:-_site}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$ROOT/.tools"
HOST="$ROOT/.host"
EXT_NAME="octavehelper-matlab-export"

cd "$ROOT"

export PATH="$HOST/bin:$TOOLS:$PATH"
export MAMBA_ROOT_PREFIX="$ROOT/.mamba"

if [ ! -x "$TOOLS/micromamba" ]; then
  echo "micromamba missing; run bash scripts/bootstrap.sh first" >&2
  exit 1
fi

if [ ! -x "$HOST/bin/python" ]; then
  echo "host python env missing; run bash scripts/bootstrap.sh first" >&2
  exit 1
fi

# 1. The toolbar extension. Built as a federated (prebuilt) extension and
#    dropped into the host env's share/jupyter/labextensions, which is where
#    JupyterLite looks by default.
if [ "${SKIP_EXTENSION:-0}" != "1" ]; then
  echo "== building the $EXT_NAME extension =="
  (
    cd "$ROOT/extension"
    if [ ! -d node_modules ]; then
      "$HOST/bin/npm" install --no-audit --no-fund
    fi
    "$HOST/bin/npx" tsc
    "$HOST/bin/jupyter" labextension build .
  )

  DEST="$HOST/share/jupyter/labextensions/$EXT_NAME"
  mkdir -p "$(dirname "$DEST")"
  rm -rf "$DEST"
  cp -r "$ROOT/labextensions/$EXT_NAME" "$DEST"
  echo "installed to $DEST"
fi

# 2. The site itself, including the ~150MB Octave kernel.
echo "== building the site =="
"$HOST/bin/python" -m jupyterlite_core.app build --output-dir="$OUT"

echo
if [ -d "$OUT/xeus" ]; then
  echo "kernel payload: $(du -sh "$OUT/xeus" | cut -f1)"
else
  echo "NO xeus KERNEL DIR - the environment did not solve" >&2
  exit 1
fi

if [ "${SKIP_EXTENSION:-0}" != "1" ]; then
  if [ -d "$OUT/extensions/$EXT_NAME" ]; then
    echo "toolbar extension: present"
  else
    echo "TOOLBAR EXTENSION MISSING from $OUT/extensions" >&2
    exit 1
  fi
fi

echo "total: $(du -sh "$OUT" | cut -f1)"
echo "files: $(find "$OUT" -type f | wc -l)"
