import { readPackageSourceFile } from '../lib/polyfill-files.mjs';
import {
  isInternetExplorerTargetAtMost,
  isChromeTargetBefore,
} from '../lib/targets.mjs';
import { createLegacyEntryPolyfillPlugin } from './helpers.mjs';

const LEGACY_ABORT_CONTROLLER_MODULE_ID = 'legacy-blazor-abort-controller-polyfill';

export function needsAbortControllerPolyfill(targets) {
  return isInternetExplorerTargetAtMost(targets, 11) || isChromeTargetBefore(targets, 66);
}

export function legacyAbortControllerPolyfillPlugin(targets) {
  return createLegacyEntryPolyfillPlugin({
    name: 'legacy-abort-controller-polyfill',
    moduleId: LEGACY_ABORT_CONTROLLER_MODULE_ID,
    isEnabled: () => needsAbortControllerPolyfill(targets),
    loadSource: () => readPackageSourceFile('abortcontroller-polyfill/dist/abortcontroller-polyfill-only.js'),
  });
}
