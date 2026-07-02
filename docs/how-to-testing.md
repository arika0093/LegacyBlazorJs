# How to Build and Testing
## Prerequire
The following are required:

* Latest .NET SDK
* Node.js version 20 or later

Also, since it uses the GitHub API internally, it is recommended to output `GITHUB_TOKEN` as an environment variable.

## Build
The quickest way is to set a few environment variables and then run the build.

```bash
# only ES5 and current .NET
# enable SignalR logging, disable minify 
export BUILD_TARGET_PROFILES=es5
export BUILD_CHANNEL=current
export SIGNALR_LOGGING=Trace
export LEGACY_BLAZOR_DISABLE_TERSER=true
node src/build/index.mjs
# Disabling pre-builds can further speed things up (from the second time onwards).
export SKIP_PREBUILD=true
```

On Windows PowerShell, use the equivalent syntax:

```powershell
$env:BUILD_TARGET_PROFILES = "es5"
$env:BUILD_CHANNEL = "current"
$env:SIGNALR_LOGGING = "Trace"
$env:LEGACY_BLAZOR_DISABLE_TERSER = "true"
$env:SKIP_PREBUILD = "true"
node src/build/index.mjs
```

For the common ES5 debug build, `npm run build:quick` now works on Windows as well.

Upon successful build, Javascript files will be generated in the following locations:
* `dist/v(packageVersion)`
* `dotnet/src/LegacyBlazorJs/wwwroot`

## Testing
The quickest way is to create a Blazor Server app template and load the generated JS file using the `<script>` tag.  
Open this in the browser you want to test and perform the necessary functionality checks.

### Browser setup
Although there are many limitations, methods for testing functionality remain available for IE and Chrome as of 2026.

#### For IE

Open Edge, go to "Settings" → "Existing Browser" → "Internet Explorer Mode Pages," add `http://localhost:(port)`, and then open the application.

To open the developer tools, run `%systemroot%\system32\f12\IEChooser.exe`.

#### For Chrome

Download `chrome-win32.zip` from `https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html?prefix=Win/(Id)/`, extract it, and run it to run the older version.  
The ID uses the correspondence table in [chromium-snapshot.json](./config/chromium-snapshot.json).

Note that older Linux versions may lack shared libraries, potentially preventing the application from starting. Therefore, using the Windows version is a more straightforward approach.

## Debug
### Setup
To debug efficiently, it is preferable to disable minification and use the built artifact with signalr output set to trace level.  
In addition to running it in your local environment, you can also use the [upstream-build](https://github.com/arika0093/LegacyBlazorJs/actions/workflows/upstream-build.yml) (which runs daily) of this repository, as it uploads artifacts with those options applied.

### Points to Note

* Simple grammatical errors and missing APIs should be relatively easy to spot by checking the DevTools console.
* SignalR connection logs include the date and log level at the beginning. Example: `[2026-06-22T06:40:46.624Z] Information: `
* If the event `WebSocket connected to ws://localhost:(port)/_blazor?id=...` is present, it indicates that at least JS interpretation, execution, and SignalR connection establishment are working correctly. The problem likely lies in subsequent event execution.
* The `connection.on('JS.` event inside `startConnection` is the first point at which SignalR events are received.
* UI updates are triggered by the `JS.RenderBatch` event.
* DOM additions are handled by `insertLogicalChild`, and DOM removals by `removeLogicalChild`.
