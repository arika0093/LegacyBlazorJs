/**
 * Fix IE11 compatibility issues in the output
 */
export function legacyIE11FixesPlugin() {
  return {
    name: 'legacy-ie11-fixes',
    renderChunk(code, chunk) {
      let transformed = code;
      
      // Fix _mergeNamespaces to properly check for object type (IE11 compatibility)
      // Without this, primitives like 'true' cause "Object.keys: argument is not an object" error
      transformed = transformed.replace(
        /e && typeof e !== 'string' && !Array\.isArray\(e\) && Object\.keys\(e\)/g,
        "e && typeof e === 'object' && typeof e !== 'string' && !Array.isArray(e) && Object.keys(e)"
      );
      
      // Fix shouldAutoStart for IE11 - document.currentScript may be null in IE11
      // Default to autostart if currentScript is not available
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
      
      // Fix userAgent?.match() patterns - add proper null checks
      // Pattern: if (condition && userAgent$N) { ... userAgent$N.match(...) }
      // Replace with: if (condition && userAgent$N && typeof userAgent$N.match === 'function')
      // Or simpler: add try-catch or explicit string check
      transformed = transformed.replace(
        /(\w+Agent\$?\d*)\s*&&\s*(\w+Agent\$?\d*)(\s*\)\s*\{[^}]*?)(\2)\.match\(/g,
        (match, var1, var2, middle, var3) => {
          // Add typeof check for string
          return `${var1} && typeof ${var2} === 'string'${middle}${var3}.match(`;
        }
      );
      
      return transformed === code ? null : { code: transformed, map: null };
    }
  };
}
