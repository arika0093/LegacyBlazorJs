import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCompatibilityBrowsers } from '../../scripts/test/lib/compat.mjs';

test('resolveCompatibilityBrowsers uses only the local Chromium snapshot mapping', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('resolveCompatibilityBrowsers should not fetch remote metadata');
  };

  try {
    const browsers = await resolveCompatibilityBrowsers();
    const es5 = browsers.get('es5');
    const es2015 = browsers.get('es2015');

    assert.equal(es5.version, '23.0.1249.0');
    assert.equal(es5.downloadUrl, 'https://commondatastorage.googleapis.com/chromium-browser-snapshots/Linux_x64/153876/chrome-linux.zip');
    assert.equal(es5.source, 'config/chromium-snapshot-overrides.json');

    assert.equal(es2015.version, '49.0.2621.4');
    assert.equal(es2015.downloadUrl, 'https://commondatastorage.googleapis.com/chromium-browser-snapshots/Linux_x64/369281/chrome-linux.zip');
    assert.equal(es2015.source, 'config/chromium-snapshot-overrides.json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
