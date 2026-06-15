using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Playwright;
using Xunit;

[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace PlaywrightTest;

public sealed class SmokeTests
{
    [Theory]
    [MemberData(nameof(GetProfiles))]
    public async Task GeneratedScript_MakesCounterInteractive(string profile)
    {
        var repositoryRoot = TestEnvironment.RepositoryRoot;
        var packageVersion = TestEnvironment.PackageVersion;
        var hostingModel = TestEnvironment.HostingModel;

        await using var harness = await SmokeAppHarness.CreateAsync(repositoryRoot, profile, packageVersion, hostingModel);
        await harness.StartAsync();

        await using var browserHarness = await BrowserHarness.CreateAsync();
        await browserHarness.AssertCounterInteractiveAsync(harness.BaseUri, profile, hostingModel);
    }

    public static IEnumerable<object[]> GetProfiles()
    {
        var configuredProfile = Environment.GetEnvironmentVariable("SMOKE_TEST_PROFILE");
        if (!string.IsNullOrWhiteSpace(configuredProfile))
        {
            yield return [configuredProfile];
            yield break;
        }

        var targetsPath = Path.Combine(TestEnvironment.RepositoryRoot, "config", "targets.json");
        using var document = JsonDocument.Parse(File.ReadAllText(targetsPath));
        foreach (var property in document.RootElement.EnumerateObject())
        {
            yield return [property.Name];
        }
    }
}

internal static class TestEnvironment
{
    public static string RepositoryRoot { get; } = FindRepositoryRoot();

    private static readonly Lazy<string> PackageVersionValue = new(ResolvePackageVersion);

    public static string PackageVersion => PackageVersionValue.Value;

    public static string PackageSourceDirectory => Path.Combine(RepositoryRoot, "artifacts", "packages");

    public static string WorkDirectory => Path.Combine(RepositoryRoot, ".work");

    public static string HostingModel => ResolveHostingModel();

    public static string BlazorServerAppTemplateDirectory => Path.Combine(RepositoryRoot, "tests", "BlazorServerApp");

    public static string BlazorWasmAppTemplateDirectory => Path.Combine(RepositoryRoot, "tests", "BlazorWasmApp");

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "package.json")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate the repository root from the test output directory.");
    }

    private static string ResolvePackageVersion()
    {
        var explicitVersion = Environment.GetEnvironmentVariable("PACKAGE_VERSION");
        if (!string.IsNullOrWhiteSpace(explicitVersion))
        {
            return explicitVersion;
        }

        var packageDirectory = new DirectoryInfo(PackageSourceDirectory);
        if (!packageDirectory.Exists)
        {
            throw new DirectoryNotFoundException(
                $"Package directory '{PackageSourceDirectory}' does not exist. Build the package before running smoke tests.");
        }

        var package = packageDirectory
            .GetFiles("LegacyBlazorJs.*.nupkg")
            .OrderByDescending(file => file.LastWriteTimeUtc)
            .FirstOrDefault();

        if (package is null)
        {
            throw new FileNotFoundException(
                $"No LegacyBlazorJs package was found in '{PackageSourceDirectory}'. Build the package before running smoke tests.");
        }

        return Regex.Match(package.Name, @"^LegacyBlazorJs\.(.+)\.nupkg$").Groups[1].Value;
    }

    private static string ResolveHostingModel()
    {
        var configured = Environment.GetEnvironmentVariable("SMOKE_TEST_HOSTING_MODEL");
        if (string.IsNullOrWhiteSpace(configured))
        {
            return "Server";
        }

        return configured switch
        {
            "Server" => configured,
            "WebAssembly" => configured,
            _ => throw new InvalidOperationException(
                $"Unsupported SMOKE_TEST_HOSTING_MODEL value '{configured}'. Expected 'Server' or 'WebAssembly'.")
        };
    }

    public static string ResolveTargetFrameworkMoniker(string packageVersion)
    {
        var match = Regex.Match(packageVersion, @"^(?<major>\d+)\.");
        if (!match.Success)
        {
            throw new InvalidOperationException(
                $"Could not determine the target framework from package version '{packageVersion}'.");
        }

        return $"net{match.Groups["major"].Value}.0";
    }

    public static string ResolveScriptProfile(string requestedProfile)
    {
        var availableProfiles = GetAvailableScriptProfiles();
        if (availableProfiles.Contains(requestedProfile))
        {
            return requestedProfile;
        }

        if (string.Equals(requestedProfile, "es5", StringComparison.Ordinal))
        {
            var ieFallback = availableProfiles
                .Where(profile => profile.StartsWith("ie", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(profile => profile, StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault();
            if (ieFallback is not null)
            {
                return ieFallback;
            }
        }

        throw new InvalidOperationException(
            $"No generated script matching profile '{requestedProfile}' was found in '{PackageSourceDirectory}'. Available profiles: {string.Join(", ", availableProfiles)}");
    }

    private static IReadOnlyList<string> GetAvailableScriptProfiles()
    {
        var packageDirectory = new DirectoryInfo(PackageSourceDirectory);
        var package = packageDirectory
            .GetFiles("LegacyBlazorJs.*.nupkg")
            .OrderByDescending(file => file.LastWriteTimeUtc)
            .FirstOrDefault();

        if (package is null)
        {
            throw new FileNotFoundException(
                $"No LegacyBlazorJs package was found in '{PackageSourceDirectory}'. Build the package before running smoke tests.");
        }

        using var archive = ZipFile.OpenRead(package.FullName);
        return archive.Entries
            .Select(entry => Regex.Match(entry.FullName, @"^staticwebassets/blazor\.web\.(.+)\.js$"))
            .Where(match => match.Success)
            .Select(match => match.Groups[1].Value)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(profile => profile, StringComparer.Ordinal)
            .ToArray();
    }
}

internal sealed class SmokeAppHarness : IAsyncDisposable
{
    private static readonly HttpClient HttpClient = new() { Timeout = TimeSpan.FromSeconds(2) };
    private static readonly TimeSpan ServerReadyTimeout = TimeSpan.FromSeconds(120);
    private static readonly Uri ReadyPath = new("/counter", UriKind.Relative);

    private readonly string _rootDirectory;
    private readonly string _appDirectory;
    private readonly string _projectPath;
    private readonly string _profile;
    private readonly string _packageVersion;
    private readonly string _targetFramework;
    private readonly string _hostingModel;
    private readonly string _scriptProfile;
    private readonly Uri _baseUri;
    private CapturedProcess? _serverProcess;

    private SmokeAppHarness(
        string rootDirectory,
        string appDirectory,
        string projectPath,
        string profile,
        string scriptProfile,
        string packageVersion,
        string targetFramework,
        string hostingModel,
        Uri baseUri)
    {
        _rootDirectory = rootDirectory;
        _appDirectory = appDirectory;
        _projectPath = projectPath;
        _profile = profile;
        _scriptProfile = scriptProfile;
        _packageVersion = packageVersion;
        _targetFramework = targetFramework;
        _hostingModel = hostingModel;
        _baseUri = baseUri;
    }

    public Uri BaseUri => _baseUri;

    public static async Task<SmokeAppHarness> CreateAsync(
        string repositoryRoot,
        string profile,
        string packageVersion,
        string hostingModel)
    {
        var rootDirectory = Path.Combine(
            repositoryRoot,
            ".work",
            $"smoke-{hostingModel.ToLowerInvariant()}-{profile}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(rootDirectory);

        var templateDirectory = GetTemplateDirectory(hostingModel);
        CopyDirectory(templateDirectory, rootDirectory);
        var appDirectory = rootDirectory;
        var projectPath = GetProjectPath(appDirectory, hostingModel);
        var port = GetAvailablePort();
        var baseUri = new Uri($"http://127.0.0.1:{port}");
        var targetFramework = TestEnvironment.ResolveTargetFrameworkMoniker(packageVersion);
        var scriptProfile = TestEnvironment.ResolveScriptProfile(profile);
        var harness = new SmokeAppHarness(
            rootDirectory,
            appDirectory,
            projectPath,
            profile,
            scriptProfile,
            packageVersion,
            targetFramework,
            hostingModel,
            baseUri);
        await harness.InitializeAsync();
        return harness;
    }

    public async Task StartAsync()
    {
        _serverProcess = CapturedProcess.Start(
            "dotnet",
            [
                "run",
                "--project", _projectPath,
                "--urls", _baseUri.ToString(),
                "--no-launch-profile",
                "--no-restore"
            ],
            _appDirectory,
            new Dictionary<string, string>
            {
                ["ASPNETCORE_ENVIRONMENT"] = "Development"
            });

        var readyCts = new CancellationTokenSource(ServerReadyTimeout);
        while (!readyCts.IsCancellationRequested)
        {
            if (_serverProcess.Process.HasExited)
            {
                throw new InvalidOperationException(
                    $"Blazor {_hostingModel} app exited before it became ready.{Environment.NewLine}{await _serverProcess.GetCombinedOutputAsync()}");
            }

            try
            {
                using var response = await HttpClient.GetAsync(new Uri(_baseUri, ReadyPath), readyCts.Token);
                if (response.IsSuccessStatusCode)
                {
                    return;
                }
            }
            catch (HttpRequestException)
            {
            }
            catch (TaskCanceledException)
            {
                if (readyCts.IsCancellationRequested)
                {
                    break;
                }
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(1), readyCts.Token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        await DisposeServerAsync();
        throw new TimeoutException($"Blazor {_hostingModel} app did not become ready at {_baseUri} within {ServerReadyTimeout.TotalSeconds} seconds.");
    }

    public async ValueTask DisposeAsync()
    {
        await DisposeServerAsync();

        try
        {
            if (Directory.Exists(_rootDirectory))
            {
                Directory.Delete(_rootDirectory, recursive: true);
            }
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    private async Task InitializeAsync()
    {
        ReplaceProjectPlaceholders();
        NormalizeLegacyBlazorReference();

        WriteNuGetConfig(_appDirectory);

        await ProcessRunner.RunCheckedAsync(
            "dotnet",
            [
                "restore", _projectPath
            ],
            _appDirectory);

        ReplaceFrameworkScript(GetScriptHostPath(_appDirectory, _hostingModel));
    }

    private static void WriteNuGetConfig(string directory)
    {
        var nugetConfigPath = Path.Combine(directory, "NuGet.config");
        var contents = $"""
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="local" value="{TestEnvironment.PackageSourceDirectory.Replace("\\", "/")}" />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
  </packageSources>
</configuration>
""";
        File.WriteAllText(nugetConfigPath, contents);
    }

    private void NormalizeLegacyBlazorReference()
    {
        var contents = File.ReadAllText(_projectPath);
        const string projectReference = "<ProjectReference Include=\"..\\..\\src\\LegacyBlazorJs\\LegacyBlazorJs.csproj\" />";
        var packageReference = $"<PackageReference Include=\"LegacyBlazorJs\" Version=\"{_packageVersion}\" />";
        var updated = contents.Replace(projectReference, packageReference, StringComparison.Ordinal);

        if (contents == updated && !contents.Contains("<PackageReference Include=\"LegacyBlazorJs\"", StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Could not normalize the LegacyBlazorJs reference in '{_projectPath}'.");
        }

        if (!StringComparer.Ordinal.Equals(contents, updated))
        {
            File.WriteAllText(_projectPath, updated);
        }
    }

    private void ReplaceProjectPlaceholders()
    {
        foreach (var projectPath in Directory.EnumerateFiles(_appDirectory, "*.csproj", SearchOption.AllDirectories))
        {
            var contents = File.ReadAllText(projectPath);
            var updated = contents
                .Replace("__TARGET_FRAMEWORK__", _targetFramework, StringComparison.Ordinal)
                .Replace("__ASPNETCORE_VERSION__", _packageVersion, StringComparison.Ordinal);

            if (!StringComparer.Ordinal.Equals(contents, updated))
            {
                File.WriteAllText(projectPath, updated);
            }
        }
    }

    private void ReplaceFrameworkScript(string appRazorPath)
    {
        var contents = File.ReadAllText(appRazorPath);
        var scriptName = _hostingModel switch
        {
            "Server" => $"blazor.web.{_scriptProfile}.js",
            "WebAssembly" => $"blazor.webassembly.{_scriptProfile}.js",
            _ => throw new InvalidOperationException($"Unsupported hosting model '{_hostingModel}'.")
        };
        var replacement = $"<script src=\"_content/LegacyBlazorJs/{scriptName}\"></script>";
        var updated = contents.Replace("__LEGACY_BLAZOR_SCRIPT__", replacement, StringComparison.Ordinal);

        if (ReferenceEquals(contents, updated) || contents == updated)
        {
            throw new InvalidOperationException($"Could not replace the script placeholder in '{appRazorPath}'.");
        }

        File.WriteAllText(appRazorPath, updated);
    }

    private static string GetTemplateDirectory(string hostingModel) =>
        hostingModel switch
        {
            "Server" => TestEnvironment.BlazorServerAppTemplateDirectory,
            "WebAssembly" => TestEnvironment.BlazorWasmAppTemplateDirectory,
            _ => throw new InvalidOperationException($"Unsupported hosting model '{hostingModel}'.")
        };

    private static string GetScriptHostPath(string appDirectory, string hostingModel) =>
        hostingModel switch
        {
            "Server" => Path.Combine(appDirectory, "Components", "App.razor"),
            "WebAssembly" => Path.Combine(appDirectory, "wwwroot", "index.html"),
            _ => throw new InvalidOperationException($"Unsupported hosting model '{hostingModel}'.")
        };

    private static string GetProjectPath(string appDirectory, string hostingModel) =>
        hostingModel switch
        {
            "Server" => Path.Combine(appDirectory, "BlazorServerApp.csproj"),
            "WebAssembly" => Path.Combine(appDirectory, "BlazorWasmApp.csproj"),
            _ => throw new InvalidOperationException($"Unsupported hosting model '{hostingModel}'.")
        };

    private static void CopyDirectory(string sourceDirectory, string destinationDirectory)
    {
        var source = new DirectoryInfo(sourceDirectory);
        if (!source.Exists)
        {
            throw new DirectoryNotFoundException($"Smoke app template directory '{sourceDirectory}' does not exist.");
        }

        Directory.CreateDirectory(destinationDirectory);

        foreach (var directory in source.GetDirectories("*", SearchOption.AllDirectories))
        {
            var relativePath = Path.GetRelativePath(sourceDirectory, directory.FullName);
            Directory.CreateDirectory(Path.Combine(destinationDirectory, relativePath));
        }

        foreach (var file in source.GetFiles("*", SearchOption.AllDirectories))
        {
            var relativePath = Path.GetRelativePath(sourceDirectory, file.FullName);
            var targetPath = Path.Combine(destinationDirectory, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
            file.CopyTo(targetPath, overwrite: true);
        }
    }

    private async Task DisposeServerAsync()
    {
        if (_serverProcess is null)
        {
            return;
        }

        try
        {
            if (!_serverProcess.Process.HasExited)
            {
                _serverProcess.Process.Kill(entireProcessTree: true);
            }
        }
        catch (InvalidOperationException)
        {
        }

        await _serverProcess.DisposeAsync();
        _serverProcess = null;
    }

    private static int GetAvailablePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }
}

internal sealed class BrowserHarness : IAsyncDisposable
{
    private readonly PlaywrightBrowserHarness? _playwrightHarness;
    private readonly LegacyChromiumHarness? _legacyHarness;

    private BrowserHarness(PlaywrightBrowserHarness playwrightHarness)
    {
        _playwrightHarness = playwrightHarness;
    }

    private BrowserHarness(LegacyChromiumHarness legacyHarness)
    {
        _legacyHarness = legacyHarness;
    }

    public static async Task<BrowserHarness> CreateAsync()
    {
        var launchConfiguration = await BrowserBinaryResolver.ResolveAsync();
        if (!string.IsNullOrWhiteSpace(launchConfiguration.ExecutablePath))
        {
            return new BrowserHarness(await LegacyChromiumHarness.CreateAsync(launchConfiguration.ExecutablePath!));
        }

        return new BrowserHarness(await PlaywrightBrowserHarness.CreateAsync(launchConfiguration.ExecutablePath));
    }

    public async Task AssertCounterInteractiveAsync(Uri baseUri, string profile, string hostingModel)
    {
        if (_legacyHarness is not null)
        {
            await _legacyHarness.AssertCounterInteractiveAsync(baseUri, profile, hostingModel);
            return;
        }

        await _playwrightHarness!.AssertCounterInteractiveAsync(baseUri, profile, hostingModel);
    }

    public async ValueTask DisposeAsync()
    {
        if (_legacyHarness is not null)
        {
            await _legacyHarness.DisposeAsync();
            return;
        }

        await _playwrightHarness!.DisposeAsync();
    }
}

internal sealed class PlaywrightBrowserHarness : IAsyncDisposable
{
    private readonly IPlaywright _playwright;
    private readonly IBrowser _browser;

    private PlaywrightBrowserHarness(IPlaywright playwright, IBrowser browser)
    {
        _playwright = playwright;
        _browser = browser;
    }

    public static async Task<PlaywrightBrowserHarness> CreateAsync(string? executablePath)
    {
        var playwright = await Playwright.CreateAsync();
        try
        {
            var options = new BrowserTypeLaunchOptions
            {
                Headless = true,
                ExecutablePath = executablePath
            };

            if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                options.Args =
                [
                    "--no-sandbox"
                ];
            }

            var browser = await playwright.Chromium.LaunchAsync(options);
            return new PlaywrightBrowserHarness(playwright, browser);
        }
        catch
        {
            playwright.Dispose();
            throw;
        }
    }

    public async Task AssertCounterInteractiveAsync(Uri baseUri, string profile, string hostingModel)
    {
        await using var context = await _browser.NewContextAsync();
        var page = await context.NewPageAsync();
        var errors = new List<string>();
        var failedResponses = new List<string>();

        page.PageError += (_, error) => errors.Add(error);
        page.Response += (_, response) =>
        {
            if (response.Ok)
            {
                return;
            }

            var url = response.Url;
            if (url.EndsWith("/favicon.ico", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            failedResponses.Add($"{response.Status} {url}");
        };
        page.Console += (_, message) =>
        {
            if (message.Type == "error" &&
                !string.Equals(
                    message.Text,
                    "Failed to load resource: the server responded with a status of 404 (Not Found)",
                    StringComparison.Ordinal))
            {
                errors.Add(message.Text);
            }
        };

        await page.GotoAsync(new Uri(baseUri, "/counter").ToString(), new PageGotoOptions
        {
            WaitUntil = WaitUntilState.DOMContentLoaded
        });

        var button = page.GetByRole(AriaRole.Button, new() { Name = "Click me" });
        var updatedCount = page.GetByText("Current count: 1");

        var interactionCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        for (var attempt = 0; attempt < 30 && !interactionCts.IsCancellationRequested; attempt++)
        {
            if (errors.Count > 0)
            {
                break;
            }

            if (await updatedCount.IsVisibleAsync())
            {
                break;
            }

            if (await button.IsVisibleAsync())
            {
                await button.ClickAsync();
            }

            try
            {
                await Task.Delay(500, interactionCts.Token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        if (errors.Count > 0)
        {
            throw new InvalidOperationException(
                $"{hostingModel} {profile} emitted browser errors:{Environment.NewLine}{string.Join(Environment.NewLine, errors)}");
        }

        if (failedResponses.Count > 0)
        {
            throw new InvalidOperationException(
                $"{hostingModel} {profile} returned failing HTTP responses:{Environment.NewLine}{string.Join(Environment.NewLine, failedResponses)}");
        }

        try
        {
            await updatedCount.WaitForAsync(new LocatorWaitForOptions { Timeout = 15_000 });
        }
        catch (TimeoutException)
        {
            throw new TimeoutException($"{hostingModel} {profile} did not become interactive within the allotted time.");
        }
        finally
        {
            await page.CloseAsync();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _browser.DisposeAsync();
        _playwright.Dispose();
    }
}

internal sealed class LegacyChromiumHarness : IAsyncDisposable
{
    private static readonly Regex DevToolsListeningPattern = new(@"DevTools listening on (?<url>ws://\S+)", RegexOptions.Compiled);
    private readonly Process _process;
    private readonly string _profileDirectory;
    private readonly ClientWebSocket _socket;
    private string _targetId;
    private string _sessionId;
    private Task _receiveLoopTask;
    private readonly CancellationTokenSource _receiveLoopCancellation = new();
    private readonly Dictionary<int, TaskCompletionSource<JsonElement>> _pending = [];
    private readonly object _pendingLock = new();
    private readonly List<string> _errors = [];
    private readonly List<string> _failedResponses = [];
    private int _messageId;

    private LegacyChromiumHarness(
        Process process,
        string profileDirectory,
        ClientWebSocket socket,
        string targetId,
        string sessionId,
        Task receiveLoopTask)
    {
        _process = process;
        _profileDirectory = profileDirectory;
        _socket = socket;
        _targetId = targetId;
        _sessionId = sessionId;
        _receiveLoopTask = receiveLoopTask;
    }

    public static async Task<LegacyChromiumHarness> CreateAsync(string executablePath)
    {
        var profileDirectory = Path.Combine(TestEnvironment.WorkDirectory, "browser-profiles", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(profileDirectory);

        var process = new Process
        {
            StartInfo = ProcessRunner.CreateStartInfo(
                executablePath,
                BuildBrowserArguments(profileDirectory),
                TestEnvironment.RepositoryRoot,
                redirectOutput: true)
        };

        if (!process.Start())
        {
            throw new InvalidOperationException($"Failed to start legacy Chromium '{executablePath}'.");
        }

        var endpoint = await WaitForDevToolsEndpointAsync(process);
        var socket = new ClientWebSocket();
        await socket.ConnectAsync(new Uri(endpoint), CancellationToken.None);

        var harness = new LegacyChromiumHarness(
            process,
            profileDirectory,
            socket,
            targetId: string.Empty,
            sessionId: string.Empty,
            receiveLoopTask: Task.CompletedTask);

        harness._receiveLoopTask = harness.RunReceiveLoopAsync();
        (harness._targetId, harness._sessionId) = await harness.AttachToTargetAsync();
        return harness;
    }

    public async Task AssertCounterInteractiveAsync(Uri baseUri, string profile, string hostingModel)
    {
        await SendCommandAsync("Target.activateTarget", new { targetId = _targetId });
        await SendCommandAsync("Page.enable", sessionId: _sessionId);
        await SendCommandAsync("Runtime.enable", sessionId: _sessionId);
        await SendCommandAsync("Log.enable", sessionId: _sessionId);
        await SendCommandAsync("Network.enable", sessionId: _sessionId);
        await TrySendCommandAsync("Page.bringToFront", sessionId: _sessionId);
        await TrySendCommandAsync("Emulation.setFocusEmulationEnabled", new { enabled = true }, _sessionId);

        await SendCommandAsync(
            "Page.navigate",
            new { url = new Uri(baseUri, "/counter").ToString() },
            _sessionId);

        await WaitForConditionAsync(
            "document.readyState === 'complete' && document.querySelector('button') !== null && document.querySelector('[role=\"status\"]') !== null",
            TimeSpan.FromSeconds(30),
            "counter UI to render");

        using var interactionCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        while (!interactionCts.IsCancellationRequested)
        {
            if (_errors.Count > 0 || _failedResponses.Count > 0)
            {
                break;
            }

            var countText = await EvaluateStringAsync("document.querySelector('[role=\"status\"]')?.textContent ?? ''");
            if (string.Equals(countText?.Trim(), "Current count: 1", StringComparison.Ordinal))
            {
                return;
            }

            await EnsurePageReadyForInputAsync();
            await ClickButtonAsync();

            try
            {
                await Task.Delay(500, interactionCts.Token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        if (_errors.Count > 0)
        {
            throw new InvalidOperationException(
                $"{hostingModel} {profile} emitted browser errors:{Environment.NewLine}{string.Join(Environment.NewLine, _errors)}");
        }

        if (_failedResponses.Count > 0)
        {
            throw new InvalidOperationException(
                $"{hostingModel} {profile} returned failing HTTP responses:{Environment.NewLine}{string.Join(Environment.NewLine, _failedResponses)}");
        }

        throw new TimeoutException(
            $"{hostingModel} {profile} did not become interactive within the allotted time.{Environment.NewLine}{await CaptureDiagnosticsAsync()}");
    }

    public async ValueTask DisposeAsync()
    {
        _receiveLoopCancellation.Cancel();

        if (_socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
        {
            try
            {
                await _socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "disposing", CancellationToken.None);
            }
            catch
            {
            }
        }

        _socket.Dispose();

        try
        {
            if (!_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
            }
        }
        catch (InvalidOperationException)
        {
        }

        _process.Dispose();

        try
        {
            await _receiveLoopTask;
        }
        catch
        {
        }

        try
        {
            if (Directory.Exists(_profileDirectory))
            {
                Directory.Delete(_profileDirectory, recursive: true);
            }
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    private static IReadOnlyList<string> BuildBrowserArguments(string profileDirectory)
    {
        var arguments = new List<string>
        {
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--remote-debugging-port=0",
            $"--user-data-dir={profileDirectory}",
            "about:blank"
        };

        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("DISPLAY")))
        {
            arguments.Insert(0, "--headless");
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            arguments.Add("--no-sandbox");
        }

        return arguments;
    }

    private static async Task<string> WaitForDevToolsEndpointAsync(Process process)
    {
        var endpointTcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);

        void TrySetEndpoint(string? line)
        {
            if (line is null)
            {
                return;
            }

            var match = DevToolsListeningPattern.Match(line);
            if (match.Success)
            {
                endpointTcs.TrySetResult(match.Groups["url"].Value);
            }
        }

        process.OutputDataReceived += (_, args) => TrySetEndpoint(args.Data);
        process.ErrorDataReceived += (_, args) => TrySetEndpoint(args.Data);
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        await using var _ = cts.Token.Register(() => endpointTcs.TrySetCanceled(cts.Token));

        try
        {
            return await endpointTcs.Task;
        }
        catch (TaskCanceledException)
        {
            throw new TimeoutException("Timed out waiting for the legacy Chromium DevTools endpoint.");
        }
    }

    private async Task<(string TargetId, string SessionId)> AttachToTargetAsync()
    {
        var target = await SendCommandAsync("Target.createTarget", new { url = "about:blank" });
        var targetId = target.GetProperty("targetId").GetString()
            ?? throw new InvalidOperationException("CDP did not return a target id.");

        var attached = await SendCommandAsync("Target.attachToTarget", new { targetId, flatten = true });
        var sessionId = attached.GetProperty("sessionId").GetString()
            ?? throw new InvalidOperationException("CDP did not return a session id.");
        return (targetId, sessionId);
    }

    private async Task WaitForConditionAsync(string expression, TimeSpan timeout, string description)
    {
        using var cts = new CancellationTokenSource(timeout);
        while (!cts.IsCancellationRequested)
        {
            if (_errors.Count > 0 || _failedResponses.Count > 0)
            {
                return;
            }

            if (await EvaluateBooleanAsync(expression))
            {
                return;
            }

            try
            {
                await Task.Delay(500, cts.Token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        throw new TimeoutException(
            $"Legacy Chromium timed out waiting for {description}: {expression}{Environment.NewLine}{await CaptureDiagnosticsAsync()}");
    }

    private async Task EnsurePageReadyForInputAsync()
    {
        await TrySendCommandAsync("Page.bringToFront", sessionId: _sessionId);
        await EvaluateAsync(
            """
            (() => {
              const button = document.querySelector('button');
              if (!button) {
                return false;
              }

              button.scrollIntoView({ block: 'center', inline: 'center' });
              button.focus();
              return true;
            })()
            """);
    }

    private async Task ClickButtonAsync()
    {
        var buttonCenter = await EvaluateAsync(
            """
            (() => {
              const button = document.querySelector('button');
              if (!button) {
                return null;
              }

              button.scrollIntoView({ block: 'center', inline: 'center' });
              button.focus();
              const rect = button.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
                visible: rect.width > 0 && rect.height > 0,
                hitTag: hit ? hit.tagName : null
              };
            })()
            """);

        if (buttonCenter.ValueKind == JsonValueKind.Null)
        {
            return;
        }

        var x = buttonCenter.GetProperty("x").GetDouble();
        var y = buttonCenter.GetProperty("y").GetDouble();

        await SendCommandAsync(
            "Input.dispatchMouseEvent",
            new { type = "mouseMoved", x, y, button = "none", buttons = 0, clickCount = 0 },
            _sessionId);
        await SendCommandAsync(
            "Input.dispatchMouseEvent",
            new { type = "mousePressed", x, y, button = "left", buttons = 1, clickCount = 1 },
            _sessionId);
        await SendCommandAsync(
            "Input.dispatchMouseEvent",
            new { type = "mouseReleased", x, y, button = "left", buttons = 0, clickCount = 1 },
            _sessionId);
        await EvaluateAsync(
            """
            (() => {
              const button = document.querySelector('button');
              if (!button) {
                return false;
              }

              button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              return true;
            })()
            """);
    }

    private async Task<bool> EvaluateBooleanAsync(string expression)
    {
        var value = await EvaluateAsync(expression);
        return value.ValueKind == JsonValueKind.True ||
            (value.ValueKind == JsonValueKind.False ? false : value.GetBoolean());
    }

    private async Task<string?> EvaluateStringAsync(string expression)
    {
        var value = await EvaluateAsync(expression);
        return value.ValueKind == JsonValueKind.Null ? null : value.GetString();
    }

    private async Task<JsonElement> EvaluateAsync(string expression)
    {
        var response = await SendCommandAsync(
            "Runtime.evaluate",
            new
            {
                expression,
                awaitPromise = true,
                returnByValue = true
            },
            _sessionId);

        if (response.TryGetProperty("exceptionDetails", out var exceptionDetails))
        {
            throw new InvalidOperationException(
                $"Legacy Chromium evaluation failed: {exceptionDetails.GetRawText()}");
        }

        if (response.GetProperty("result").TryGetProperty("value", out var value))
        {
            return value;
        }

        return default;
    }

    private async Task<JsonElement> SendCommandAsync(string method, object? parameters = null, string? sessionId = null)
    {
        var id = Interlocked.Increment(ref _messageId);
        var payload = sessionId is null
            ? JsonSerializer.Serialize(new { id, method, @params = parameters ?? new { } })
            : JsonSerializer.Serialize(new { id, method, @params = parameters ?? new { }, sessionId });

        var completionSource = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_pendingLock)
        {
            _pending[id] = completionSource;
        }

        var bytes = Encoding.UTF8.GetBytes(payload);
        await _socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
        return await completionSource.Task;
    }

    private async Task<JsonElement?> TrySendCommandAsync(string method, object? parameters = null, string? sessionId = null)
    {
        try
        {
            return await SendCommandAsync(method, parameters, sessionId);
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    private async Task<string> CaptureDiagnosticsAsync()
    {
        var diagnostics = await EvaluateAsync(
            """
            (() => {
              const button = document.querySelector('button');
              const status = document.querySelector('[role="status"]');
              const scripts = Array.from(document.scripts).map(script => script.src).filter(Boolean);
              const rect = button ? button.getBoundingClientRect() : null;
              const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;

              return {
                readyState: document.readyState,
                href: location.href,
                userAgent: navigator.userAgent,
                statusText: status ? status.textContent : null,
                buttonText: button ? button.textContent : null,
                buttonDisabled: button ? button.disabled : null,
                activeElement: document.activeElement ? document.activeElement.tagName : null,
                buttonRect: rect ? {
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height
                } : null,
                centerHitTag: hit ? hit.tagName : null,
                scripts,
                htmlSnippet: document.body ? document.body.innerHTML.slice(0, 1500) : null
              };
            })()
            """);

        var builder = new StringBuilder();
        builder.AppendLine("Legacy Chromium diagnostics:");
        builder.AppendLine(diagnostics.GetRawText());

        if (_errors.Count > 0)
        {
            builder.AppendLine("Collected browser errors:");
            foreach (var error in _errors)
            {
                builder.AppendLine(error);
            }
        }

        if (_failedResponses.Count > 0)
        {
            builder.AppendLine("Collected failed responses:");
            foreach (var failedResponse in _failedResponses)
            {
                builder.AppendLine(failedResponse);
            }
        }

        return builder.ToString();
    }

    private async Task RunReceiveLoopAsync()
    {
        var buffer = new byte[16 * 1024];
        var builder = new StringBuilder();

        while (!_receiveLoopCancellation.IsCancellationRequested && _socket.State == WebSocketState.Open)
        {
            var result = await _socket.ReceiveAsync(buffer, _receiveLoopCancellation.Token);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                return;
            }

            builder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
            if (!result.EndOfMessage)
            {
                continue;
            }

            using var document = JsonDocument.Parse(builder.ToString());
            builder.Clear();
            HandleMessage(document.RootElement.Clone());
        }
    }

    private void HandleMessage(JsonElement message)
    {
        if (message.TryGetProperty("id", out var idElement))
        {
            var id = idElement.GetInt32();
            TaskCompletionSource<JsonElement>? completionSource;
            lock (_pendingLock)
            {
                _pending.TryGetValue(id, out completionSource);
                _pending.Remove(id);
            }

            if (completionSource is null)
            {
                return;
            }

            if (message.TryGetProperty("error", out var error))
            {
                completionSource.TrySetException(
                    new InvalidOperationException(error.GetProperty("message").GetString()));
                return;
            }

            completionSource.TrySetResult(message.GetProperty("result").Clone());
            return;
        }

        if (!message.TryGetProperty("method", out var methodElement))
        {
            return;
        }

        switch (methodElement.GetString())
        {
            case "Runtime.exceptionThrown":
                _errors.Add(message.GetProperty("params").GetProperty("exceptionDetails").GetRawText());
                break;
            case "Log.entryAdded":
                var entry = message.GetProperty("params").GetProperty("entry");
                var text = entry.GetProperty("text").GetString() ?? entry.GetRawText();
                if (string.Equals(entry.GetProperty("level").GetString(), "error", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(
                        text,
                        "Failed to load resource: the server responded with a status of 404 (Not Found)",
                        StringComparison.Ordinal))
                {
                    _errors.Add(text);
                }

                break;
            case "Network.responseReceived":
                var response = message.GetProperty("params").GetProperty("response");
                var status = response.GetProperty("status").GetDouble();
                var url = response.GetProperty("url").GetString() ?? string.Empty;
                if (status >= 400 &&
                    !url.EndsWith("/favicon.ico", StringComparison.OrdinalIgnoreCase))
                {
                    _failedResponses.Add($"{status:0} {url}");
                }

                break;
        }
    }
}

internal static class BrowserBinaryResolver
{
    private static readonly HttpClient HttpClient = new()
    {
        Timeout = TimeSpan.FromMinutes(10)
    };

    public static async Task<BrowserLaunchConfiguration> ResolveAsync()
    {
        var downloadUrl = Environment.GetEnvironmentVariable("SMOKE_TEST_CHROMIUM_DOWNLOAD_URL");
        if (string.IsNullOrWhiteSpace(downloadUrl))
        {
            return BrowserLaunchConfiguration.Bundled;
        }

        var browserVersion = Environment.GetEnvironmentVariable("SMOKE_TEST_CHROMIUM_VERSION");
        if (string.IsNullOrWhiteSpace(browserVersion))
        {
            throw new InvalidOperationException(
                "SMOKE_TEST_CHROMIUM_VERSION is required when SMOKE_TEST_CHROMIUM_DOWNLOAD_URL is set.");
        }

        var executableRelativePath = Environment.GetEnvironmentVariable("SMOKE_TEST_CHROMIUM_EXECUTABLE_RELATIVE_PATH");
        if (string.IsNullOrWhiteSpace(executableRelativePath))
        {
            throw new InvalidOperationException(
                "SMOKE_TEST_CHROMIUM_EXECUTABLE_RELATIVE_PATH is required when SMOKE_TEST_CHROMIUM_DOWNLOAD_URL is set.");
        }

        var cacheKey = Environment.GetEnvironmentVariable("SMOKE_TEST_CHROMIUM_CACHE_KEY");
        if (string.IsNullOrWhiteSpace(cacheKey))
        {
            cacheKey = ResolvePlatformCacheKey();
        }

        var browserDirectory = Path.Combine(TestEnvironment.WorkDirectory, "browsers", "chromium", browserVersion, cacheKey);
        var executablePath = Path.Combine(browserDirectory, executableRelativePath);

        if (File.Exists(executablePath))
        {
            EnsureExecutablePermissions(executablePath);
            return new BrowserLaunchConfiguration(executablePath);
        }

        Directory.CreateDirectory(browserDirectory);
        var archivePath = Path.Combine(browserDirectory, Path.GetFileName(new Uri(downloadUrl).AbsolutePath));
        if (!File.Exists(archivePath))
        {
            await DownloadBrowserArchiveWithRetryAsync(downloadUrl, archivePath);
        }

        ZipFile.ExtractToDirectory(archivePath, browserDirectory, overwriteFiles: true);
        EnsureExecutablePermissions(executablePath);

        if (!File.Exists(executablePath))
        {
            throw new FileNotFoundException(
                $"Downloaded Chromium archive did not contain the expected executable '{executableRelativePath}'.");
        }

        return new BrowserLaunchConfiguration(executablePath);
    }

    private static async Task DownloadBrowserArchiveWithRetryAsync(string downloadUrl, string archivePath)
    {
        const int maxAttempts = 3;

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                using var response = await HttpClient.GetAsync(downloadUrl);
                response.EnsureSuccessStatusCode();

                await using var archiveStream = await response.Content.ReadAsStreamAsync();
                await using var fileStream = File.Create(archivePath);
                await archiveStream.CopyToAsync(fileStream);
                return;
            }
            catch when (attempt < maxAttempts)
            {
                if (File.Exists(archivePath))
                {
                    File.Delete(archivePath);
                }

                await Task.Delay(TimeSpan.FromSeconds(2 * attempt));
            }
        }
    }

    private static string ResolvePlatformCacheKey()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return Environment.Is64BitOperatingSystem ? "win-x64" : "win-x86";
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            return "linux-x64";
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            return RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "mac-arm64" : "mac-x64";
        }

        throw new PlatformNotSupportedException("Only Windows, Linux, and macOS are supported for browser automation.");
    }

    private static void EnsureExecutablePermissions(string executablePath)
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows) || !File.Exists(executablePath))
        {
            return;
        }

        File.SetUnixFileMode(
            executablePath,
            UnixFileMode.UserRead |
            UnixFileMode.UserWrite |
            UnixFileMode.UserExecute |
            UnixFileMode.GroupRead |
            UnixFileMode.GroupExecute |
            UnixFileMode.OtherRead |
            UnixFileMode.OtherExecute);
    }
}

internal sealed record BrowserLaunchConfiguration(string? ExecutablePath)
{
    public static BrowserLaunchConfiguration Bundled { get; } = new((string?)null);
}

internal static class ProcessRunner
{
    public static async Task RunCheckedAsync(
        string fileName,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        IReadOnlyDictionary<string, string>? environmentVariables = null)
    {
        using var process = new Process();
        process.StartInfo = CreateStartInfo(
            fileName,
            arguments,
            workingDirectory,
            redirectOutput: true,
            environmentVariables: environmentVariables);

        var standardOutput = new StringBuilder();
        var standardError = new StringBuilder();
        process.OutputDataReceived += (_, args) =>
        {
            if (args.Data is not null)
            {
                standardOutput.AppendLine(args.Data);
            }
        };
        process.ErrorDataReceived += (_, args) =>
        {
            if (args.Data is not null)
            {
                standardError.AppendLine(args.Data);
            }
        };

        if (!process.Start())
        {
            throw new InvalidOperationException($"Failed to start process '{fileName}'.");
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync();

        if (process.ExitCode == 0)
        {
            return;
        }

        throw new InvalidOperationException(
            $"Command failed: {fileName} {string.Join(' ', arguments)}{Environment.NewLine}" +
            standardOutput +
            standardError);
    }

    public static ProcessStartInfo CreateStartInfo(
        string fileName,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        bool redirectOutput,
        IReadOnlyDictionary<string, string>? environmentVariables = null)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = fileName,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = redirectOutput,
            RedirectStandardError = redirectOutput
        };

        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        if (environmentVariables is not null)
        {
            foreach (var pair in environmentVariables)
            {
                startInfo.Environment[pair.Key] = pair.Value;
            }
        }

        return startInfo;
    }
}

internal sealed class CapturedProcess : IAsyncDisposable
{
    private readonly Task<string> _standardOutputTask;
    private readonly Task<string> _standardErrorTask;

    private CapturedProcess(Process process, Task<string> standardOutputTask, Task<string> standardErrorTask)
    {
        Process = process;
        _standardOutputTask = standardOutputTask;
        _standardErrorTask = standardErrorTask;
    }

    public Process Process { get; }

    public static CapturedProcess Start(
        string fileName,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        IReadOnlyDictionary<string, string>? environmentVariables = null)
    {
        var process = new Process
        {
            StartInfo = ProcessRunner.CreateStartInfo(
                fileName,
                arguments,
                workingDirectory,
                redirectOutput: true,
                environmentVariables: environmentVariables)
        };

        if (!process.Start())
        {
            throw new InvalidOperationException($"Failed to start process '{fileName}'.");
        }

        return new CapturedProcess(
            process,
            process.StandardOutput.ReadToEndAsync(),
            process.StandardError.ReadToEndAsync());
    }

    public async Task<string> GetCombinedOutputAsync()
    {
        var standardOutput = await _standardOutputTask;
        var standardError = await _standardErrorTask;
        return standardOutput + standardError;
    }

    public async ValueTask DisposeAsync()
    {
        if (!Process.HasExited)
        {
            await Process.WaitForExitAsync();
        }

        Process.Dispose();
        await Task.WhenAll(_standardOutputTask, _standardErrorTask);
    }
}
