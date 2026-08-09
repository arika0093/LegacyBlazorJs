import { readBuildPolyfillFile } from '../lib/polyfill-files.mjs';
import { transformLegacyDynamicImport } from '../lib/legacy-output.mjs';
import {
  isAnyInternetExplorerTarget,
  isChromeTargetBefore,
} from '../lib/targets.mjs';
import { createRenderChunkTransformPlugin } from './helpers.mjs';

// Although Chrome supports dynamic import from version 64, import() is an
// ES2020 syntax feature. Keep rewriting it through the ES2018 profile so the
// output passes the profile's ES syntax validation.
export function needsLegacyDynamicImportTransform(targets) {
  return isAnyInternetExplorerTarget(targets) || isChromeTargetBefore(targets, 80);
}

/**
 * Transform dynamic import() to IE11-compatible Function wrapper
 * note:
 *   In practice, the import logic cannot be removed (used by dotnet.js),
 *   but it is not necessary to pass in IE11, so dynamic imports are disabled by string replacement.
 */
export function legacyDynamicImportPlugin(targets) {
  let helperSource = null;

  return createRenderChunkTransformPlugin({
    name: 'legacy-dynamic-import',
    async buildStart() {
      helperSource = await readBuildPolyfillFile('dynamic-import-helper.js');
    },
    transformChunk(code, chunk) {
      if (!needsLegacyDynamicImportTransform(targets)) {
        return null;
      }

      return transformLegacyDynamicImport(code, {
        filename: chunk.fileName,
        helperSource,
      });
    },
  });
}
