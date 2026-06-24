import { readBuildPolyfillFile } from '../lib/polyfill-files.mjs';
import {
  isAnyInternetExplorerTarget,
  isChromeTargetBefore,
} from '../lib/targets.mjs';
import { createLegacyEntryPolyfillPlugin } from './helpers.mjs';

const LEGACY_CURRENT_SCRIPT_MODULE_ID = 'legacy-blazor-current-script-polyfill';

export function needsCurrentScriptPolyfill(targets) {
  return isAnyInternetExplorerTarget(targets) || isChromeTargetBefore(targets, 29);
}

export function legacyCurrentScriptPolyfillPlugin(targets) {
  return createLegacyEntryPolyfillPlugin({
    name: 'legacy-current-script-polyfill',
    moduleId: LEGACY_CURRENT_SCRIPT_MODULE_ID,
    isEnabled: () => needsCurrentScriptPolyfill(targets),
    loadSource: () => readBuildPolyfillFile('current-script.js'),
  });
}
