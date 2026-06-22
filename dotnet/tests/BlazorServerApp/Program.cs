using BlazorServerApp.Components;
using Microsoft.AspNetCore.Routing;
using System.Reflection;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

var app = builder.Build();

app.UseAntiforgery();

ConfigureStaticAssets(app);
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();

static void ConfigureStaticAssets(WebApplication app)
{
    var mapStaticAssets = AppDomain.CurrentDomain
        .GetAssemblies()
        .SelectMany(assembly => assembly.GetTypes())
        .Where(type => type.IsSealed && type.IsAbstract)
        .SelectMany(type => type.GetMethods(BindingFlags.Public | BindingFlags.Static))
        .FirstOrDefault(method =>
            method.Name == "MapStaticAssets" &&
            method.GetParameters() is [{ ParameterType: var parameterType }] &&
            typeof(IEndpointRouteBuilder).IsAssignableFrom(parameterType));

    if (mapStaticAssets is not null)
    {
        mapStaticAssets.Invoke(null, [app]);
        return;
    }

    app.UseStaticFiles();
}
