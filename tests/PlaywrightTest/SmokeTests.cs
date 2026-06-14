using System.Diagnostics;
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

    public static string SmokeAppTemplatesDirectory => Path.Combine(RepositoryRoot, "tests", "SmokeApps");

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
}

internal sealed class SmokeAppHarness : IAsyncDisposable
{
    private static readonly HttpClient HttpClient = new() { Timeout = TimeSpan.FromSeconds(2) };
    private static readonly Uri ReadyPath = new("/counter", UriKind.Relative);

    private readonly string _rootDirectory;
    private readonly string _appDirectory;
    private readonly string _projectPath;
    private readonly string _profile;
    private readonly string _packageVersion;
    private readonly string _hostingModel;
    private readonly Uri _baseUri;
    private CapturedProcess? _serverProcess;

    private SmokeAppHarness(
        string rootDirectory,
        string appDirectory,
        string projectPath,
        string profile,
        string packageVersion,
        string hostingModel,
        Uri baseUri)
    {
        _rootDirectory = rootDirectory;
        _appDirectory = appDirectory;
        _projectPath = projectPath;
        _profile = profile;
        _packageVersion = packageVersion;
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
        var appDirectory = GetAppDirectory(rootDirectory, hostingModel);
        var projectPath = GetProjectPath(appDirectory, hostingModel);
        var port = GetAvailablePort();
        var baseUri = new Uri($"http://127.0.0.1:{port}");
        var harness = new SmokeAppHarness(rootDirectory, appDirectory, projectPath, profile, packageVersion, hostingModel, baseUri);
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
            _appDirectory);

        for (var attempt = 0; attempt < 120; attempt++)
        {
            if (_serverProcess.Process.HasExited)
            {
                throw new InvalidOperationException(
                    $"Blazor {_hostingModel} app exited before it became ready.{Environment.NewLine}{await _serverProcess.GetCombinedOutputAsync()}");
            }

            try
            {
                using var response = await HttpClient.GetAsync(new Uri(_baseUri, ReadyPath));
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
            }

            await Task.Delay(TimeSpan.FromSeconds(1));
        }

        await DisposeServerAsync();
        throw new TimeoutException($"Blazor {_hostingModel} app did not become ready at {_baseUri} within 120 seconds.");
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
        await ProcessRunner.RunCheckedAsync(
            "dotnet",
            [
                "add", _projectPath,
                "package", "LegacyBlazorJs",
                "--version", _packageVersion,
                "--source", TestEnvironment.PackageSourceDirectory
            ],
            _appDirectory);

        await ProcessRunner.RunCheckedAsync(
            "dotnet",
            [
                "restore", _projectPath,
                "--source", TestEnvironment.PackageSourceDirectory
            ],
            _appDirectory);

