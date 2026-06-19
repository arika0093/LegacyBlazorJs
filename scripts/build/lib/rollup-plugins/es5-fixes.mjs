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
  // that becomes an illegal constructor call on ES5 environments.
  transformed = transformed.replace(
    /new\s+(?:exports\.)?DataViewIndexOutOfBoundsError\((["'])Insufficient data\1\)/g,
    'new RangeError("Insufficient data")'
  );

  // Fix 2: shouldAutoStart function logic
  // IE does not start automatically, so override the shouldAutoStart function to always return true.
  transformed = transformed.replace(
    /function shouldAutoStart\(\)\s*\{[^}]+\}/,
    `function shouldAutoStart() { return true; }`
  );

  // Fix 3: prefer vendor-prefixed MutationObserver implementations when present.
  transformed = transformed.replace(
    /new MutationObserver\(/g,
    'new (window.MutationObserver || window.WebKitMutationObserver)('
  );

  // Fix 4: avoid Symbol-backed metadata keys on DOM nodes.
  // Blazor's logical DOM bookkeeping touches comment/text nodes during JS.AttachComponent.
  // Replacing these internal keys with opaque strings avoids the polyfilled
  // Symbol access path that can recurse and overflow the stack in IE11.
  //   before: var somePropname = Symbol();
  //   after:  var somePropname = '__somePropname';
  transformed = transformed.replace(
    /var\s+(\w+Propname)\s*=\s*Symbol\([^)]*\);/g,
    (_, variableName) => {
      const legacyKeyName = variableName
        .replace(/Propname$/, '')
        .replace(/^[a-z]/, prefix => prefix.toUpperCase());

      return `var ${variableName} = '__legacyBlazor${legacyKeyName}';`;
    }
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
