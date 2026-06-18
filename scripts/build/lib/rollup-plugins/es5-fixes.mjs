/**
 * Fix ES5/IE11 compatibility issues in the output.
 *
 * These fixes cannot be handled reliably by Babel because they depend on
 * library-specific runtime patterns that remain after bundling.
 */
export function applyLegacyES5Fixes(code, targets) {
  let transformed = code;

  // Only apply to the dedicated ES5(IE11) target profile.
  if (!targets || !(targets.chrome === '23' || targets.ie === '11')) {
    return code;
  }

  // Fix 1: DataViewIndexOutOfBoundsError constructor
  // @msgpack/msgpack may emit a custom DataViewIndexOutOfBoundsError constructor
  // that becomes an illegal constructor call on Chrome 23 / ES5 environments.
  transformed = transformed.replace(
    /new\s+(?:exports\.)?DataViewIndexOutOfBoundsError\((["'])Insufficient data\1\)/g,
    'new RangeError("Insufficient data")'
  );

  // Fix 2: shouldAutoStart
  // IE11's document.currentScript is null in IIFE contexts.
  // Solution: Fall back to getElementsByTagName('script')
  transformed = transformed.replace(
    /function shouldAutoStart\(\)\s*\{[^}]+\}/,
    `function shouldAutoStart() {
  var script = document && document.currentScript;
  if (!script) {
    var scripts = document.getElementsByTagName('script');
    script = scripts[scripts.length - 1];
  }
  return !script || script.getAttribute('autostart') !== 'false';
}`
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
