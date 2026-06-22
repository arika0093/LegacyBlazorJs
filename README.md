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

* [How it works](./docs/how-it-works.md)
* [How to build and testing](./docs/how-to-testing.md)

## License

[This repository](./LICENSE) itself is licensed under the MIT License.

The generated js files included in the build artifacts are licensed under the MIT License of [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore/blob/main/LICENSE.txt).
