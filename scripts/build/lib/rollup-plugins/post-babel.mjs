import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Post-process Rollup output with Babel to ensure all code (including Rollup helpers) is IE11 compatible
 * This is necessary because Rollup's own helpers (_mergeNamespaces, etc.) are not transpiled by @rollup/plugin-babel
 * 
 * NOTE: This is expensive (transforms entire output), but necessary because:
 * 1. Rollup helpers are not in node_modules, so can't be included in babel plugin
 * 2. Rollup helpers use ES2015+ syntax that IE11 doesn't support
 * 3. We only apply this for legacy targets (ecma < 2018)
 */
export function legacyPostBabelPlugin(targets) {
  const babel = require('@babel/core');
  
  return {
    name: 'legacy-post-babel',
    renderChunk(code, chunk) {
      // Apply Babel transformation to the entire chunk (including Rollup helpers)
      // Note: useBuiltIns is intentionally omitted here since polyfills were already
      // injected by the earlier babel plugin
      const result = babel.transformSync(code, {
        presets: [[
          '@babel/preset-env', {
            targets,
            modules: false,
            bugfixes: true,
            // Don't inject polyfills here - already done in legacyBabelPlugin
            useBuiltIns: false,
          }
        ]],
        filename: chunk.fileName,
        compact: false,
        sourceMaps: false,
      });
      
      return {
        code: result.code,
        map: null
      };
    }
  };
}
