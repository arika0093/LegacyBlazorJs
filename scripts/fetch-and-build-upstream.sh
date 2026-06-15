#!/usr/bin/env bash
set -euo pipefail

# Resolve repository root so the script can be invoked from any working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAJOR="${1:-${DOTNET_MAJOR:-}}"
TAG="${2:-${ASPNETCORE_TAG:-}}"
NODE_BIN="${3:-${NODE_BIN:-node}}"
BUILD_PROFILES="${4:-${BUILD_TARGET_PROFILES:-}}"

# Run a command up to N times, waiting between failures, to survive transient network errors.
retry() {
  local max_attempts="$1"
  local delay="$2"
  shift 2
  local attempt=1
  while true; do
    if "$@"; then
      return 0
    fi
    if [[ "$attempt" -ge "$max_attempts" ]]; then
      echo "Command failed after $max_attempts attempt(s): $*" >&2
      return 1
    fi
    echo "Attempt $attempt/$max_attempts failed; retrying in ${delay}s..." >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

# Upstream scripts expect a plain 'node' on PATH. If the selected Node binary
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
UPSTREAM_MAJOR="${VERSION%%.*}"
TARGET_FRAMEWORK="net${UPSTREAM_MAJOR}.0"
mkdir -p "$ROOT/.work"
DIST_DIR="$ROOT/dist/$TAG"
PACKAGE_WWWROOT="$ROOT/src/LegacyBlazorJs/wwwroot"
SOURCE_DIR="$ROOT/.work/aspnetcore-$TAG"
if [[ -d "$SOURCE_DIR/.git" ]]; then
  pushd "$SOURCE_DIR" >/dev/null
  git fetch --depth 1 origin "$TAG"
  git checkout --detach FETCH_HEAD
  popd >/dev/null
else
  rm -rf "$SOURCE_DIR"
  git clone --depth 1 --branch "$TAG" -- https://github.com/dotnet/aspnetcore.git "$SOURCE_DIR"
fi

# ASP.NET Core 9+ uses npm workspaces; earlier versions use Yarn v1 with package links.
if [[ -f "$SOURCE_DIR/package-lock.json" ]] || [[ -f "$SOURCE_DIR/package.json" && -n "$("$NODE_BIN" -e "const fs=require('fs');try{const p=JSON.parse(fs.readFileSync('$SOURCE_DIR/package.json','utf8'));console.log(Array.isArray(p.workspaces)&&p.workspaces.length>0?'workspaces':'')}catch{}")" ]]; then
  USE_NPM_WORKSPACES=1
else
  USE_NPM_WORKSPACES=0
fi

if [[ "$USE_NPM_WORKSPACES" -eq 1 ]]; then
  pushd "$SOURCE_DIR" >/dev/null
  # ASP.NET Core 9+ ships an older tslib that does not include helpers like __spreadArray used for ES5 down-leveling.
  # Force a newer tslib across the workspace before installing.
  "$NODE_BIN" "$ROOT/scripts/patch-tslib-override.mjs" "$SOURCE_DIR/package.json"
  retry 3 15 npm install --ignore-scripts
  # Build the shared packages referenced by Web.JS. The Web.JS build itself is handled by build-variants.mjs.
  npm run build --workspace=src/JSInterop/Microsoft.JSInterop.JS/src
  npm run build --workspace=src/SignalR/clients/ts/signalr
  npm run build --workspace=src/SignalR/clients/ts/signalr-protocol-msgpack
  popd >/dev/null
else
  corepack prepare yarn@1.22.22 --activate

  run_yarn_build() {
    local project_dir="$1"
    local build_script="${2:-build}"
    pushd "$project_dir" >/dev/null
    retry 3 15 yarn install --mutex network --frozen-lockfile --ignore-engines
    yarn run "$build_script"
    local exit_code=$?
    popd >/dev/null
    return $exit_code
  }

  # Build only the linked JavaScript packages instead of restoring the full ASP.NET Core engineering toolset.
  run_yarn_build "$SOURCE_DIR/src/JSInterop/Microsoft.JSInterop.JS/src" build
  pushd "$SOURCE_DIR/src/SignalR/clients/ts/common" >/dev/null
  retry 3 15 yarn install --mutex network --frozen-lockfile --ignore-engines
  popd >/dev/null
  run_yarn_build "$SOURCE_DIR/src/SignalR/clients/ts/signalr" build
  run_yarn_build "$SOURCE_DIR/src/SignalR/clients/ts/signalr-protocol-msgpack" build
fi

# Generate one JS variant per target profile and copy the outputs into the package wwwroot.
BUILD_TARGET_PROFILES="$BUILD_PROFILES" "$NODE_BIN" "$ROOT/scripts/build-variants.mjs" --source-dir "$SOURCE_DIR/src/Components/Web.JS" --output "$DIST_DIR" --tag "$TAG"
rm -rf "$PACKAGE_WWWROOT"
mkdir -p "$PACKAGE_WWWROOT"
cp -R "$DIST_DIR"/. "$PACKAGE_WWWROOT"/
cp "$SOURCE_DIR/LICENSE.txt" "$ROOT/src/LegacyBlazorJs/UPSTREAM-LICENSE.txt"

# Pack the Razor class library with the upstream version and its matching target framework.
dotnet pack "$ROOT/src/LegacyBlazorJs/LegacyBlazorJs.csproj" -c Release \
  -p:PackageVersion="$VERSION" \
  -p:LegacyBlazorTargetFramework="$TARGET_FRAMEWORK" \
  -o "$ROOT/artifacts/packages"
