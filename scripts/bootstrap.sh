#!/usr/bin/env bash
# One-time setup for building this repo. Linux or WSL only; see scripts/build.sh
# for why Windows cannot run the build.
#
# Creates, all inside the repo and all gitignored:
#   .tools/micromamba   the solver that fetches the emscripten-wasm32 packages
#   .host/              a python env holding jupyterlite-core + jupyterlite-xeus
#   .mamba/             micromamba's package cache
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$ROOT/.tools"
HOST="$ROOT/.host"

cd "$ROOT"
mkdir -p "$TOOLS"

export MAMBA_ROOT_PREFIX="$ROOT/.mamba"

if [ ! -x "$TOOLS/micromamba" ]; then
  echo "fetching micromamba"
  curl -fsSL -o "$TOOLS/micromamba.tar.bz2" https://micro.mamba.pm/api/micromamba/linux-64/latest
  tar -xj -C "$TOOLS" --strip-components=1 -f "$TOOLS/micromamba.tar.bz2" bin/micromamba
  rm -f "$TOOLS/micromamba.tar.bz2"
  chmod +x "$TOOLS/micromamba"
fi
"$TOOLS/micromamba" --version

if [ ! -x "$HOST/bin/python" ]; then
  echo "creating host python env"
  "$TOOLS/micromamba" create -y -q -p "$HOST" -c conda-forge python=3.12 pip
fi

echo "installing jupyterlite"
"$HOST/bin/python" -m pip install --quiet --upgrade pip
"$HOST/bin/python" -m pip install --quiet jupyterlite-core jupyterlite-xeus

"$HOST/bin/python" -m pip list 2>/dev/null | grep -iE "jupyterlite|empack"
echo "bootstrap done; now run: bash scripts/build.sh"
