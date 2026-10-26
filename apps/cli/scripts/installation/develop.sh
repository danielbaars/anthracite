#!/bin/sh
set -eu
cd "$(dirname "$0")/../../../.."
node .yarn/releases/yarn-3.2.1.cjs turbo run build
version="$(node -p "require('./apps/cli/package.json').version")-dev.$(date -u +%Y%m%d%H%M%S)"
node -e 'const fs=require("fs");const p="apps/cli/dist/package.json";const d=JSON.parse(fs.readFileSync(p));d.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(d));' "$version"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
case "$(uname -s)-$(uname -m)" in
 Darwin-arm64) asset=an-macos-arm64;; Darwin-x86_64) asset=an-macos-x64;; Linux-x86_64) asset=an-linux-x64;; *) exit 1;;
esac
"${BUN:-bun}" build --compile apps/cli/dist/src/index.js --outfile "$stage/$asset"
cp LICENSE CREDITS.md "$stage/"
(cd "$stage" && shasum -a 256 "$asset" LICENSE CREDITS.md > SHA256SUMS)
ANTHRACITE_RELEASE_DIR="$stage" sh scripts/install.sh "$version"
