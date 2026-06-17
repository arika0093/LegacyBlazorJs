import test from 'node:test';
import assert from 'node:assert/strict';
import { withOptionalRollupTerser, withRollupLegacyPlugins } from '../../../scripts/build/build-variants.mjs';

const sampleRollupConfig = `import terser from '@rollup/plugin-terser';

const baseConfig = {
  plugins: [
    resolve(),
    commonjs(),
    terser({
      compress: {
        passes: 3
      },
      mangle: true,
      module: false,
      format: {
        ecma: 2020
      },
      keep_classnames: false,
      keep_fnames: false,
      toplevel: true
    }),
    filesize()
  ]
};
`;

test('withRollupLegacyPlugins inserts legacy plugins before terser', () => {
  const patched = withRollupLegacyPlugins(sampleRollupConfig);
  assert.match(patched, /\.\.\.legacyBlazorPlugins\(\),\n\s*terser\(\{/);
});

test('withOptionalRollupTerser comments out the full terser block', () => {
  const patched = withOptionalRollupTerser(withRollupLegacyPlugins(sampleRollupConfig));
  assert.match(patched, /\/\/ LegacyBlazorJs: terser disabled via LEGACY_BLAZOR_DISABLE_TERSER\./);
  assert.match(patched, /\n\s*\/\/ terser\(\{/);
  assert.match(patched, /filesize\(\)/);
  assert.match(patched, /\.\.\.legacyBlazorPlugins\(\),\n\s*\/\/ LegacyBlazorJs:/);
});
