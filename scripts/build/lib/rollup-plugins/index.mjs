import { legacyCommonjsPlugin } from './commonjs.mjs';
import { legacyWhatwgFetchPlugin } from './whatwg-fetch.mjs';
import { legacyDynamicImportPlugin } from './dynamic-import.mjs';
import { legacyBabelPlugin } from './babel.mjs';
import { legacyIE11FixesPlugin } from './ie11-fixes.mjs';
import { legacyPostBabelPlugin } from './post-babel.mjs';
import { legacyPolyfillPrependPlugin } from './polyfill-prepend.mjs';

/**
 * Get all legacy Blazor plugins for Rollup
 */
export function legacyBlazorPlugins(targets) {
  return [
    legacyCommonjsPlugin(),
    legacyWhatwgFetchPlugin(),
    legacyDynamicImportPlugin(),
    legacyBabelPlugin(targets),
    legacyIE11FixesPlugin(), // Apply IE11-specific fixes before final Babel pass
    legacyPostBabelPlugin(targets), // Post-process entire output to transpile Rollup helpers
    legacyPolyfillPrependPlugin() // Prepend critical polyfills (must be last)
  ];
}
