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

      // Fix 1: _mergeNamespaces type checking
      // Without this, primitives like 'true' cause "Object.keys: argument is not an object" error
      transformed = transformed.replace(
        /e && typeof e !== 'string' && !Array\.isArray\(e\) && Object\.keys\(e\)/g,
        "e && typeof e === 'object' && typeof e !== 'string' && !Array.isArray(e) && Object.keys(e)"
      );

      // Fix 2: shouldAutoStart for IE11
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

      // Fix 3: userAgent.match() safety check
      // Without this, userAgent being non-string causes "object does not support match" error
      transformed = transformed.replace(
        /if\s*\(\s*!version\s*&&\s*userAgent(\$\d+)\s*\)\s*\{/g,
        'if (!version && userAgent$1 && typeof userAgent$1 === \'string\') {'
      );

      return transformed === code ? null : { code: transformed, map: null };
    }
  };
}
