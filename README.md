# LegacyBlazorJs

LegacyBlazorJs rebuilds the official ASP.NET Core `blazor.web.js` for multiple JavaScript language targets and publishes the results as a Razor Class Library NuGet package.

## How it works

1. For every .NET major listed in `config/majors.json`, resolve the latest stable `dotnet/aspnetcore` tag through the GitHub API.
2. Clone that tag and build the upstream `Microsoft.AspNetCore.Components.Web.JS.npmproj`, including its linked JSInterop and SignalR dependencies.
3. Rebuild `src/Components/Web.JS` once per profile after changing the upstream TypeScript and webpack/Rollup Terser targets.
4. Write the generated scripts to `dist/<tag>`, mirror them into the Razor Class Library's `wwwroot`, and pack `LegacyBlazorJs` using the upstream tag without its `v` prefix, for example `v8.0.27` becomes package version `8.0.27`.

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
| `blazor.web.es2015.js` | Chrome 51+, Edge 15+, Firefox 54+, Safari 10+ | ES2015 |
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
- .NET 8 SDK for the Playwright harness
- .NET SDKs for the majors listed in `config/majors.json`

```bash
npm ci
npm run build
```

This resolves and builds the latest stable tag for every major listed in `config/majors.json`, writes the generated browser-specific scripts under `dist/<tag>`, and creates one `LegacyBlazorJs.<version>.nupkg` per upstream tag under `artifacts/packages`. To limit the run to specific majors, pass them after `--`:

```bash
npm run build -- 8 10
```

Set an explicit tag for a reproducible historical build:

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

`.github/workflows/smoke-test.yml` builds the generated NuGet package, then runs Playwright smoke tests against the `ES2020` through `ES2022` outputs in both `Blazor Server` and `Blazor WebAssembly` template apps. Each fixture app is retargeted to the tested upstream major at runtime, for example package `10.0.x` is exercised with `net10.0`. Each profile is validated against its minimum intended Chromium major by downloading a fixed historical Chromium snapshot sourced from `vikyd/chromium-history-version-position`, for example `es2020 -> Chromium 80`, `es2021 -> Chromium 85`, and `es2022 -> Chromium 94`.

The C# smoke test project copies `tests/BlazorServerApp` or `tests/BlazorWasmApp`, replaces the target framework and script placeholders, starts the app, launches the pinned Chromium build, and verifies that clicking the Counter button updates the count without browser errors.

After building package artifacts, run the compatibility matrix and refresh this README with:

```bash
npm run test:compat:update-readme
```

To run only the smoke test project directly, use:

```bash
dotnet test tests/PlaywrightTest/PlaywrightTest.csproj
```

The test project resolves the latest `LegacyBlazorJs.*.nupkg` from `artifacts/packages` automatically. Set `PACKAGE_VERSION` to force a specific package version, `SMOKE_TEST_PROFILE` to run a single profile, `SMOKE_TEST_HOSTING_MODEL` to switch between `Server` and `WebAssembly`, or `SMOKE_TEST_CHROMIUM_DOWNLOAD_URL`, `SMOKE_TEST_CHROMIUM_VERSION`, and `SMOKE_TEST_CHROMIUM_EXECUTABLE_RELATIVE_PATH` to force a specific Chromium binary.

### ES20x compatibility results

<!-- compatibility-results:start -->
Run `npm run test:compat:update-readme` after building packages to populate this section.
<!-- compatibility-results:end -->

## Automated publishing

`.github/workflows/publish-latest.yml` reads `config/majors.json`, builds every configured .NET major in one run, executes the ES20x compatibility matrix, and publishes the resulting packages to NuGet.org with `dotnet nuget push --skip-duplicate`.

Configure the repository secret `NUGET_API_KEY` before publishing. Run the workflow manually with `publish=false` first to inspect its artifacts before enabling publication.

## License

The automation in this repository is licensed under the MIT License. Generated JavaScript is derived from Microsoft's `dotnet/aspnetcore` repository. Review the upstream license, trademark, and redistribution requirements before publishing packages. Each package includes `THIRD-PARTY-NOTICES.txt`, the upstream license, and a `build-manifest.json` recording the exact upstream tag.
