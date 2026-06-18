/**
 * Keep the Web.JS runtime's dynamic dotnet.js import on the app's _framework path
 * even when blazor.web*.js is relocated under _content/LegacyBlazorJs.
 */
export function legacyDotnetJsImportPlugin() {
  return {
    name: 'legacy-dotnetjs-import',
    resolveDynamicImport(source) {
      if (source === './dotnet.js') {
        return { id: '/_framework/dotnet.js', moduleSideEffects: false, external: 'absolute' };
      }

      return null;
    },
  };
}
