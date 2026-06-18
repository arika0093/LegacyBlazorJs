import { legacyCommonjsPlugin } from './commonjs.mjs';
import { legacyWhatwgFetchPlugin } from './whatwg-fetch.mjs';
import { legacyCoreJsPolyfillPlugin } from './corejs-polyfill.mjs';
import { legacyWebApiPolyfillPlugin } from './web-api-polyfill.mjs';
import { legacyDynamicImportPlugin } from './dynamic-import.mjs';
import { legacyBabelPlugin } from './babel.mjs';
import { legacyIE11FixesPlugin } from './ie11-fixes.mjs';
import { legacyPostBabelPlugin } from './post-babel.mjs';

/**
 * Get all legacy Blazor plugins for Rollup
 */
export function legacyBlazorPlugins(targets) {
  return [
    legacyCommonjsPlugin(),
    legacyBabelPlugin(targets),
    legacyIE11FixesPlugin(), // Apply IE11-specific fixes before final Babel pass
    legacyDynamicImportPlugin(),
    legacyCoreJsPolyfillPlugin(), // Prepend final core-js polyfills before any entry code runs
    legacyWhatwgFetchPlugin(),
    legacyWebApiPolyfillPlugin(), // Prepend non-ECMAScript Web API polyfills before any entry code runs
    legacyPostBabelPlugin(targets), // Post-process entire output to transpile Rollup helpers
  ];
}
