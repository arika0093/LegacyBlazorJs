import { babel } from '@rollup/plugin-babel';

/**
 * Babel transpilation for application code (not node_modules)
 */
export function legacyBabelPlugin(targets) {
  return babel({
    babelHelpers: 'bundled',
    extensions: ['.js', '.mjs', '.ts'],
    exclude: /node_modules/,
    presets: [[
      '@babel/preset-env', {
        targets,
        modules: false,
        bugfixes: true,
        // Polyfills are prepended as one bundle by legacyCoreJsPolyfillPlugin.
        // Keeping usage-based injection here duplicates core-js inside app code.
        useBuiltIns: false
      }
    ]]
  });
}
