#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAJOR="${1:-${DOTNET_MAJOR:-}}"
TAG="${ASPNETCORE_TAG:-}"
if [[ -z "$TAG" ]]; then
  [[ -n "$MAJOR" ]] || { echo "Usage: $0 <dotnet-major> or set ASPNETCORE_TAG" >&2; exit 2; }
  TAG="$(node "$ROOT/scripts/resolve-version.mjs" "$MAJOR" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).tag))")"
fi
VERSION="${TAG#v}"
SOURCE_DIR="$ROOT/.work/aspnetcore-$TAG"
rm -rf "$SOURCE_DIR"
git clone --depth 1 --branch "$TAG" https://github.com/dotnet/aspnetcore.git "$SOURCE_DIR"
corepack prepare yarn@1.22.22 --activate
# Build the npmproj once so its linked JSInterop and SignalR dependencies exist.
"$SOURCE_DIR/eng/build.sh" --restore --build --configuration Release --projects src/Components/Web.JS/Microsoft.AspNetCore.Components.Web.JS.npmproj
node "$ROOT/scripts/build-variants.mjs" --source-dir "$SOURCE_DIR/src/Components/Web.JS" --output "$ROOT/src/LegacyBlazorJs/wwwroot" --tag "$TAG"
cp "$SOURCE_DIR/LICENSE.txt" "$ROOT/src/LegacyBlazorJs/UPSTREAM-LICENSE.txt"
dotnet pack "$ROOT/src/LegacyBlazorJs/LegacyBlazorJs.csproj" -c Release -p:PackageVersion="$VERSION" -o "$ROOT/artifacts/packages"
