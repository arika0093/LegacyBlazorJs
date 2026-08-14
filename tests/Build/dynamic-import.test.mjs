import assert from 'node:assert/strict';
import test from 'node:test';

import { withReservedLegacyDynamicImportName } from '../../src/build/build-variants.mjs';
import { needsCoreJsPolyfill } from '../../src/build/rollup-plugins/corejs-polyfill.mjs';
import {
  legacyBlazorPlugins,
  needsLegacyBlazorPlugins,
} from '../../src/build/rollup-plugins/index.mjs';
import { needsLegacyDynamicImportTransform } from '../../src/build/rollup-plugins/dynamic-import.mjs';

test('legacy dynamic-import transform is retained through the ES2018 profile', () => {
  assert.equal(needsLegacyDynamicImportTransform({ chrome: '23', ie: '11' }), true);
  assert.equal(needsLegacyDynamicImportTransform({ chrome: '49' }), true);
  assert.equal(needsLegacyDynamicImportTransform({ chrome: '58' }), true);
  assert.equal(needsLegacyDynamicImportTransform({ chrome: '64' }), true);
  assert.equal(needsLegacyDynamicImportTransform({ chrome: '80' }), false);
});

test('reserves the dynamic-import helper name in the upstream terser configuration', () => {
  const config = `terser({\n  compress: { passes: 3 },\n  mangle: true,\n  toplevel: true\n}),`;
  const transformed = withReservedLegacyDynamicImportName(config);

  assert.match(transformed, /mangle: \{ reserved: \['__legacyDynamicImport'\] \}/u);
  assert.equal(withReservedLegacyDynamicImportName(transformed), transformed);
});

test('does not inject core-js for modern target profiles', () => {
  assert.equal(needsCoreJsPolyfill({ chrome: '64' }), true);
  assert.equal(needsCoreJsPolyfill({ chrome: '80' }), false);
  assert.equal(needsCoreJsPolyfill({ chrome: '94' }), false);
  assert.equal(needsCoreJsPolyfill({ ie: '11' }), true);
});

test('does not inject legacy Rollup plugins for modern target profiles', () => {
  assert.equal(needsLegacyBlazorPlugins({ chrome: '64' }), true);
  assert.equal(needsLegacyBlazorPlugins({ chrome: '80' }), false);
  assert.equal(needsLegacyBlazorPlugins({ chrome: '94' }), false);
  assert.equal(needsLegacyBlazorPlugins({ ie: '11' }), true);
});

test('keeps Babel syntax lowering for modern target profiles', () => {
  const plugins = legacyBlazorPlugins({ chrome: '80' });

  assert.deepEqual(plugins.map(plugin => plugin.name), ['babel']);
});
