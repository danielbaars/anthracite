#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
output=${1:-release}
mkdir -p "$output"
bun=${BUN:-bun}
while read -r target asset; do
  "$bun" build --compile "--target=$target" apps/cli/dist/src/index.js --outfile "$output/$asset"
done <<'TARGETS'
bun-darwin-arm64 an-macos-arm64
bun-darwin-x64 an-macos-x64
bun-linux-x64 an-linux-x64
TARGETS
cp LICENSE CREDITS.md "$output/"
(cd "$output" && shasum -a 256 an-macos-arm64 an-macos-x64 an-linux-x64 LICENSE CREDITS.md > SHA256SUMS)
