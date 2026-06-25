import { readBuildPolyfillFile } from '../lib/polyfill-files.mjs';
import {
  isInternetExplorerTargetAtMost,
  isChromeTargetBefore,
} from '../lib/targets.mjs';
import { createLegacyEntryPolyfillPlugin } from './helpers.mjs';

const LEGACY_SEND_BEACON_MODULE_ID = 'legacy-blazor-send-beacon-polyfill';

// https://caniuse.com/beacon
// All IE, Chrome before 39.
export function needsSendBeaconPolyfill(targets) {
  return isInternetExplorerTargetAtMost(targets, 11) || isChromeTargetBefore(targets, 39);
}

export function legacySendBeaconPolyfillPlugin(targets) {
  return createLegacyEntryPolyfillPlugin({
    name: 'legacy-send-beacon-polyfill',
    moduleId: LEGACY_SEND_BEACON_MODULE_ID,
    isEnabled: () => needsSendBeaconPolyfill(targets),
    loadSource: () => readBuildPolyfillFile('send-beacon.js'),
  });
}
