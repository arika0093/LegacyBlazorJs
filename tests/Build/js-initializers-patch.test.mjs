import assert from 'node:assert/strict';
import test from 'node:test';

import { applyJsInitializersPatch } from '../../src/build/patches/patch-js-initializers.mjs';

const SAMPLE = `    async function importAndInvokeInitializer(jsInitializer: JSInitializer, asset: JSAsset): Promise<void> {
      let adjustedPath;
      if (!asset.moduleExports) {
        adjustedPath = adjustPath(asset.name!);
        asset.moduleExports = await import(/* webpackIgnore: true */ adjustedPath);
      }
`;

test('skips Hot Reload initializer imports that legacy browsers cannot load', () => {
  const { code, applied } = applyJsInitializersPatch(SAMPLE);

  assert.equal(applied, true);
  assert.match(code, /LegacyBlazorJs: skip legacy-unsupported Hot Reload initializer\./u);
  assert.match(code, /DotNetWatch\|hot\[-_\]\?reload/u);
  assert.match(code, /try \{/u);
});

test('patch is idempotent', () => {
  const first = applyJsInitializersPatch(SAMPLE);
  assert.equal(first.applied, true);

  const second = applyJsInitializersPatch(first.code);
  assert.equal(second.applied, false);
  assert.equal(second.code, first.code);
});

test('leaves unrelated sources untouched', () => {
  const { code, applied } = applyJsInitializersPatch('const x = 1;\n');

  assert.equal(applied, false);
  assert.equal(code, 'const x = 1;\n');
});

test('skips Hot Reload imports in the .NET 9 initializer shape', () => {
  const v9Sample = `    async function importAndInvokeInitializer(jsInitializer: JSInitializer, path: string): Promise<void> {
      const adjustedPath = adjustPath(path);
      const initializer = await import(/* webpackIgnore: true */ adjustedPath) as Partial<BlazorInitializer>;
      if (initializer === undefined) {
        return;
      }
`;

  const { code, applied } = applyJsInitializersPatch(v9Sample);

  assert.equal(applied, true);
  assert.match(code, /LegacyBlazorJs: skip legacy-unsupported Hot Reload initializer\./u);
  assert.match(code, /let initializer;/u);
  assert.match(code, /DotNetWatch\|hot\[-_\]\?reload/u);

  const second = applyJsInitializersPatch(code);
  assert.equal(second.applied, false);
  assert.equal(second.code, code);
});
