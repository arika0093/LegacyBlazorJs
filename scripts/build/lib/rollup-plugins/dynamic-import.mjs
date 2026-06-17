import { transformLegacyDynamicImport } from '../legacy-output.mjs';

/**
 * Transform dynamic import() to IE11-compatible Function wrapper
 * note:
 *   In practice, the import logic cannot be removed (used by dotnet.js),
 *   but it is not necessary to pass in IE11, so dynamic imports are disabled by string replacement.
 */
export function legacyDynamicImportPlugin() {
  return {
    name: 'legacy-dynamic-import',
    renderChunk(code, chunk) {
      const transformed = transformLegacyDynamicImport(code, chunk.fileName);
      return transformed === code ? null : { code: transformed, map: null };
    }
  };
}
