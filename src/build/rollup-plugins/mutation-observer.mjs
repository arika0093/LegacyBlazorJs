import { readPackageSourceFile } from '../lib/polyfill-files.mjs';
import {
  isInternetExplorerTargetAtMost,
} from '../lib/targets.mjs';
import { createLegacyEntryPolyfillPlugin } from './helpers.mjs';

const LEGACY_MUTATION_OBSERVER_MODULE_ID = 'legacy-blazor-mutation-observer-polyfill';

function patchMutationObserverPackageSource(source) {
  return [
    '(function (window) {',
    source.replace(/module\.exports\s*=\s*MutationObserver\s*;/, 'window.MutationObserver = MutationObserver;'),
    '}(typeof window !== \'undefined\' ? window : this));',
  ].join('\n');
}

export function needsMutationObserverPolyfill(targets) {
  return isInternetExplorerTargetAtMost(targets, 10);
}

export function legacyMutationObserverPolyfillPlugin(targets) {
  return createLegacyEntryPolyfillPlugin({
    name: 'legacy-mutation-observer-polyfill',
    moduleId: LEGACY_MUTATION_OBSERVER_MODULE_ID,
    isEnabled: () => needsMutationObserverPolyfill(targets),
    loadSource: async () => patchMutationObserverPackageSource(
      await readPackageSourceFile('mutation-observer/index.js')
    ),
  });
}
