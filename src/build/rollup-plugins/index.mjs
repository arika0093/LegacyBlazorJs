import { legacyCommonjsPlugin } from './commonjs.mjs';
import { legacyAbortControllerPolyfillPlugin } from './abort-controller.mjs';
import { legacyAttachShadowPolyfillPlugin } from './attach-shadow.mjs';
import { legacyWhatwgFetchPlugin } from './whatwg-fetch.mjs';
import { legacyCoreJsPolyfillPlugin } from './corejs-polyfill.mjs';
import { legacyCurrentScriptPolyfillPlugin } from './current-script.mjs';
import { legacyCustomElementsPolyfillPlugin } from './custom-elements.mjs';
import { legacyDynamicImportPlugin } from './dynamic-import.mjs';
import { legacyDomApiShimsPolyfillPlugin } from './dom-api-shims.mjs';
import { legacyBabelPlugin } from './babel.mjs';
import { legacyIE11FixesPlugin } from './ie11-fixes.mjs';
import { legacyES5FixesPlugin } from './es5-fixes.mjs';
import { legacyMutationObserverPolyfillPlugin } from './mutation-observer.mjs';
import { legacyPlatformDomPolyfillPlugin } from './platform-dom.mjs';
import { legacySendBeaconPolyfillPlugin } from './send-beacon.mjs';
import { legacyTemplatePolyfillPlugin } from './template-polyfill.mjs';

/**
 * Get all legacy Blazor plugins for Rollup
 */
export function legacyBlazorPlugins(targets) {
  return [
    legacyCommonjsPlugin(),
    // Prepend non-ECMAScript Web API polyfills before any entry code runs
    legacyWhatwgFetchPlugin(),
    legacyMutationObserverPolyfillPlugin(targets),
    legacyPlatformDomPolyfillPlugin(targets),
    legacyTemplatePolyfillPlugin(targets),
    legacyCustomElementsPolyfillPlugin(targets),
    legacyAbortControllerPolyfillPlugin(targets),
    legacyCurrentScriptPolyfillPlugin(targets),
    legacySendBeaconPolyfillPlugin(targets),
    legacyAttachShadowPolyfillPlugin(targets),
    legacyDomApiShimsPolyfillPlugin(targets),
    // Convert syntax and features to be compatible with legacy environments, based on specified targets
    legacyBabelPlugin(targets),

    // below plugins are applied after the above transformations
    // (use renderChunk to ensure they run after Babel transforms the code, including Rollup helpers)
    // ----------------------------
    // Prepend only the core-js modules required for the current browser target
    legacyCoreJsPolyfillPlugin(targets),
    // handle dynamic imports in a way compatible with legacy environments
    legacyDynamicImportPlugin(),
    // Apply IE11-specific fixes
    legacyIE11FixesPlugin(targets),
    // Apply ES5-specific fixes
    legacyES5FixesPlugin(targets),
  ];
}
