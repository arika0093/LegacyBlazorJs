import { readBuildPolyfillFile } from '../lib/polyfill-files.mjs';
import { transformLegacyDynamicImport } from '../lib/legacy-output.mjs';
import {
  isAnyInternetExplorerTarget,
  isChromeTargetBefore,
} from '../lib/targets.mjs';
import { createRenderChunkTransformPlugin } from './helpers.mjs';

// Dynamic import is available in Chrome 64 and later. The configured profiles
// map ES2017 and earlier to Chrome versions before that support boundary.
export function needsLegacyDynamicImportTransform(targets) {
  return isAnyInternetExplorerTarget(targets) || isChromeTargetBefore(targets, 64);
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
