# LegacyBlazorJs

Rebuilds the official ASP.NET Core [blazor.web.js](https://github.com/dotnet/aspnetcore/tree/main/src/Components/Web.JS) for multiple JavaScript language targets and publishes the results as a Razor Class Library NuGet package.

## Motivation

The official ASP.NET Core [Blazor browser support](https://learn.microsoft.com/en-us/aspnet/core/blazor/supported-platforms) targets "evergreen" browsers only.

However, there are cases where supporting older browsers is necessary, especially for enterprise use.
Unfortunately, .NET 9 and later target [ES2022](https://github.com/dotnet/aspnetcore/blob/v9.0.0/src/Components/Shared.JS/tsconfig.json#L3), and there have been [reports](https://github.com/dotnet/aspnetcore/issues/58212) of it not working on somewhat older browsers.

This project aims to make Blazor available on older browsers by rebuilding the Blazor JavaScript runtime, blazor.web.js, to support multiple versions from ES5 to ES2022.

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
+ <script src="_content/LegacyBlazorJs/blazor.webassembly.es2020.js"></script>
```

Note that Blazor WebAssembly will not work on browsers that do not support WebAssembly itself (obviously).
Specifically, it will not work on the following browsers.

- **Internet Explorer (all versions)**
- Chrome < 57
- Edge < 16
- Firefox < 52
- Safari < 11

see [CanIUse](https://caniuse.com/wasm) for more details.

## Included files
### Overview

The following files are included under `_content/LegacyBlazorJs/`:

- blazor.web.{version}.js
- blazor.server.{version}.js
- blazor.webassembly.{version}.js
- blazor.webview.{version}.js

The versions listed below are available.

| Version | Intended browser target |
|---------|-------------------------|
| `ie11`   | Internet Explorer 11 [best effort] |
| `es5`    | Chrome 23+ (Edge 12+, Firefox 21+, Safari 6+) |
| `es2015` | Chrome 49+ (Edge 15+, Firefox 54+, Safari 10+) |
| `es2017` | Chrome 58+ (Edge 16+, Firefox 54+, Safari 11+) |
| `es2020` | Chrome 80+ (Edge 80+, Firefox 74+, Safari 13.1+) |
| `es2022` | Chrome 94+ (Edge 94+, Firefox 93+, Safari 15.4+) |

The browsers in parentheses are reference values.
The authoritative profile definitions are in [config/targets.json](config/targets.json).

> [!NOTE]
> If you need additional targets, please feel free to submit a PR.

## Development Guide
### How it works

To be specific, the process is as follows:

1. First, check the tags of the upstream [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore) to find the latest versions.
2. Clone the upstream.
3. For .NET 8 and earlier, use yarn; for .NET 9 and later, use npm workspaces.
4. Build the dependencies in advance. As of .NET 10, the following are included in the dependencies.
    * [JSInterop](https://github.com/dotnet/aspnetcore/tree/main/src/JSInterop/Microsoft.JSInterop.JS/src)
    * [SignalR](https://github.com/dotnet/aspnetcore/tree/main/src/SignalR/clients/ts/signalr)
    * [SignalR-protocol-msgpack](https://github.com/dotnet/aspnetcore/tree/main/src/SignalR/clients/ts/signalr-protocol-msgpack)
    * dotnet.js is built in the [runtime](https://github.com/dotnet/runtime/tree/main/src/mono/wasm), but since it is loaded by dynamic import, it does not need to be built in advance.
5. It is compiled by `@rollup/plugin-typescript`.
    * At this time, by inserting a transformation plugin via Babel, it is converted for older browsers such as ES5 and ES2015.
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
* Finally, insert Polyfill of [core-js](https://github.com/zloirock/core-js).

These settings are inserted before terser is applied in [upstream rollup settings](https://github.com/dotnet/aspnetcore/tree/main/src/Components/Shared.JS/rollup.config.mjs).

## Compatibility results

<!-- compatibility-results:start -->
TODO
<!-- compatibility-results:end -->

## License

[This repository](./LICENSE) itself is licensed under the MIT License.

The generated js files included in the build artifacts are licensed under the MIT License of [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore/blob/main/LICENSE.txt).
