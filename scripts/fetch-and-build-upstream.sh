#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAJOR="${1:-${DOTNET_MAJOR:-}}"
TAG="${2:-${ASPNETCORE_TAG:-}}"
NODE_BIN="${3:-${NODE_BIN:-node}}"
NODE_WRAPPER_DIR="${HOME}/.local/bin"
mkdir -p "$NODE_WRAPPER_DIR"
cat > "$NODE_WRAPPER_DIR/node" <<EOF
#!/usr/bin/env bash
exec "$NODE_BIN" "\$@"
EOF
chmod +x "$NODE_WRAPPER_DIR/node"
export PATH="$NODE_WRAPPER_DIR:$PATH"

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
trap 'rm -rf "$SOURCE_DIR" >/dev/null 2>&1 || true' EXIT
git clone --depth 1 --branch "$TAG" https://github.com/dotnet/aspnetcore.git "$SOURCE_DIR"
cmd.exe /c "corepack prepare yarn@1.22.22 --activate"

run_yarn_build() {
  local project_dir="$1"
  local build_script="${2:-build}"
  pushd "$project_dir" >/dev/null
  yarn install --mutex network --frozen-lockfile || yarn install --mutex network --frozen-lockfile
  yarn run "$build_script"
  popd >/dev/null
}

# Build the linked JavaScript packages directly instead of restoring the full ASP.NET Core engineering toolset.
run_yarn_build "$SOURCE_DIR/src/JSInterop/Microsoft.JSInterop.JS/src" build
pushd "$SOURCE_DIR/src/SignalR/clients/ts/common" >/dev/null
yarn install --mutex network --frozen-lockfile || yarn install --mutex network --frozen-lockfile
popd >/dev/null
run_yarn_build "$SOURCE_DIR/src/SignalR/clients/ts/signalr" build
run_yarn_build "$SOURCE_DIR/src/SignalR/clients/ts/signalr-protocol-msgpack" build
"$NODE_BIN" "$ROOT/scripts/build-variants.mjs" --source-dir "$SOURCE_DIR/src/Components/Web.JS" --output "$DIST_DIR" --tag "$TAG"
rm -rf "$PACKAGE_WWWROOT"
mkdir -p "$PACKAGE_WWWROOT"
cp -R "$DIST_DIR"/. "$PACKAGE_WWWROOT"/
cp "$SOURCE_DIR/LICENSE.txt" "$ROOT/src/LegacyBlazorJs/UPSTREAM-LICENSE.txt"
dotnet pack "$ROOT/src/LegacyBlazorJs/LegacyBlazorJs.csproj" -c Release -p:PackageVersion="$VERSION" -o "$ROOT/artifacts/packages"
