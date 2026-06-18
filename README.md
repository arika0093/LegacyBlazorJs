# LegacyBlazorJs

Rebuilds the official ASP.NET Core [blazor.web.js](https://github.com/dotnet/aspnetcore/tree/main/src/Components/Web.JS) for multiple JavaScript language targets and publishes the results as a Razor Class Library NuGet package.

## Motivation

The official ASP.NET Core [Blazor browser support](https://learn.microsoft.com/en-us/aspnet/core/blazor/supported-platforms) targets "evergreen" browsers only.

However, there are cases where supporting older browsers is necessary, especially for enterprise use.
Unfortunately, .NET 9 and later target [ES2022](https://github.com/dotnet/aspnetcore/blob/v9.0.0/src/Components/Shared.JS/tsconfig.json#L3), and there have been [reports](https://github.com/dotnet/aspnetcore/issues/58212) of it not working on somewhat older browsers.

This project aims to make Blazor available on older browsers by rebuilding the Blazor JavaScript runtime, blazor.web.js, to support multiple versions from ES2015 to ES2022.

## How to use
### Blazor Server

Install the NuGet package `LegacyBlazorJs` in your Blazor application.

For example, if you are using dotnet(aspnetcore) 10.0.1, the version you should install is `10.0.1`.

```bash
dotnet add package LegacyBlazorJs --version 10.0.1
```

Then, replace the official script in your Blazor Web App's `Components/App.razor` with the required profile:

```diff
- <script src="_framework/blazor.web.js"></script>
+ <script src="_content/LegacyBlazorJs/blazor.web.es2015.js"></script>
```

The `es2015` part can be changed according to the browser target. Please refer to the [Included files](#included-files) section for details.

### Blazor WebAssembly

The process is almost the same for Blazor WebAssembly. After installation, replace the script in `wwwroot/index.html`:

```diff
- <script src="_framework/blazor.webassembly.js"></script>
+ <script src="_content/LegacyBlazorJs/blazor.webassembly.uwasm.js"></script>
```

To run WebAssembly, the following features are required:

* [WebAssembly](https://caniuse.com/wasm)
* [Dynamic import](https://caniuse.com/es6-module-dynamic-import)
* [BigInt](https://caniuse.com/bigint)

These features cannot be polyfilled, so they must be supported natively by the browser.  
The `uwasm` build is provided for browsers that meet these minimum requirements (Chrome 67+, Edge 79+, Safari 14+, Firefox 68+).

## Included files
### Overview

The following files are included under `_content/LegacyBlazorJs/`:

- blazor.web.{version}.js
- blazor.server.{version}.js
- blazor.webassembly.{version}.js
- blazor.webview.{version}.js

The versions listed below are available.

| Version   | Intended browser target                        |
|-----------|------------------------------------------------|
| ~~`es5`~~ | ~~Chrome 23+~~                                 |
| `es2015`  | Chrome 49+                                     |
| `es2017`  | Chrome 58+                                     |
| `es2018`  | Chrome 64+                                     |
| `uwasm`   | Chrome 67+, Edge 79+, Safari 14+, Firefox 68+  |
| `es2020`  | Chrome 80+                                     |
| `es2022`  | Chrome 94+                                     |

The profile definitions are in [config/targets.json](config/targets.json).

### Why not include ES5/IE11?

**Short answer**:  
APIs are missing, testing is difficult, so trial-and-error is challenging.

**Long answer**:  
ES5 syntax is [supported](https://caniuse.com/es5) even in quite old browsers. It works on Chrome 23+ and IE 10+ (since 2012!).  
However, the situation is not so straightforward.

* Old browsers do not recognize the latest syntax (e.g., replacing arrow functions).
  * It can be done relatively easily using [Babel](https://babeljs.io/docs/).
* Old browsers lack many Javascript APIs (e.g. `Set`, `Map`, `Promise`, etc.).
  * It can be supplemented with [core-js](https://github.com/zloirock/core-js). but it requires replacing the build process, which is somewhat complicated.
* Old browsers lack many browser APIs (e.g., [fetch](https://caniuse.com/fetch), [getRootNode](https://caniuse.com/mdn-api_node_getrootnode), etc.).
  * The polyfill is insufficient. In particular, it is difficult to select when supporting IE11.
* Beyond JavaScript-side issues, since .NET dynamically invokes JS, the range of APIs that need to be supported is extremely wide.
* The bidirectional nature of JS/.NET communication makes debugging difficult.
* Tools like `playwright` and `puppeteer` cannot be used, so automated testing is difficult.
  * This means that upstream modifications cannot be detected immediately, making early problem detection and verification of solutions extremely difficult.

However, there is hope.

* Automated testing can be executed on Chrome 23 (ES5)!
  * but although error messages are insufficient.
* WebSocket connections can be established on both ES5 and IE11.
* The problem is narrowed down after that. In other words, if a good approach can be found, it may be possible to support ES5/IE11 as well.


## Development Guide
### How it works

To be specific, the process is as follows:

1. First, check the tags of the upstream [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore) to find the latest versions.
2. Clone the upstream.
3. For .NET 8 and earlier, use yarn; for .NET 9 and later, use npm workspaces.
4. Build the dependencies in advance. As of .NET 10, the following are included in the dependencies.
    * [JSInterop](https://github.com/dotnet/aspnetcore/tree/main/src/JSInterop/Microsoft.JSInterop.JS/src)
    * [SignalR](https://github.com/dotnet/aspnetcore/tree/main/src/SignalR/clients/ts/signalr)
    * dotnet.js is built in the [runtime](https://github.com/dotnet/runtime/tree/main/src/mono/wasm), but since it is loaded by dynamic import, it does not need to be built in advance.
5. It is compiled by `@rollup/plugin-typescript`.
    * At this time, by inserting a transformation plugin via Babel, it is converted for older browsers such as ES2015.
6. The generated JS files (`blazor.(type).(version).js`) are packaged together into `LegacyBlazorJs`.
7. Smoke tests are performed (using an old Chromium), and then the package is released.
    * It is released with the same version as the upstream.

Since many modern APIs are missing in older browsers, syntax transformation by Babel alone is not sufficient.  
Therefore, the following Polyfills and Patches are applied.

### Pre-Patches

Before building, apply the following patches first. These patches basically replace the upstream code itself with simple fixes.

* [batch-blazor-regex.mjs](./scripts/build/patches/patch-blazor-regex.mjs)
  * Blazor uses a regular expression to retrieve comments (`<!--Blazor:*** -->`) included in HTML and connect them, but the regular expression uses Name Capture Group.
  * Name Capture Group is [only supported](https://caniuse.com/mdn-javascript_regular_expressions_named_capturing_group) in ES2018 and later, so it is modified to retrieve it by index specification.
* [patch-signalr-abort-controller.mjs](./scripts/build/patches/patch-signalr-abort-controller.mjs)
  * AbortController is [not supported](https://caniuse.com/abortcontroller) in older browsers, so if it is not available, it is modified not to use it.

### Rollup Build

Overview of the build process is as follows. 
see [rollup-plugins](./scripts/build/lib/rollup-plugins/index.mjs) for details.

* Convert CommonJS modules to ES modules.
* Insert Polyfill for [whatwg-fetch](https://github.com/whatwg/fetch) because it is not available in older browsers.
* Convert `import()` to `Function("u", "return import(u)")(u);` because `import()` syntax will cause an error in older browsers.
  * Even if you run in this state, it will cause an error, but since this part is not executed except for WASM (`dotnet.js`), it is not a problem.
* Use Babel to transform syntax for older browsers.
* Transform the output of rollup again with Babel (because rollup helpers do not work in older browsers).
* Insert Polyfill of [core-js](https://github.com/zloirock/core-js).

These settings are inserted before terser is applied in [upstream rollup settings](https://github.com/dotnet/aspnetcore/tree/main/src/Components/Shared.JS/rollup.config.mjs).

## Compatibility results

<!-- compatibility-results:start -->
TODO
<!-- compatibility-results:end -->

## License

[This repository](./LICENSE) itself is licensed under the MIT License.

The generated js files included in the build artifacts are licensed under the MIT License of [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore/blob/main/LICENSE.txt).
