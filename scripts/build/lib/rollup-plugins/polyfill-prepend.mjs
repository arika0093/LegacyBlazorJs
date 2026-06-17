/**
 * Inject Symbol and other critical polyfills at the top of the bundle for IE11
 * This ensures Babel helpers (_typeof2, etc.) can execute without errors
 */
export function legacyPolyfillPrependPlugin() {
  return {
    name: 'legacy-polyfill-prepend',
    renderChunk(code, chunk) {
      // Only prepend to entry chunks to avoid duplication
      if (!chunk.isEntry) {
        return null;
      }
      
      // Critical polyfills that must be loaded before any other code
      const polyfills = `
// IE11 critical polyfills - must run before any Babel helpers
(function() {
  // Symbol polyfill (minimal implementation for typeof checks)
  if (typeof Symbol === 'undefined') {
    var SymbolPolyfill = function Symbol(description) {
      return '@@symbol:' + (description || '') + ':' + Math.random();
    };
    SymbolPolyfill.iterator = SymbolPolyfill('iterator');
    SymbolPolyfill.toStringTag = SymbolPolyfill('toStringTag');
    SymbolPolyfill.hasInstance = SymbolPolyfill('hasInstance');
    SymbolPolyfill.prototype = {};
    window.Symbol = SymbolPolyfill;
  }
})();
`;
      
      return {
        code: polyfills + code,
        map: null
      };
    }
  };
}