        ReplaceFrameworkScript(Path.Combine(_appDirectory, "Components", "App.razor"));
    }

    private void ReplaceFrameworkScript(string appRazorPath)
    {
        var contents = File.ReadAllText(appRazorPath);
        var replacement = $"<script src=\"_content/LegacyBlazorJs/blazor.web.{_profile}.js\"></script>";
        var updated = contents.Replace("__LEGACY_BLAZOR_SCRIPT__", replacement, StringComparison.Ordinal);

        if (ReferenceEquals(contents, updated) || contents == updated)
        {
            throw new InvalidOperationException($"Could not replace the script placeholder in '{appRazorPath}'.");
        }

        File.WriteAllText(appRazorPath, updated);
    }

    private static string GetTemplateDirectory(string hostingModel) =>
        Path.Combine(TestEnvironment.SmokeAppTemplatesDirectory, hostingModel switch
        {
            "Server" => "ServerApp",
            "WebAssembly" => "WasmApp",
            _ => throw new InvalidOperationException($"Unsupported hosting model '{hostingModel}'.")
        });

    private static string GetAppDirectory(string rootDirectory, string hostingModel) =>
        hostingModel switch
        {
            "Server" => rootDirectory,
            "WebAssembly" => Path.Combine(rootDirectory, "WasmApp"),
            _ => throw new InvalidOperationException($"Unsupported hosting model '{hostingModel}'.")
        };

    private static string GetProjectPath(string appDirectory, string hostingModel) =>
        hostingModel switch
        {
            "Server" => Path.Combine(appDirectory, "ServerApp.csproj"),
            "WebAssembly" => Path.Combine(appDirectory, "WasmApp.csproj"),
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
    private static readonly SemaphoreSlim InstallLock = new(1, 1);
    private static bool _browsersInstalled;

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
        if (launchConfiguration.ExecutablePath is null)
        {
            await EnsureBrowsersInstalledAsync(force: false);
        }

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

        page.PageError += (_, error) => errors.Add(error);
        page.Console += (_, message) =>
        {
            if (message.Type == "error")
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

        for (var attempt = 0; attempt < 30; attempt++)
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

            await page.WaitForTimeoutAsync(500);
        }

        if (errors.Count > 0)
        {
            throw new InvalidOperationException(
                $"{hostingModel} {profile} emitted browser errors:{Environment.NewLine}{string.Join(Environment.NewLine, errors)}");
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

    private static async Task EnsureBrowsersInstalledAsync(bool force)
    {
        if (!force && _browsersInstalled)
        {
            return;
        }

        await InstallLock.WaitAsync();
        try
        {
            if (!force && _browsersInstalled)
            {
                return;
            }

            var baseDirectory = AppContext.BaseDirectory;
            string command;
            string[] arguments;

            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                var scriptPath = FindPlaywrightScript(baseDirectory, "playwright.ps1");
                command = "pwsh";
                arguments =
                [
                    "-File", scriptPath,
                    "install",
                    "chromium"
                ];
            }
            else
            {
                var scriptPath = FindPlaywrightScript(baseDirectory, "playwright.sh");
                command = "bash";
                arguments =
                [
                    scriptPath,
                    "install",
                    "--with-deps",
                    "chromium"
                ];
            }

            await ProcessRunner.RunCheckedAsync(command, arguments, baseDirectory);
            _browsersInstalled = true;
        }
        finally
        {
            InstallLock.Release();
        }
    }

    private static string FindPlaywrightScript(string baseDirectory, string fileName)
    {
        var scriptPath = Directory
            .EnumerateFiles(baseDirectory, fileName, SearchOption.AllDirectories)
            .FirstOrDefault();

        if (scriptPath is null)
        {
            throw new FileNotFoundException(
                $"Could not locate '{fileName}' under '{baseDirectory}'. Build the Playwright test project before running smoke tests.");
        }

        return scriptPath;
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

        var platform = ResolvePlatform();
        var browserDirectory = Path.Combine(TestEnvironment.WorkDirectory, "browsers", "chromium", browserVersion, platform.DirectoryName);
        var executablePath = Path.Combine(browserDirectory, platform.ExecutableRelativePath);

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
                $"Downloaded Chromium archive did not contain the expected executable '{platform.ExecutableRelativePath}'.");
        }

        return new BrowserLaunchConfiguration(executablePath);
    }

    private static BrowserPlatform ResolvePlatform()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return Environment.Is64BitOperatingSystem
                ? new BrowserPlatform("win64", Path.Combine("chrome-win64", "chrome.exe"))
                : new BrowserPlatform("win32", Path.Combine("chrome-win32", "chrome.exe"));
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            return new BrowserPlatform("linux64", Path.Combine("chrome-linux64", "chrome"));
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            var directoryName = RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "mac-arm64" : "mac-x64";
            var executable = Path.Combine(
                directoryName == "mac-arm64" ? "chrome-mac-arm64" : "chrome-mac-x64",
                "Google Chrome for Testing.app",
                "Contents",
                "MacOS",
                "Google Chrome for Testing");
            return new BrowserPlatform(directoryName, executable);
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

    private sealed record BrowserPlatform(string DirectoryName, string ExecutableRelativePath);
}

internal sealed record BrowserLaunchConfiguration(string? ExecutablePath)
{
    public static BrowserLaunchConfiguration Bundled { get; } = new((string?)null);
}

internal static class ProcessRunner
{
    public static async Task RunCheckedAsync(string fileName, IReadOnlyList<string> arguments, string workingDirectory)
    {
        using var process = new Process();
        process.StartInfo = CreateStartInfo(fileName, arguments, workingDirectory, redirectOutput: true);

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

    public static ProcessStartInfo CreateStartInfo(string fileName, IReadOnlyList<string> arguments, string workingDirectory, bool redirectOutput)
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

    public static CapturedProcess Start(string fileName, IReadOnlyList<string> arguments, string workingDirectory)
    {
        var process = new Process
        {
            StartInfo = ProcessRunner.CreateStartInfo(fileName, arguments, workingDirectory, redirectOutput: true)
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
