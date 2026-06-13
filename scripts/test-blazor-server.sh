#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:?Usage: $0 <profile> [package-version]}"
VERSION="${2:-${PACKAGE_VERSION:-}}"
[[ -n "$VERSION" ]] || { echo "Pass the NuGet package version as argument 2 or PACKAGE_VERSION." >&2; exit 2; }
APP="$ROOT/.work/smoke-$PROFILE"
rm -rf "$APP"
dotnet new blazor -n SmokeApp -o "$APP" --interactivity Server --all-interactive --no-https
dotnet add "$APP/SmokeApp.csproj" package LegacyBlazorJs --version "$VERSION" --source "$ROOT/artifacts/packages"
python3 - "$APP/Components/App.razor" "$PROFILE" <<'PY'
import re, sys
path, profile = sys.argv[1:]
text = open(path).read()
text, count = re.subn(r'<script src=.*?_framework/blazor\.web\.js.*?</script>',
                      f'<script src="_content/LegacyBlazorJs/blazor.web.{profile}.js"></script>', text)
if count != 1:
    raise SystemExit(f'Expected one blazor.web.js script tag, replaced {count}')
open(path, 'w').write(text)
PY
dotnet run --project "$APP/SmokeApp.csproj" --urls http://127.0.0.1:5050 >"$APP/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
for _ in {1..90}; do curl -fsS http://127.0.0.1:5050/ >/dev/null && break; sleep 1; done
if ! curl -fsS http://127.0.0.1:5050/ >/dev/null; then
  cat "$APP/server.log" >&2
  exit 1
fi
PROFILE="$PROFILE" node "$ROOT/tools/SmokeTest/smoke.mjs"
