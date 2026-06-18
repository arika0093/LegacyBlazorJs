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
    // legacyCommonjsPlugin(),
    // legacyWhatwgFetchPlugin(),
    // legacyDynamicImportPlugin(),
    // legacyBabelPlugin(targets),
    // legacyIE11FixesPlugin(), // Apply IE11-specific fixes before final Babel pass
    // legacyPostBabelPlugin(targets), // Post-process entire output to transpile Rollup helpers
    // legacyCoreJsPolyfillPlugin(), // Prepend final core-js polyfills before any entry code runs

    legacyCommonjsPlugin(),
    legacyWhatwgFetchPlugin(),
    legacyCoreJsPolyfillPlugin(), // Prepend final core-js polyfills before any entry code runs
    // legacyBabelPlugin(targets),
    legacyWebApiPolyfillPlugin(), // Prepend non-ECMAScript Web API polyfills before any entry code runs
    legacyIE11FixesPlugin(), // Apply IE11-specific fixes before final Babel pass
    legacyPostBabelPlugin(targets), // Post-process entire output to transpile Rollup helpers
    legacyDynamicImportPlugin(),
  ];
}
