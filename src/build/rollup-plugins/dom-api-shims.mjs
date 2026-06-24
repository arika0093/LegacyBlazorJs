import { readBuildPolyfillFile } from '../lib/polyfill-files.mjs';
import {
  isInternetExplorerTargetAtMost,
  isChromeTargetBefore,
} from '../lib/targets.mjs';
import { createLegacyEntryPolyfillPlugin } from './helpers.mjs';

const LEGACY_DOM_API_SHIMS_MODULE_ID = 'legacy-blazor-dom-api-shims-polyfill';

// https://caniuse.com/mdn-api_node_getrootnode
// getRootNode/composedPath shims are needed for all IE and Chrome before 54.
export function needsDomApiShims(targets) {
  return isInternetExplorerTargetAtMost(targets, 11) || isChromeTargetBefore(targets, 54);
}

export function legacyDomApiShimsPolyfillPlugin(targets) {
  return createLegacyEntryPolyfillPlugin({
    name: 'legacy-dom-api-shims-polyfill',
    moduleId: LEGACY_DOM_API_SHIMS_MODULE_ID,
    isEnabled: () => needsDomApiShims(targets),
    loadSource: () => readBuildPolyfillFile('dom-api-shims.js'),
  });
}
