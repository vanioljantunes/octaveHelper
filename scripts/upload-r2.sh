#!/usr/bin/env bash
# Push the heavy kernel assets to Cloudflare R2.
#
# Why: the Vercel account is Hobby, which caps a static deployment at 100MB,
# and the Octave package alone is 102MB. R2 charges nothing for egress, so the
# large files live there and Vercel serves only the small app shell.
# vercel.json 308-redirects these asset paths, the browser follows the redirect
# to R2, and those bytes never touch Vercel's bandwidth allowance.
#
# Every path uploaded here must be matched by a redirect in vercel.json. If the
# two drift, the kernel 404s and nothing runs.
#
# Needs, in the environment and never on the command line:
#   R2_ACCOUNT_ID          Cloudflare account id
#   R2_BUCKET              bucket name
#   AWS_ACCESS_KEY_ID      R2 access key id
#   AWS_SECRET_ACCESS_KEY  R2 secret
#
# Usage: bash scripts/upload-r2.sh [site-dir]
set -euo pipefail

SITE="${1:-_site}"
: "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID}"
: "${R2_BUCKET:?set R2_BUCKET}"
: "${AWS_ACCESS_KEY_ID:?set AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?set AWS_SECRET_ACCESS_KEY}"

ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found. It speaks R2's S3 API and ships on GitHub's ubuntu runners." >&2
  exit 1
fi

if [ ! -d "$SITE/xeus" ]; then
  echo "$SITE/xeus missing; run bash scripts/build.sh first" >&2
  exit 1
fi

# Every package filename carries its version and build string, so these objects
# never change under a given name and can be cached hard.
CACHE="public, max-age=31536000, immutable"

echo "-> xeus/octave/kernel_packages"
aws s3 sync "$SITE/xeus/octave/kernel_packages" "s3://${R2_BUCKET}/xeus/octave/kernel_packages" \
  --endpoint-url "$ENDPOINT" \
  --cache-control "$CACHE" \
  --content-type "application/gzip" \
  --no-progress \
  --delete

# The wasm binary is 38MB and is fetched on every cold start, so it goes too.
if [ -d "$SITE/xeus/octave/bin" ]; then
  echo "-> xeus/octave/bin (wasm only)"
  aws s3 sync "$SITE/xeus/octave/bin" "s3://${R2_BUCKET}/xeus/octave/bin" \
    --endpoint-url "$ENDPOINT" \
    --cache-control "$CACHE" \
    --content-type "application/wasm" \
    --exclude "*" --include "*.wasm" \
    --no-progress
fi

echo
echo "uploaded. Full local payload: $(du -sh "$SITE" | cut -f1)"
