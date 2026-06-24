import { readPackageSourceFile } from '../lib/polyfill-files.mjs';
import {
  isAnyInternetExplorerTarget,
  isChromeTargetBefore,
} from '../lib/targets.mjs';
import { createLegacyEntryPolyfillPlugin } from './helpers.mjs';

const LEGACY_TEMPLATE_MODULE_ID = 'legacy-blazor-template-polyfill';

export function needsTemplatePolyfill(targets) {
  return isAnyInternetExplorerTarget(targets) || isChromeTargetBefore(targets, 26);
}

export function legacyTemplatePolyfillPlugin(targets) {
  return createLegacyEntryPolyfillPlugin({
    name: 'legacy-template-polyfill',
    moduleId: LEGACY_TEMPLATE_MODULE_ID,
    isEnabled: () => needsTemplatePolyfill(targets),
    loadSource: () => readPackageSourceFile('@webcomponents/template/template.min.js'),
  });
}
