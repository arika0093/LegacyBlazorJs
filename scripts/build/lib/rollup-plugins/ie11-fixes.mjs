/**
 * Fix IE11 compatibility issues in the output
 * 
 * These fixes cannot be handled by Babel because they are:
 * 1. Runtime logic issues (not syntax issues)
 * 2. Framework-specific patterns that Babel doesn't recognize
 * 3. Issues that appear after Babel transformation
 * 
 * Q: Are these IE11-specific?
 * A: Mostly yes, but some fixes also benefit other legacy browsers:
 *    - _mergeNamespaces: Affects any browser where Object.keys(primitive) throws
 *    - shouldAutoStart: Affects IE11 specifically (document.currentScript)
 *    - userAgent checks: Prevents errors when userAgent is not a string
 */
export function legacyIE11FixesPlugin() {
  return {
    name: 'legacy-ie11-fixes',
    renderChunk(code, chunk) {
      let transformed = code;
      
      // Fix 1: _mergeNamespaces type checking
      // Why Babel can't fix: This is a Rollup-generated helper with a logic bug.
      // Babel only transpiles syntax, not runtime logic.
      // Without this, primitives like 'true' cause "Object.keys: argument is not an object" error
      transformed = transformed.replace(
        /e && typeof e !== 'string' && !Array\.isArray\(e\) && Object\.keys\(e\)/g,
        "e && typeof e === 'object' && typeof e !== 'string' && !Array.isArray(e) && Object.keys(e)"
      );
      
      // Fix 2: shouldAutoStart for IE11
      // Why Babel can't fix: This requires changing the function logic, not syntax.
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
      // Why Babel can't fix: This is a defensive runtime check.
      // Babel transpiles syntax but doesn't add null-safety checks.
      // Without this, userAgent being non-string causes "object does not support match" error
      transformed = transformed.replace(
        /if\s*\(\s*!version\s*&&\s*userAgent(\$\d+)\s*\)\s*\{/g,
        'if (!version && userAgent$1 && typeof userAgent$1 === \'string\') {'
      );
      
      return transformed === code ? null : { code: transformed, map: null };
    }
  };
}
