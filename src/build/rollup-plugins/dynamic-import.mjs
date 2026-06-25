import { readBuildPolyfillFile } from '../lib/polyfill-files.mjs';
import { transformLegacyDynamicImport } from '../lib/legacy-output.mjs';
import { createRenderChunkTransformPlugin } from './helpers.mjs';

/**
 * Transform dynamic import() to IE11-compatible Function wrapper
 * note:
 *   In practice, the import logic cannot be removed (used by dotnet.js),
 *   but it is not necessary to pass in IE11, so dynamic imports are disabled by string replacement.
 */
export function legacyDynamicImportPlugin() {
  let helperSource = null;

  return createRenderChunkTransformPlugin({
    name: 'legacy-dynamic-import',
    async buildStart() {
      helperSource = await readBuildPolyfillFile('dynamic-import-helper.js');
    },
    transformChunk(code, chunk) {
      return transformLegacyDynamicImport(code, {
        filename: chunk.fileName,
        helperSource,
      });
    },
  });
}
