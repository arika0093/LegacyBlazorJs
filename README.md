# LegacyBlazorJs

LegacyBlazorJs rebuilds the official ASP.NET Core [blazor.web.js](https://github.com/dotnet/aspnetcore/tree/main/src/Components/Web.JS) for multiple JavaScript language targets and publishes the results as a Razor Class Library NuGet package.

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

The `es2015` part can be changed according to the browser target. Please refer to the [Included files and intended browser targets](#included-files-and-intended-browser-targets) section for details.

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
| `ie11`   | ES5 + Internet Explorer 11 (best effort) |
| `es5`    | Chrome 23+, Edge 12+, Firefox 21+, Safari 6+ |
| `es2015` | Chrome 51+, Edge 15+, Firefox 54+, Safari 10+ |
| `es2017` | Chrome 58+, Edge 16+, Firefox 54+, Safari 11+ |
| `es2020` | Chrome 80+, Edge 80+, Firefox 74+, Safari 13.1+ |
| `es2021` | Chrome 85+, Edge 85+, Firefox 79+, Safari 14.1+ |
| `es2022` | Chrome 94+, Edge 94+, Firefox 93+, Safari 15.4+ |

The authoritative profile definitions are in [config/targets.json](config/targets.json).

> [!NOTE]
> If you need additional targets, please feel free to submit a PR.

## Development Guide
### How it works

1. For every .NET major listed in `config/majors.json`, resolve the latest stable `dotnet/aspnetcore` tag through the GitHub API.
2. Clone that tag and build the upstream `Microsoft.AspNetCore.Components.Web.JS.npmproj`, including its linked JSInterop and SignalR dependencies.
3. Rebuild `src/Components/Web.JS` once per profile after changing the upstream TypeScript and webpack/Rollup Terser targets.
4. Pack `LegacyBlazorJs` using the upstream tag without its `v` prefix. For example `v8.0.27` becomes package version `8.0.27`.

### Smoke testing

TODO

### ES20x compatibility results

TODO

## License

[This repository](./LICENSE) itself is licensed under the MIT License.

The generated js files included in the build artifacts are licensed under the MIT License of [dotnet/aspnetcore](https://github.com/dotnet/aspnetcore/blob/main/LICENSE.txt).