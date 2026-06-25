import { readBuildPolyfillFile } from '../lib/polyfill-files.mjs';
import {
  isAnyInternetExplorerTarget,
  isChromeTargetBefore,
} from '../lib/targets.mjs';
import { createLegacyEntryPolyfillPlugin } from './helpers.mjs';

const LEGACY_ATTACH_SHADOW_MODULE_ID = 'legacy-blazor-attach-shadow-polyfill';

// https://caniuse.com/mdn-api_element_attachshadow
// All IE, Chrome before 53.
export function needsAttachShadowPolyfill(targets) {
  return isAnyInternetExplorerTarget(targets) || isChromeTargetBefore(targets, 53);
}

export function legacyAttachShadowPolyfillPlugin(targets) {
  return createLegacyEntryPolyfillPlugin({
    name: 'legacy-attach-shadow-polyfill',
    moduleId: LEGACY_ATTACH_SHADOW_MODULE_ID,
    isEnabled: () => needsAttachShadowPolyfill(targets),
    loadSource: () => readBuildPolyfillFile('attach-shadow.js'),
  });
}
