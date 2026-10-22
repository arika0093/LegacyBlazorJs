# LegacyBlazorJs

[![Current](https://img.shields.io/nuget/v/LegacyBlazorJs?logo=nuget&label=current&style=flat-square)](https://www.nuget.org/packages/LegacyBlazorJs) [![Preview](https://img.shields.io/nuget/vpre/LegacyBlazorJs?logo=nuget&label=preview&style=flat-square)](https://www.nuget.org/packages/LegacyBlazorJs)  
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/arika0093/LegacyBlazorJs/ci.yml?event=schedule&style=flat-square&label=Monthly%20Release)](#monthly-release-builds) [![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/arika0093/LegacyBlazorJs/upstream-build.yml?event=schedule&style=flat-square&label=Weekly%20Build)](#weekly-main-build) ![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/arika0093/LegacyBlazorJs/smoke-test.yml?branch=main&style=flat-square&label=Testing)


Rebuilds the official ASP.NET Core [blazor.web.js](https://github.com/dotnet/aspnetcore/tree/main/src/Components/Web.JS) for multiple JavaScript language targets and publishes the results as a Razor Class Library NuGet package.

## Overview
### Motivation

The official ASP.NET Core [Blazor browser support](https://learn.microsoft.com/en-us/aspnet/core/blazor/supported-platforms) targets "evergreen" browsers only.

However, there are cases where supporting older browsers is necessary, especially for enterprise use.
Unfortunately, .NET 9 and later target ES2022, and there have been [reports](https://github.com/dotnet/aspnetcore/issues/58212) of it not working on somewhat older browsers.

This project aims to make Blazor Server available on older browsers by rebuilding the Blazor JavaScript runtime, blazor.web.js, to support multiple versions from ES5 to ES2022.

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

## Compatibility testing
### Online Environment
In an online environment, you can connect to the demo site to check if it works.  
https://legacy-blazor-js.app.eclairs.cc/

### Offline Environment
You can build and set up the [Test Project](./dotnet/example/LegacyBlazorJs.IntroSite/) to check if it works in an offline environment.  
Alternatively, you can use the [Docker Image](https://github.com/users/arika0093/packages/container/package/legacyblazorjs-introsite).

```bash
docker run -d -p 8080:80 ghcr.io/arika0093/legacyblazorjs-introsite:main
```

## How to use
### from NuGet packages

Install the [NuGet package](https://www.nuget.org/packages/LegacyBlazorJs) `LegacyBlazorJs` in your Blazor application.

For example, if you are using .NET 10, the version you should install is `10.*`.

```bash
dotnet add package LegacyBlazorJs
```

Then, replace the official script in your Blazor Web App's `Components/App.razor` with the required profile:

```html
<!-- <script src="@Assets["_framework/blazor.web.js"]"></script> -->
<LegacyBlazorJs.Loader Target="es2015" />
```

Or, you can load the file directly.

```razor
<script src="@Assets["_content/LegacyBlazorJs/blazor.server.es2015.js"]"></script>
```

> [!TIP]
> If you do not use WebAssembly features, there is no particular reason to use `blazor.web.js`.
> We recommend using `blazor.server.js`, which has a smaller file size.

The `es2015` part can be changed according to the browser target. Please refer to the [Included files](#included-files) section for details.

By omitting the `Target` specification, the loader checks the runtime syntax and features available in the browser.  
If modern features are available it falls back to the official `/_framework/blazor.server.js`; otherwise it selects the highest LegacyBlazorJs target.

```html
<LegacyBlazorJs.Loader />
```

### from JsDelivr CDN

You can also use the compiled JavaScript files from the JsDelivr CDN.  
for example, if you want to use the `es5` version, you can load it as follows:

```html
<script src="https://cdn.jsdelivr.net/gh/arika0093/LegacyBlazorJs@release/v10.0.9.61/dist/blazor.server.es5.js"></script>
```

> [!WARNING]
> The CDN is provided for testing purposes only.
> Please download the files and use them in production environments.


### from GitHub Release

You can also download and use the compiled JavaScript files from GitHub Releases, which are uploaded there.

The procedure is as follows:

1. Download the latest `LegacyBlazorJs.(version).zip` file from [Release](https://github.com/arika0093/LegacyBlazorJs/releases).
2. Unzip the files and copy the necessary JavaScript files to wwwroot.
3. Load those JavaScript files as scripts in App.razor.

## Included files
### Overview

The following files are included under `_content/LegacyBlazorJs/`:

- blazor.web.{version}.js
- blazor.server.{version}.js

The versions listed below are available.

| Version   | Browser target    | Notes                       |
|-----------|-------------------|-----------------------------|
| `es5`     | Chrome 23+, IE 11 | `blazor.server` only works. |
| `es2015`  | Chrome 49+ | |
| `es2017`  | Chrome 58+ | |
| `es2018`  | Chrome 64+ | [dynamic import](https://caniuse.com/es6-module-dynamic-import) only available in this version and later. |
| `es2020`  | Chrome 80+ | |
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
### Monthly release builds

<!-- start:monthly-release-builds -->
| Result | Run ID | Date | Trigger | Message |
|--------|--------|------|----------|---------|
| ❌ | [#51](https://github.com/arika0093/LegacyBlazorJs/actions/runs/39808362048) | 2026-10-22 | 🔧 Manual | Error in test-compat (net9, 9, stable, v9.0.21, 9.0.21, 9.0.21.86, es5) / test-compat |
| ❌ | [#49](https://github.com/arika0093/LegacyBlazorJs/actions/runs/39453983542) | 2026-10-20 | 🔧 Manual | Error in test-compat (current, 10, stable, v10.0.13, 10.0.13, 10.0.13.85, es2015) / test-compat |
| 🚫 | [#48](https://github.com/arika0093/LegacyBlazorJs/actions/runs/39446859445) | 2026-10-20 | 🔧 Manual | Error in test-compat (net9, 9, stable, v9.0.21, 9.0.21, 9.0.21.84, es2015) / test-compat |
| ✅ | [#38](https://github.com/arika0093/LegacyBlazorJs/actions/runs/31848128345) | 2026-08-14 | 🔧 Manual | No updates |
| ❌ | [#37](https://github.com/arika0093/LegacyBlazorJs/actions/runs/31846656269) | 2026-08-14 | 🔧 Manual | Error in build-all (current, 10, stable, v10.0.11, 10.0.11, 10.0.11.73, es2020) / build |
<!-- end:monthly-release-builds -->

### Weekly main build

<!-- start:weekly-main-build -->
| Result | Run ID | Date | Message | Upstream main hash |
|--------|--------|------|---------|--------------------|
| ❌ | [#186](https://github.com/arika0093/LegacyBlazorJs/actions/runs/39339249744) | 2026-10-19 | Error in smoke-test (es5) / test-compat | [c7a1c5c9](https://github.com/dotnet/aspnetcore/tree/c7a1c5c9) |
| ❌ | [#185](https://github.com/arika0093/LegacyBlazorJs/actions/runs/39169723306) | 2026-10-18 | Error in smoke-test (es5) / test-compat | [c09e2b89](https://github.com/dotnet/aspnetcore/tree/c09e2b89) |
| ❌ | [#184](https://github.com/arika0093/LegacyBlazorJs/actions/runs/39072171423) | 2026-10-17 | Error in smoke-test (es5) / test-compat | [c09e2b89](https://github.com/dotnet/aspnetcore/tree/c09e2b89) |
| ❌ | [#183](https://github.com/arika0093/LegacyBlazorJs/actions/runs/38974196975) | 2026-10-16 | Error in smoke-test (es2015) / test-compat | [a135adba](https://github.com/dotnet/aspnetcore/tree/a135adba) |
| ❌ | [#182](https://github.com/arika0093/LegacyBlazorJs/actions/runs/38818608184) | 2026-10-15 | Error in smoke-test (es5) / test-compat | [1e4a69d0](https://github.com/dotnet/aspnetcore/tree/1e4a69d0) |
<!-- end:weekly-main-build -->

## Note

> [!WARNING]
> This project is focused on Blazor Server only. WebAssembly is not supported.  
> More details are in the [here](./docs/how-it-works.md#why-webassembly-is-not-supported) section.

> [!NOTE]
> In environments where dynamic imports are not available(`~es2017`), third-party libraries probably won't work.


## Development guide

* [How it works](./docs/how-it-works.md)
* [How to build and testing](./docs/how-to-testing.md)
* [Troubleshooting](./docs/troubleshooting.md)

## License

[This repository](./LICENSE) itself is licensed under the MIT License.

The generated js files included in the build artifacts are licensed under the MIT License of [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore/blob/main/LICENSE.txt).
