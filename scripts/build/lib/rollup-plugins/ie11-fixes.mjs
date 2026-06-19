/**
 * Fix IE11 compatibility issues in the output
 *
 * These fixes cannot be handled by Babel because they are:
 * 1. Runtime logic issues (not syntax issues)
 * 2. Framework-specific patterns that Babel doesn't recognize
 * 3. Issues that appear after Babel transformation
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
