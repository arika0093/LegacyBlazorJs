/**
 * Fix IE11 compatibility issues in the output
 */
export function legacyIE11FixesPlugin(targets) {
  return {
    name: 'legacy-ie11-fixes',
    renderChunk(code, chunk) {
      let transformed = code;

      // if IE11 is not a target, skip all transformations
      if (!targets || targets.ie !== '11') {
        return null;
      }

      return transformed === code ? null : { code: transformed, map: null };
    }
  };
}
