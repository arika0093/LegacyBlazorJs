import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyCurrentScriptPolyfillPlugin } from '../../src/build/rollup-plugins/current-script.mjs';
import { legacyDynamicImportPlugin } from '../../src/build/rollup-plugins/dynamic-import.mjs';
import { legacyWhatwgFetchPlugin } from '../../src/build/rollup-plugins/whatwg-fetch.mjs';

const entryModuleId = '/tmp/src/Boot.WebAssembly.ts';

test('currentScript polyfill injects into legacy entry modules', async () => {
  const plugin = legacyCurrentScriptPolyfillPlugin({ ie: '11' });
  await plugin.buildStart();

  const transformed = plugin.transform('console.log("boot");', entryModuleId);

  assert.ok(transformed);
  assert.match(transformed.code, /^import "legacy-blazor-current-script-polyfill";/);

  const resolvedId = plugin.resolveId('legacy-blazor-current-script-polyfill');
  assert.equal(typeof resolvedId, 'string');
  assert.match(plugin.load(resolvedId), /currentScript/);
});

test('currentScript polyfill skips modern targets', async () => {
  const plugin = legacyCurrentScriptPolyfillPlugin({ chrome: '90' });
  await plugin.buildStart();

  assert.equal(plugin.resolveId('legacy-blazor-current-script-polyfill'), null);
  assert.equal(plugin.transform('console.log("boot");', entryModuleId), null);
});

test('whatwg fetch polyfill only injects when fetch is used', async () => {
  const plugin = legacyWhatwgFetchPlugin();
  await plugin.buildStart();

  const transformed = plugin.transform('export function load() { return fetch("/data"); }', '/tmp/src/api.ts');
  const untouched = plugin.transform('export function load() { return Promise.resolve(1); }', '/tmp/src/api.ts');

  assert.ok(transformed);
  assert.match(transformed.code, /^import "legacy-blazor-whatwg-fetch";/);
  assert.equal(untouched, null);
});

test('dynamic import plugin injects helper from physical file', async () => {
  const plugin = legacyDynamicImportPlugin();
  await plugin.buildStart();

  const transformed = plugin.renderChunk('export async function load() { return import("./feature.js"); }', {
    fileName: 'boot.js',
  });

  assert.ok(transformed);
  assert.match(transformed.code, /function __legacyDynamicImport\(u\)/);
  assert.match(transformed.code, /return __legacyDynamicImport\("\.\/feature\.js"\)/);
});
