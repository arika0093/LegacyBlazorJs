/**
 * Fix ES5 compatibility issues in the output.
 *
 * These fixes cannot be handled reliably by Babel because they depend on
 * library-specific runtime patterns that remain after bundling.
 */
export function applyLegacyES5Fixes(code, targets) {
  let transformed = code;

  // Only apply to the dedicated ES5 target profile.
  if (!targets || targets.chrome !== '23') {
    return code;
  }

  // @msgpack/msgpack may emit a custom DataViewIndexOutOfBoundsError constructor
  // that becomes an illegal constructor call on Chrome 23 / ES5 environments.
  transformed = transformed.replace(
    /new\s+(?:exports\.)?DataViewIndexOutOfBoundsError\((["'])Insufficient data\1\)/g,
    'new RangeError("Insufficient data")'
  );

  return transformed;
}

export function legacyES5FixesPlugin(targets) {
  return {
    name: 'legacy-es5-fixes',
    renderChunk(code) {
      const transformed = applyLegacyES5Fixes(code, targets);
      return transformed === code ? null : { code: transformed, map: null };
    }
  };
}
