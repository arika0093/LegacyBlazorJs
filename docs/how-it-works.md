# How it works

## Overview

The current build pipeline rebuilds upstream Blazor JavaScript from the ASP.NET Core repository, applies a small set of legacy-browser-oriented patches and Rollup plugins, and then packs the generated files into the `LegacyBlazorJs` Razor Class Library.

At a high level, the flow is:

1. Resolve the build channels from [config/majors.json](../config/majors.json).
2. Resolve the target profiles from [config/targets.json](../config/targets.json).
   * The profiles currently map from `es5` to `es2022`.
3. For each channel/profile pair, fetch or clone the upstream [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore) source into `.work/aspnetcore-<ref>`.
   * The upstream must use the npm workspace layout. The older yarn-based layout is no longer supported.
4. Install upstream npm dependencies and prebuild the JavaScript packages that `Web.JS` depends on.
   * Currently this includes:
     * [`src/JSInterop/Microsoft.JSInterop.JS/src`](https://github.com/dotnet/aspnetcore/tree/main/src/JSInterop/Microsoft.JSInterop.JS/src)
     * [`src/SignalR/clients/ts/signalr`](https://github.com/dotnet/aspnetcore/tree/main/src/SignalR/clients/ts/signalr)
     * [`src/SignalR/clients/ts/signalr-protocol-msgpack`](https://github.com/dotnet/aspnetcore/tree/main/src/SignalR/clients/ts/signalr-protocol-msgpack)
   * This step can be skipped locally with `SKIP_PREBUILD=true`.
5. Patch the upstream `Web.JS` sources before each profile build.
6. Inject LegacyBlazorJs Rollup plugins into the upstream Rollup config and rebuild `Web.JS` once per target profile.
7. Copy the generated `blazor.web.js` and `blazor.server.js` files into `dist/v<packageVersion>/` with profile-specific names such as `blazor.server.es2015.js`.
8. Run `es-check` against the generated profile files to confirm the emitted syntax stays within each selected profile target.
9. Copy the generated files into `dotnet/src/LegacyBlazorJs/wwwroot`, regenerate static package assets from `src/build/static-package-assets/`, and run `dotnet pack`.
   * The package version comes from the resolved upstream version, or from `PACKAGE_VERSION` when building from a non-tag ref such as `main`.
   * The target framework is inferred from the .NET major unless `LEGACY_BLAZOR_TARGET_FRAMEWORK` is set.
10. In CI, profile builds are produced independently, then merged back together and repacked into one NuGet package per build channel.
11. Smoke tests run against selected profiles, and release publication is performed only in the monthly workflow.

## Build and CI structure

There are currently three main automation paths:

* [ci.yml](../.github/workflows/ci.yml)
  * Monthly build/release workflow.
  * Resolves the configured channels, builds each profile separately, optionally runs compatibility tests, merges the artifacts, repacks the final NuGet packages, and can publish GitHub releases and NuGet packages on manual runs.
* [smoke-test.yml](../.github/workflows/smoke-test.yml)
  * Runs on pushes, pull requests, and manual dispatch.
  * Builds selected profiles (`es5`, `es2015`) and runs the Windows smoke test workflow against them.
* [upstream-build.yml](../.github/workflows/upstream-build.yml)
  * Daily upstream-main regression check.
  * Builds `main` from `dotnet/aspnetcore`, assigns a date-based package version, and runs smoke tests to detect upstream layout or behavior changes early.

## Pre-patches

Before invoking the upstream Rollup build, LegacyBlazorJs applies a small number of source patches.

* [patch-blazor-regex.mjs](../src/build/patches/patch-blazor-regex.mjs)
  * Upstream creates the Blazor comment regex with `new RegExp(...)`.
  * That form prevents Babel from statically rewriting the named capture group usage for legacy browsers.
  * This patch converts it to a RegExp literal so Babel can transform it correctly.
* [patch-signalr-logging.mjs](../src/build/patches/patch-signalr-logging.mjs)
  * Optional patch controlled by `SIGNALR_LOGGING`.
  * Rewrites the default SignalR circuit log level baked into the generated script.
  * This is mainly used for debug or smoke-test builds; if the variable is unset, nothing is patched.

## Rollup build

LegacyBlazorJs does not replace the upstream bundling pipeline. Instead, it inserts additional plugins immediately before the upstream Terser step in `Shared.JS/rollup.config.mjs`.

See [src/build/rollup-plugins/index.mjs](../src/build/rollup-plugins/index.mjs) for the exact plugin order.

The added processing currently does the following:

* Convert CommonJS dependencies to ES modules.
* Prepend `whatwg-fetch`.
* Prepend additional Web API polyfills needed for older browsers.
* Run Babel using the browser targets defined by each profile in [config/targets.json](../config/targets.json).
* Prepend only the required `core-js` polyfills for that profile.
* Rewrite dynamic `import()` usage into a form that older parsers can tolerate.
* Apply IE11-specific fixes.
* Apply extra ES5-specific fixes.

For local debugging, Terser can also be disabled with `LEGACY_BLAZOR_DISABLE_TERSER=true`.

## Static package assets

Files that ship in the Razor Class Library but are not produced by the upstream `Web.JS` build are maintained under [src/build/static-package-assets](../src/build/static-package-assets/).

Currently this includes:

* [autoloader.js](../src/build/static-package-assets/autoloader.js)
  * The checked-in copy under `dotnet/src/LegacyBlazorJs/wwwroot` is generated from this source during the build/package flow.
  * JavaScript assets in this directory are minified with Terser unless `LEGACY_BLAZOR_DISABLE_TERSER=true` is set for debugging.

## Why WebAssembly is not supported

**TL;DR**: this project is focused on Blazor Server, and the current build pipeline only repackages the server-oriented JavaScript bundles.

More specifically:

* The repository currently copies only `blazor.web.js` and `blazor.server.js` into the package output.
* WebAssembly-related files are generated together with app-specific publish output, and their final shape depends on the published application.
* Those files also carry runtime-specific import graphs and hashes, which makes prebuilt redistribution much less practical.
* Even if the transformation problem were solved, older browsers still lack many of the platform features required by the WebAssembly runtime.

Because of that combination of technical cost and limited payoff, WebAssembly support is out of scope for this repository.
