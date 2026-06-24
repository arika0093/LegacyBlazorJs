import { readPackageSourceFile } from '../lib/polyfill-files.mjs';
import {
  isInternetExplorerTargetAtMost,
} from '../lib/targets.mjs';
import { createLegacyEntryPolyfillPlugin } from './helpers.mjs';

const LEGACY_PLATFORM_DOM_MODULE_ID = 'legacy-blazor-platform-dom-polyfill';

export function needsPlatformDomPolyfill(targets) {
  return isInternetExplorerTargetAtMost(targets, 11);
}

export function legacyPlatformDomPolyfillPlugin(targets) {
  return createLegacyEntryPolyfillPlugin({
    name: 'legacy-platform-dom-polyfill',
    moduleId: LEGACY_PLATFORM_DOM_MODULE_ID,
    isEnabled: () => needsPlatformDomPolyfill(targets),
    loadSource: () => readPackageSourceFile('@webcomponents/webcomponentsjs/bundles/webcomponents-pf_dom.js'),
  });
}
