using Microsoft.AspNetCore.Components;

namespace LegacyBlazorJs;

public sealed partial class Loader : ComponentBase
{
    /// <summary>
    /// Whether to automatically detect the target to load in the browser. The default value is true.
    /// </summary>
    [Parameter]
    public bool AutoDetect { get; set; } = true;

    /// <summary>
    /// The target to load. It can be one of the following values: "es5", "es2015", and so on. 
    /// If not specified, the target will be auto-detected in the browser.
    /// </summary>
    [Parameter]
    public string? Target { get; set; }

    // The path to the autoloader script, which is used to detect the target in the browser.
    private const string LoaderPath = "_content/LegacyBlazorJs/autoloader.js";

    // The default target to load if neither the Target parameter nor auto-detection is specified.
    private const string DefaultTarget = "es5";

    // The path prefix for the asset to load.
    private const string AssetPrefix = "_content/LegacyBlazorJs/blazor.server.";

    // The target to load, which is either the specified Target parameter or the default target.
    private string? RequestedTarget => string.IsNullOrWhiteSpace(Target) ? null : NormalizeTarget(Target);
    private static string NormalizeTarget(string target) => target.Trim().ToLowerInvariant();
}