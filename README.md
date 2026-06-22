# LegacyBlazorJs

Rebuilds the official ASP.NET Core [blazor.web.js](https://github.com/dotnet/aspnetcore/tree/main/src/Components/Web.JS) for multiple JavaScript language targets and publishes the results as a Razor Class Library NuGet package.

## Overview
### Motivation

The official ASP.NET Core [Blazor browser support](https://learn.microsoft.com/en-us/aspnet/core/blazor/supported-platforms) targets "evergreen" browsers only.

However, there are cases where supporting older browsers is necessary, especially for enterprise use.
Unfortunately, .NET 9 and later target ES2022, and there have been [reports](https://github.com/dotnet/aspnetcore/issues/58212) of it not working on somewhat older browsers.

This project aims to make Blazor available on older browsers by rebuilding the Blazor JavaScript runtime, blazor.web.js, to support multiple versions from ES5 to ES2022.

### Goals

Our goal is to make this work on the following platforms:

* Chrome 23+ (This is the first Chrome to support [ES5](https://caniuse.com/es5))
* Internet Explorer 11 (As much as possible. Testing is insufficient, but it works for now)
* And newer browsers. It should probably work on any Chrome-based browser.

### Automation

The build, verification, and release processes are [automated](#build-status) and scheduled to run regularly. This allows us to:

* Instant access to upstream updates and breaking changes.
* Released versions should pass testing and therefore function correctly.
* Updates continue even if I lose interest. (Sustainability!)

## How to use
### from NuGet packages

[![Current](https://img.shields.io/nuget/v/LegacyBlazorJs?logo=nuget&label=current)](https://www.nuget.org/packages/LegacyBlazorJs) [![Preview](https://img.shields.io/nuget/vpre/LegacyBlazorJs?logo=nuget&label=preview)](https://www.nuget.org/packages/LegacyBlazorJs)

Install the [NuGet package](https://www.nuget.org/packages/LegacyBlazorJs) `LegacyBlazorJs` in your Blazor application.

For example, if you are using .NET 10, the version you should install is `10.*`.

```bash
dotnet add package LegacyBlazorJs
```

Then, replace the official script in your Blazor Web App's `Components/App.razor` with the required profile:

```diff
- <script src="@Assets["_framework/blazor.web.js"]"></script>
+ <script src="@Assets["_content/LegacyBlazorJs/blazor.web.es2015.js"]"></script>
```

The `es2015` part can be changed according to the browser target. Please refer to the [Included files](#included-files) section for details.

### from GitHub Release

You can also download and use the compiled JavaScript files from GitHub Releases, which are uploaded there.

The procedure is as follows:

1. Download the latest js files from [`Release/LegacyBlazorJs.x.y.z.zip`](https://github.com/arika0093/LegacyBlazorJs/releases).
2. Unzip the files and copy the necessary JavaScript files to wwwroot.
3. Load those JavaScript files as scripts in App.razor.

## Included files
### Overview

The following files are included under `_content/LegacyBlazorJs/`:

- blazor.web.{version}.js
- blazor.server.{version}.js

> [!TIP]
> When running on Blazor Server, there is not much difference between the two. 
> `blazor.server.js` is recommended because it has simpler functionality and a smaller size.

The versions listed below are available.

| Version   | Browser target    | Notes                       |
|-----------|-------------------|-----------------------------|
| `es5`     | Chrome 23+, IE 11 | `blazor.server` only works. |
| `es2015`  | Chrome 49+ | |
| `es2017`  | Chrome 58+ | |
| `es2018`  | Chrome 64+ | |
| `es2020`  | Chrome 80+ | Default for .NET 8 |
| `es2022`  | Chrome 94+ | Default for .NET 9 |

The profile definitions are in [config/targets.json](config/targets.json).

## Compatibility results

| Target | Browser | Version | Server |
|--------|---------|---------|--------|
| es5    | IE      | ~9      | ❌️(1)  |
| es5    | IE      | 10      | ❌️(2)  |
| es5    | IE      | 11      | 👌(3)  |
| es5    | Chrome  | 23      | ✅     |
| es2015 | Chrome  | 49      | ✅     |
| es2017 | Chrome  | 58      | ✅     |
| es2018 | Chrome  | 64      | ✅     |
| es2020 | Chrome  | 80      | ✅     |
| es2022 | Chrome  | 94      | ✅     |

1. IE9 and earlier are difficult to run due to a significant lack of APIs.
2. The SignalR connection can be established, but subsequent UI updates are broken.
3. Confirmed to work. Since regular testing is not performed, it may stop working at some point.

## Build status
### Weekly release builds

<!-- start:weekly-release-builds -->
| Result | Run ID | Date | Message |
|--------|--------|------|---------|
| - | - | - | No recent scheduled runs |
<!-- end:weekly-release-builds -->

### Daily main build

<!-- start:daily-main-build -->
| Result | Run ID | Date | Message | Upstream main hash |
|--------|--------|------|---------|--------------------|
| - | - | - | No recent scheduled runs | - |
<!-- end:daily-main-build -->

## Development guide
### How it works

To be specific, the process is as follows:

1. First, resolve the upstream [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore) targets.
    * The defaults are controlled in [config/majors.json](config/majors.json).
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
    * It is released with the same version as the upstream.

Since many modern APIs are missing in older browsers, syntax transformation by Babel alone is not sufficient.  
Therefore, the following Polyfills and Patches are applied.

### Pre-Patches

Before building, apply the following patches first. These patches basically replace the upstream code itself with simple fixes.

* [batch-blazor-regex.mjs](./scripts/build/patches/patch-blazor-regex.mjs)
  * Blazor uses a regular expression to retrieve comments (`<!--Blazor:*** -->`) included in HTML and connect them, but the regular expression uses Name Capture Group.
  * Name Capture Group is [only supported](https://caniuse.com/mdn-javascript_regular_expressions_named_capturing_group) in ES2018 and later, so it is modified to retrieve it by index specification.
* [patch-signalr-logging.mjs](./scripts/build/patches/patch-signalr-logging.mjs)
  * Replaces the SignalR log output level.
  * By default, this results in a warning, but it makes debugging easier.
  * This is only effective during development; it remains unchanged in the release version.

### Rollup Build

Overview of the build process is as follows. 
see [rollup-plugins](./scripts/build/lib/rollup-plugins/index.mjs) for details.

* Convert CommonJS modules to ES modules.
* Insert Polyfill for [whatwg-fetch](https://github.com/whatwg/fetch) and [webcomponents](https://github.com/webcomponents/polyfills).
* Use Babel to transform syntax for older browsers.
* Insert Polyfill of [core-js](https://github.com/zloirock/core-js).
* Convert `import()` to `Function("u", "return import(u)")(u);` because `import()` syntax will cause an error in older browsers.
  * Even if you run in this state, it will cause an error, but since this part is not executed except for WASM (`dotnet.js`), it is not a problem.
* Other transformations are also performed for older browsers.

These settings are inserted before terser is applied in [upstream rollup settings](https://github.com/dotnet/aspnetcore/tree/main/src/Components/Shared.JS/rollup.config.mjs).

## How to Test Functionality

Although there are many limitations, methods for testing functionality remain available for IE and Chrome as of 2026.

### For IE

Open Edge, go to "Settings" → "Existing Browser" → "Internet Explorer Mode Pages," add `http://localhost:(port)`, and then open the application.

To open the developer tools, run `%systemroot%\system32\f12\IEChooser.exe`.

### For Chrome

Download `chrome-win32.zip` from `https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html?prefix=Win/(Id)/`, extract it, and run it to run the older version.  
The ID uses the correspondence table in [chromium-snapshot.json](./config/chromium-snapshot.json).

Note that older Linux versions may lack shared libraries, potentially preventing the application from starting. Therefore, using the Windows version is a more straightforward approach.

## License

[This repository](./LICENSE) itself is licensed under the MIT License.

The generated js files included in the build artifacts are licensed under the MIT License of [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore/blob/main/LICENSE.txt).
