import { readPackageSourceFile } from '../lib/polyfill-files.mjs';
import {
  isAnyInternetExplorerTarget,
  isChromeTargetBefore,
} from '../lib/targets.mjs';
import { createLegacyEntryPolyfillPlugin } from './helpers.mjs';

const LEGACY_CUSTOM_ELEMENTS_MODULE_ID = 'legacy-blazor-custom-elements-polyfill';

export function needsCustomElementsPolyfill(targets) {
  return isAnyInternetExplorerTarget(targets) || isChromeTargetBefore(targets, 54);
}

export function legacyCustomElementsPolyfillPlugin(targets) {
  return createLegacyEntryPolyfillPlugin({
    name: 'legacy-custom-elements-polyfill',
    moduleId: LEGACY_CUSTOM_ELEMENTS_MODULE_ID,
    isEnabled: () => needsCustomElementsPolyfill(targets),
    loadSource: () => readPackageSourceFile('@webcomponents/custom-elements/custom-elements.min.js'),
  });
}
