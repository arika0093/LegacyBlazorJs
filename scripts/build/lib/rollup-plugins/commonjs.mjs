import commonjs from '@rollup/plugin-commonjs';

/**
 * Convert CommonJS modules (like core-js) to ES modules
 */
export function legacyCommonjsPlugin() {
  return commonjs({
    include: /node_modules/,
  });
}
