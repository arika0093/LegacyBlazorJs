import assert from 'node:assert/strict';
import test from 'node:test';

import { withReservedLegacyDynamicImportName } from '../../src/build/build-variants.mjs';
import { needsLegacyDynamicImportTransform } from '../../src/build/rollup-plugins/dynamic-import.mjs';

test('legacy dynamic-import transform is limited to ES2017 and earlier profiles', () => {
  assert.equal(needsLegacyDynamicImportTransform({ chrome: '23', ie: '11' }), true);
  assert.equal(needsLegacyDynamicImportTransform({ chrome: '49' }), true);
  assert.equal(needsLegacyDynamicImportTransform({ chrome: '58' }), true);
  assert.equal(needsLegacyDynamicImportTransform({ chrome: '64' }), false);
  assert.equal(needsLegacyDynamicImportTransform({ chrome: '80' }), false);
});

test('reserves the dynamic-import helper name in the upstream terser configuration', () => {
  const config = `terser({\n  compress: { passes: 3 },\n  mangle: true,\n  toplevel: true\n}),`;
  const transformed = withReservedLegacyDynamicImportName(config);

  assert.match(transformed, /mangle: \{ reserved: \['__legacyDynamicImport'\] \}/u);
  assert.equal(withReservedLegacyDynamicImportName(transformed), transformed);
});
