using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
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

        return "net10.0";
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
    private readonly Uri _baseUri;
    private CapturedProcess? _serverProcess;

    private SmokeAppHarness(
        string rootDirectory,
        string appDirectory,
        string projectPath,
        string profile,
        string packageVersion,
        string targetFramework,
        string hostingModel,
        Uri baseUri)
    {
        _rootDirectory = rootDirectory;
        _appDirectory = appDirectory;
        _projectPath = projectPath;
        _profile = profile;
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
        var harness = new SmokeAppHarness(
            rootDirectory,
            appDirectory,
            projectPath,
            profile,
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
                break;
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

        WriteNuGetConfig(_appDirectory);

        if (!HasProjectReferenceToLegacyBlazorJs(_projectPath))
        {
            await ProcessRunner.RunCheckedAsync(
                "dotnet",
                [
                    "add", _projectPath,
                    "package", "LegacyBlazorJs",
                    "--version", _packageVersion,
                    "--source", TestEnvironment.PackageSourceDirectory
                ],
                _appDirectory);
        }

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

    private static bool HasProjectReferenceToLegacyBlazorJs(string projectPath)
    {
        var contents = File.ReadAllText(projectPath);
        return contents.Contains("LegacyBlazorJs.csproj", StringComparison.Ordinal);
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
            "Server" => $"blazor.web.{_profile}.js",
            "WebAssembly" => $"blazor.webassembly.{_profile}.js",
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
    private readonly IPlaywright _playwright;
    private readonly IBrowser _browser;

    private BrowserHarness(IPlaywright playwright, IBrowser browser)
    {
        _playwright = playwright;
        _browser = browser;
    }

    public static async Task<BrowserHarness> CreateAsync()
    {
        var launchConfiguration = await BrowserBinaryResolver.ResolveAsync();

        var playwright = await Playwright.CreateAsync();
        try
        {
            var options = new BrowserTypeLaunchOptions
            {
                Headless = true,
                ExecutablePath = launchConfiguration.ExecutablePath
            };

            if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                options.Args =
                [
                    "--no-sandbox"
                ];
            }

            var browser = await playwright.Chromium.LaunchAsync(options);
            return new BrowserHarness(playwright, browser);
        }
        catch
        {
            playwright.Dispose();
            throw;
        }
    }

    public async Task AssertCounterInteractiveAsync(Uri baseUri, string profile, string hostingModel)
    {
        var page = await _browser.NewPageAsync();
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

internal static class BrowserBinaryResolver
{
    private static readonly HttpClient HttpClient = new();

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
            using var response = await HttpClient.GetAsync(downloadUrl);
            response.EnsureSuccessStatusCode();

            await using var archiveStream = await response.Content.ReadAsStreamAsync();
            await using var fileStream = File.Create(archivePath);
            await archiveStream.CopyToAsync(fileStream);
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
