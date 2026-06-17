import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { injectWhatwgFetchPolyfillImport } from '../legacy-output.mjs';

const require = createRequire(import.meta.url);

/**
 * Inject whatwg-fetch polyfill for IE11 fetch() support
 */
export function legacyWhatwgFetchPlugin() {
  const whatwgFetchPath = require.resolve('whatwg-fetch/fetch.js');
  const VIRTUAL_ID = 'legacy-blazor-whatwg-fetch';
  const RESOLVED_VIRTUAL_ID = '\0legacy-blazor-whatwg-fetch';

  let polyfillSource = null;

  return {
    name: 'legacy-whatwg-fetch',
    async buildStart() {
      polyfillSource = await readFile(whatwgFetchPath, 'utf8');
    },
    resolveId(source) {
      if (source === VIRTUAL_ID) {
        return RESOLVED_VIRTUAL_ID;
      }
      return null;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        return polyfillSource;
      }
      return null;
    },
    transform(code, id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        return null;
      }
      const transformed = injectWhatwgFetchPolyfillImport(code, VIRTUAL_ID, id);
      return transformed === code ? null : { code: transformed, map: null };
    }
  };
}
