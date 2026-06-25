import { readPackageSourceFile } from '../lib/polyfill-files.mjs';
import { injectWhatwgFetchPolyfillImport } from '../lib/legacy-output.mjs';
import { createSourceBackedImportInjectorPlugin } from './helpers.mjs';

/**
 * Inject whatwg-fetch polyfill for IE11 fetch() support
 */
export function legacyWhatwgFetchPlugin() {
  return createSourceBackedImportInjectorPlugin({
    name: 'legacy-whatwg-fetch',
    moduleId: 'legacy-blazor-whatwg-fetch',
    loadSource: () => readPackageSourceFile('whatwg-fetch/fetch.js'),
    injectImport: (code, id) => injectWhatwgFetchPolyfillImport(code, 'legacy-blazor-whatwg-fetch', id),
  });
}
