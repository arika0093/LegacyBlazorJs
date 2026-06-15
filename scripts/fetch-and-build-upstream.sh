#!/usr/bin/env bash
set -euo pipefail

# Resolve repository root so the script can be invoked from any working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAJOR="${1:-${DOTNET_MAJOR:-}}"
TAG="${2:-${ASPNETCORE_TAG:-}}"
NODE_BIN="${3:-${NODE_BIN:-node}}"

# Upstream yarn scripts expect a plain 'node' on PATH. If the selected Node binary
# is not already the one that would be resolved, create a tiny wrapper so downstream
# tools find it (useful on WSL/Windows).
CURRENT_NODE="$(command -v node || true)"
if [[ "$CURRENT_NODE" != "$NODE_BIN" ]]; then
  NODE_WRAPPER_DIR="${HOME}/.local/bin"
  mkdir -p "$NODE_WRAPPER_DIR"
  cat > "$NODE_WRAPPER_DIR/node" <<EOF
#!/usr/bin/env bash
exec "$NODE_BIN" "\$@"
EOF
  chmod +x "$NODE_WRAPPER_DIR/node"
  export PATH="$NODE_WRAPPER_DIR:$PATH"
fi

# The orchestrator normally resolves tags up front, but this script still supports direct major builds.
if [[ -z "$TAG" ]]; then
  [[ -n "$MAJOR" ]] || { echo "Usage: $0 <dotnet-major> or set ASPNETCORE_TAG" >&2; exit 2; }
  TAG="$("$NODE_BIN" "$ROOT/scripts/resolve-version.mjs" "$MAJOR" | "$NODE_BIN" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).tag))")"
fi
VERSION="${TAG#v}"
mkdir -p "$ROOT/.work"
DIST_DIR="$ROOT/dist/$TAG"
PACKAGE_WWWROOT="$ROOT/src/LegacyBlazorJs/wwwroot"
SOURCE_DIR="$(mktemp -d "$ROOT/.work/aspnetcore-$TAG.XXXXXX")"
# disable cleanup
# trap 'rm -rf "$SOURCE_DIR" >/dev/null 2>&1 || true' EXIT
git clone --depth 1 --branch "$TAG" -- https://github.com/dotnet/aspnetcore.git "$SOURCE_DIR"
corepack prepare yarn@1.22.22 --activate

run_yarn_build() {
  local project_dir="$1"
  local build_script="${2:-build}"
  pushd "$project_dir" >/dev/null
  yarn install --mutex network --frozen-lockfile --ignore-engines || yarn install --mutex network --frozen-lockfile --ignore-engines
  yarn run "$build_script"
  local exit_code=$?
  popd >/dev/null
  return $exit_code
}

# Build only the linked JavaScript packages instead of restoring the full ASP.NET Core engineering toolset.
run_yarn_build "$SOURCE_DIR/src/JSInterop/Microsoft.JSInterop.JS/src" build
pushd "$SOURCE_DIR/src/SignalR/clients/ts/common" >/dev/null
yarn install --mutex network --frozen-lockfile --ignore-engines || yarn install --mutex network --frozen-lockfile --ignore-engines
popd >/dev/null
run_yarn_build "$SOURCE_DIR/src/SignalR/clients/ts/signalr" build
run_yarn_build "$SOURCE_DIR/src/SignalR/clients/ts/signalr-protocol-msgpack" build

# Generate one JS variant per target profile and copy the outputs into the package wwwroot.
"$NODE_BIN" "$ROOT/scripts/build-variants.mjs" --source-dir "$SOURCE_DIR/src/Components/Web.JS" --output "$DIST_DIR" --tag "$TAG"
rm -rf "$PACKAGE_WWWROOT"
mkdir -p "$PACKAGE_WWWROOT"
cp -R "$DIST_DIR"/. "$PACKAGE_WWWROOT"/
cp "$SOURCE_DIR/LICENSE.txt" "$ROOT/src/LegacyBlazorJs/UPSTREAM-LICENSE.txt"

# Pack the Razor class library as a NuGet package with the upstream version.
dotnet pack "$ROOT/src/LegacyBlazorJs/LegacyBlazorJs.csproj" -c Release -p:PackageVersion="$VERSION" -o "$ROOT/artifacts/packages"
