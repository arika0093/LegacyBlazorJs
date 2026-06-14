# LegacyBlazorJs

LegacyBlazorJs rebuilds the official ASP.NET Core `blazor.web.js` for multiple JavaScript language targets and publishes the results as a Razor Class Library NuGet package.

## How it works

1. For every .NET major listed in `config/majors.json`, resolve the latest stable `dotnet/aspnetcore` tag through the GitHub API.
2. Clone that tag and build the upstream `Microsoft.AspNetCore.Components.Web.JS.npmproj`, including its linked JSInterop and SignalR dependencies.
3. Rebuild `src/Components/Web.JS` once per profile after changing the upstream TypeScript and webpack/Rollup Terser targets.
4. Put the generated scripts in the Razor Class Library's `wwwroot` and pack `LegacyBlazorJs` using the upstream tag without its `v` prefix, for example `v8.0.27` becomes package version `8.0.27`.

Building from source is intentional. Retranspiling the already bundled upstream `blazor.web.js` was tested and produced a script that loaded but did not make a Blazor Server application interactive.

## Included files and intended browser targets

After referencing the NuGet package, applications can serve each file from `_content/LegacyBlazorJs/<file-name>`.

| File | Intended browser target | TypeScript/bundler output syntax |
|---|---|---|
| `blazor.web.ie6.js` | Internet Explorer 6+ (best effort) | ES5 |
| `blazor.web.ie7.js` | Internet Explorer 7+ (best effort) | ES5 |
| `blazor.web.ie8.js` | Internet Explorer 8+ (best effort) | ES5 |
| `blazor.web.ie9.js` | Internet Explorer 9+ (best effort) | ES5 |
| `blazor.web.ie10.js` | Internet Explorer 10+ (best effort) | ES5 |
| `blazor.web.ie11.js` | Internet Explorer 11+ (best effort) | ES5 |
| `blazor.web.es2015.js` | Chrome 49+, Edge 14+, Firefox 45+, Safari 10+ | ES2015 |
| `blazor.web.es2016.js` | Chrome 52+, Edge 14+, Firefox 52+, Safari 10.1+ | ES2016 |
| `blazor.web.es2017.js` | Chrome 58+, Edge 16+, Firefox 54+, Safari 11+ | ES2017 |
| `blazor.web.es2018.js` | Chrome 64+, Edge 79+, Firefox 58+, Safari 12+ | ES2018 |
| `blazor.web.es2019.js` | Chrome 73+, Edge 79+, Firefox 67+, Safari 12.1+ | ES2019 |
| `blazor.web.es2020.js` | Chrome 80+, Edge 80+, Firefox 74+, Safari 13.1+ | ES2020 |
| `blazor.web.es2021.js` | Chrome 85+, Edge 85+, Firefox 79+, Safari 14.1+ | ES2021 |
| `blazor.web.es2022.js` | Chrome 94+, Edge 94+, Firefox 93+, Safari 15.4+ | ES2022 |

The authoritative profile definitions are in `config/targets.json`. There is intentionally no `modern` copy.

> [!WARNING]
> The IE files are best-effort **syntax-level** builds. Lowering the JavaScript syntax does not provide DOM APIs, WebAssembly, Promise, Fetch, URL, WebSocket, or any other missing browser feature. Current Blazor runtimes are not guaranteed to run on Internet Explorer. Consumers must supply any required polyfills and test on their actual target browsers. The IE6 through IE11 profiles currently produce the same ES5-targeted bundle; their separate names are provided so future browser-specific changes can be introduced without changing consumer URLs.

## Prerequisites and local build

- Git
- Node.js 20 or later with Corepack
- .NET 8 SDK or later

```bash
npm ci
npm run build -- 8
```

This resolves and builds the latest stable .NET 8 tag, then creates `artifacts/packages/LegacyBlazorJs.<version>.nupkg`. Set an explicit tag for a reproducible historical build:

```bash
ASPNETCORE_TAG=v8.0.27 npm run build
```

## Use in a Blazor application

```bash
dotnet add package LegacyBlazorJs --version 8.0.27
```

Replace the official script in the Blazor Web App's `Components/App.razor` with the required profile:

```html
<!-- <script src="_framework/blazor.web.js"></script> -->
<script src="_content/LegacyBlazorJs/blazor.web.es2015.js"></script>
```

Because the package is a Razor Class Library with static web assets, consumers do not need to copy the JavaScript into the application.

## Smoke testing

`.github/workflows/smoke-test.yml` installs the generated NuGet package into an unmodified Blazor Server template application and loads each generated JavaScript file in turn. The C# smoke test project creates the app, starts Blazor Server, launches Playwright Chromium, and verifies that clicking the Counter button updates the count without browser errors.

This proves that every generated file remains functional in current Chromium. It does not prove compatibility with the historical browsers named by each profile.

After building a package, run the smoke tests locally with:

```bash
dotnet test tests/PlaywrightTest/PlaywrightTest.csproj
```

The test project resolves the latest `LegacyBlazorJs.*.nupkg` from `artifacts/packages` automatically. Set `PACKAGE_VERSION` to force a specific package version or `SMOKE_TEST_PROFILE` to run a single profile, for example `SMOKE_TEST_PROFILE=es2015 dotnet test tests/PlaywrightTest/PlaywrightTest.csproj`.

## Automated publishing

`.github/workflows/publish-latest.yml` checks every configured .NET major each week, builds its latest stable tag, runs all smoke tests, and publishes the package to NuGet.org with `dotnet nuget push --skip-duplicate`.

Configure the repository secret `NUGET_API_KEY` before publishing. Run the workflow manually with `publish=false` first to inspect its artifacts before enabling publication.

## License

The automation in this repository is licensed under the MIT License. Generated JavaScript is derived from Microsoft's `dotnet/aspnetcore` repository. Review the upstream license, trademark, and redistribution requirements before publishing packages. Each package includes `THIRD-PARTY-NOTICES.txt`, the upstream license, and a `build-manifest.json` recording the exact upstream tag.
