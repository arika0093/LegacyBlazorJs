import test from 'node:test';
import assert from 'node:assert/strict';
import { latestTagForMajor, parseAspNetTag } from '../scripts/version-lib.mjs';

test('parses stable and prerelease ASP.NET Core tags', () => {
  assert.deepEqual(parseAspNetTag('v8.0.27'), { tag: 'v8.0.27', major: 8, minor: 0, patch: 27, prerelease: null, version: '8.0.27' });
  assert.equal(parseAspNetTag('not-a-tag'), null);
  assert.equal(parseAspNetTag('v10.0.0-preview.1').prerelease, 'preview.1');
});

test('selects latest stable tag for a major', () => {
  const selected = latestTagForMajor(['v8.0.9', 'v9.0.1', 'v8.0.27', 'v8.0.28-preview.1'], 8);
  assert.equal(selected.tag, 'v8.0.27');
});

test('can include prerelease tags', () => {
  const selected = latestTagForMajor(['v10.0.0-preview.2', 'v10.0.0-preview.10'], 10, true);
  assert.equal(selected.tag, 'v10.0.0-preview.10');
});
