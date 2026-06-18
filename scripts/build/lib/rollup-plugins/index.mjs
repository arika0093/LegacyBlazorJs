import { legacyCommonjsPlugin } from './commonjs.mjs';
import { legacyDotnetJsImportPlugin } from './dotnetjs-import.mjs';
import { legacyWhatwgFetchPlugin } from './whatwg-fetch.mjs';
import { legacyCoreJsPolyfillPlugin } from './corejs-polyfill.mjs';
import { legacyWebApiPolyfillPlugin } from './web-api-polyfill.mjs';
import { legacyDynamicImportPlugin } from './dynamic-import.mjs';
import { legacyBabelPlugin } from './babel.mjs';
import { legacyIE11FixesPlugin } from './ie11-fixes.mjs';
import { legacyES5FixesPlugin } from './es5-fixes.mjs';
import { legacyPostBabelPlugin } from './post-babel.mjs';

/**
 * Get all legacy Blazor plugins for Rollup
 */
export function legacyBlazorPlugins(targets) {
  return [
    legacyCommonjsPlugin(),
    legacyDotnetJsImportPlugin(),
    // Prepend non-ECMAScript Web API polyfills before any entry code runs
    legacyWhatwgFetchPlugin(),
    legacyWebApiPolyfillPlugin(),
    // Convert syntax and features to be compatible with legacy environments, based on specified targets
    legacyBabelPlugin(targets),

    // below plugins are applied after the above transformations
    // (use renderChunk to ensure they run after Babel transforms the code, including Rollup helpers)
    // ----------------------------
    // Prepend final core-js polyfills before any entry code runs
    legacyCoreJsPolyfillPlugin(),
    // handle dynamic imports in a way compatible with legacy environments
    legacyDynamicImportPlugin(),
    // Apply IE11-specific fixes
    legacyIE11FixesPlugin(targets),
    // Apply ES5-specific fixes
    legacyES5FixesPlugin(targets),
  ];
}
