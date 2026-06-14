using System.Diagnostics;
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

        await using var harness = await SmokeAppHarness.CreateAsync(repositoryRoot, profile, packageVersion);
        await harness.StartAsync();

        await using var browserHarness = await BrowserHarness.CreateAsync();
        await browserHarness.AssertCounterInteractiveAsync(harness.BaseUri, profile);
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
}

internal sealed class SmokeAppHarness : IAsyncDisposable
{
    private const string AppName = "SmokeApp";
    private static readonly HttpClient HttpClient = new() { Timeout = TimeSpan.FromSeconds(2) };

    private readonly string _rootDirectory;
    private readonly string _appDirectory;
    private readonly string _profile;
    private readonly string _packageVersion;
    private readonly Uri _baseUri;
    private CapturedProcess? _serverProcess;

    private SmokeAppHarness(string rootDirectory, string appDirectory, string profile, string packageVersion, Uri baseUri)
    {
        _rootDirectory = rootDirectory;
        _appDirectory = appDirectory;
        _profile = profile;
        _packageVersion = packageVersion;
        _baseUri = baseUri;
    }

    public Uri BaseUri => _baseUri;

    public static async Task<SmokeAppHarness> CreateAsync(string repositoryRoot, string profile, string packageVersion)
    {
        var rootDirectory = Path.Combine(repositoryRoot, ".work", $"smoke-{profile}-{Guid.NewGuid():N}");
        var appDirectory = Path.Combine(rootDirectory, AppName);
        Directory.CreateDirectory(rootDirectory);

        var port = GetAvailablePort();
        var baseUri = new Uri($"http://127.0.0.1:{port}");
        var harness = new SmokeAppHarness(rootDirectory, appDirectory, profile, packageVersion, baseUri);
        await harness.InitializeAsync();
        return harness;
    }

    public async Task StartAsync()
    {
        var projectPath = Path.Combine(_appDirectory, $"{AppName}.csproj");
        _serverProcess = CapturedProcess.Start(
            "dotnet",
            [
                "run",
                "--project", projectPath,
                "--urls", _baseUri.ToString(),
                "--no-launch-profile"
            ],
            _appDirectory);

        for (var attempt = 0; attempt < 90; attempt++)
        {
            if (_serverProcess.Process.HasExited)
            {
                throw new InvalidOperationException(
                    $"Blazor Server exited before it became ready.{Environment.NewLine}{await _serverProcess.GetCombinedOutputAsync()}");
            }

            try
            {
                using var response = await HttpClient.GetAsync(_baseUri);
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
        throw new TimeoutException($"Blazor Server did not become ready at {_baseUri} within 90 seconds.");
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
                "new", "blazor",
                "--name", AppName,
                "--output", _appDirectory,
                "--framework", "net8.0",
                "--interactivity", "Server",
                "--all-interactive",
                "--no-https",
                "--no-restore"
            ],
            _rootDirectory);

        var projectPath = Path.Combine(_appDirectory, $"{AppName}.csproj");
        await ProcessRunner.RunCheckedAsync(
            "dotnet",
            [
                "add", projectPath,
                "package", "LegacyBlazorJs",
                "--version", _packageVersion,
                "--source", TestEnvironment.PackageSourceDirectory
            ],
            _appDirectory);

        ReplaceFrameworkScript(Path.Combine(_appDirectory, "Components", "App.razor"));
    }

    private void ReplaceFrameworkScript(string appRazorPath)
    {
        var contents = File.ReadAllText(appRazorPath);
        var replacement = $"<script src=\"_content/LegacyBlazorJs/blazor.web.{_profile}.js\"></script>";
        var updated = Regex.Replace(
            contents,
            "<script src=.*?_framework/blazor\\.web\\.js.*?</script>",
            replacement,
            RegexOptions.Singleline);

        if (ReferenceEquals(contents, updated) || contents == updated)
        {
            throw new InvalidOperationException($"Could not replace the default blazor.web.js script tag in '{appRazorPath}'.");
        }

        File.WriteAllText(appRazorPath, updated);
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
        await EnsureBrowsersInstalledAsync(force: false);
        var playwright = await Playwright.CreateAsync();
        try
        {
            var browser = await playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions { Headless = true });
            return new BrowserHarness(playwright, browser);
        }
        catch
        {
            playwright.Dispose();
            throw;
        }
    }

    public async Task AssertCounterInteractiveAsync(Uri baseUri, string profile)
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

        for (var attempt = 0; attempt < 20; attempt++)
        {
            if (errors.Count > 0)
            {
                break;
            }

            if (await updatedCount.IsVisibleAsync())
            {
                break;
            }

            await button.ClickAsync();
            await page.WaitForTimeoutAsync(500);
        }

        if (errors.Count > 0)
        {
            throw new InvalidOperationException($"{profile} emitted browser errors:{Environment.NewLine}{string.Join(Environment.NewLine, errors)}");
        }

        await updatedCount.WaitForAsync();
        await page.CloseAsync();
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
