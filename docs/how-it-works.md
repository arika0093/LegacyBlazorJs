# How it works

To be specific, the process is as follows:

1. First, resolve the upstream [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore) targets.
    * The defaults are controlled in [config/majors.json](../config/majors.json).
2. Clone the upstream.
3. Build the upstream JavaScript packages with npm workspaces.
4. Build the dependencies in advance. As of .NET 10, the following are included in the dependencies.
    * [JSInterop](https://github.com/dotnet/aspnetcore/tree/main/src/JSInterop/Microsoft.JSInterop.JS/src)
    * [SignalR](https://github.com/dotnet/aspnetcore/tree/main/src/SignalR/clients/ts/signalr)
    * dotnet.js is built in the [runtime](https://github.com/dotnet/runtime/tree/main/src/mono/wasm), but since it is loaded by dynamic import, it does not need to be built in advance.
5. It is compiled by [rollup](https://rollupjs.org/).
    * At this time, by inserting a transformation plugin via Babel, it is converted for older browsers such as ES2015.
6. The generated JS files are packaged together into `LegacyBlazorJs`.
7. Smoke tests are performed (using an old Chromium), and then the package is released.
    * Weekly releases append this repository's commit height to the upstream version.
    * The commit height counts only changes under `src/`, `dotnet/src/`, `config/`, and `package.json`, excluding Markdown files.
    * e.g. `10.0.9`(upstream) -> `10.0.9.123`(LegacyBlazorJs)

Since many modern APIs are missing in older browsers, syntax transformation by Babel alone is not sufficient.  
Therefore, the following Polyfills and Patches are applied.

## Pre-Patches

Before building, apply the following patches first. These patches basically replace the upstream code itself with simple fixes.

* [batch-blazor-regex.mjs](../src/build/patches/patch-blazor-regex.mjs)
  * Blazor uses a regular expression to retrieve comments (`<!--Blazor:*** -->`) included in HTML and connect them, but the regular expression uses Name Capture Group.
  * Name Capture Group is [only supported](https://caniuse.com/mdn-javascript_regular_expressions_named_capturing_group) in ES2018 and later, so it is modified to retrieve it by index specification.
* [patch-signalr-logging.mjs](../src/build/patches/patch-signalr-logging.mjs)
  * Replaces the SignalR log output level.
  * By default, this results in a warning, but it makes debugging easier.
  * This is only effective during development; it remains unchanged in the release version.

## Rollup Build

Overview of the build process is as follows. 
see [rollup-plugins](../src/build/rollup-plugins/index.mjs) for details.

* Convert CommonJS modules to ES modules.
* Insert Polyfill for [whatwg-fetch](https://github.com/whatwg/fetch) and [webcomponents](https://github.com/webcomponents/polyfills).
* Use Babel to transform syntax for older browsers.
* Insert Polyfill of [core-js](https://github.com/zloirock/core-js).
* Convert `import()` to `Function("u", "return import(u)")(u);` because `import()` syntax will cause an error in older browsers.
  * Even if you run in this state, it will cause an error, but since this part is not executed except for WASM (`dotnet.js`), it is not a problem.
* Other transformations are also performed for older browsers.

These settings are inserted before terser is applied in [upstream rollup settings](https://github.com/dotnet/aspnetcore/tree/main/src/Components/Shared.JS/rollup.config.mjs).

## Why does not support WebAssembly?

**TL;DR**: Because the JS files are dynamically generated at `publish` time.

To understand this, we need to know how WASM works. When you create a typical WASM project and run `dotnet publish`, files like the following are generated in `wwwroot/_framework`:

* `dotnet.js`
* `dotnet.native.js`
* `dotnet.runtime.js`
* `dotnet.boot.js`
* ...and various `*.wasm` files.

These files are generated at each app's build time (because the required DLLs are unknown beforehand), so we cannot take an approach of transpiling them in advance. Additionally, each file's import list contains SHA256 hashes, and if we transpile them in advance, the hashes will change. To resolve this issue, each LegacyBlazorJs user would need to run JS file transformation themselves, which requires installing `node` and various packages—a time-consuming process. Even if users overcome this, WASM and related features simply don't work in older browsers anyway. Considering these factors, we determined that the support cost outweighs the benefits, so WebAssembly is not supported.

The following resources may be helpful:
* https://github.com/dotnet/runtime/tree/main/src/mono/browser/build/README.md
* https://github.com/dotnet/runtime/blob/main/src/mono/wasm/features.md
