import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');

function resolveBabelTargets(profile) {
  if (profile.intendedBrowsers && typeof profile.intendedBrowsers === 'object' && !Array.isArray(profile.intendedBrowsers)) {
    return profile.intendedBrowsers;
  }

  const fallbackTargets = {
    5: { ie: '11' },
    2015: { chrome: '49', firefox: '45', safari: '10', edge: '12' },
    2017: { chrome: '58', firefox: '54', safari: '11', edge: '16' },
  };

  const targets = fallbackTargets[profile.ecma];
  if (!targets) {
    throw new Error(`No Babel fallback target is configured for ECMA ${profile.ecma}.`);
  }

  return targets;
}

test('es5 profile explicitly targets IE11', async () => {
  const targetsPath = path.join(process.cwd(), 'config', 'targets.json');
  const targets = JSON.parse(await readFile(targetsPath, 'utf8'));
  assert.deepEqual(targets.es5.intendedBrowsers, { ie: '11' });
});

test('legacy Babel pass removes arrow functions for IE11 targets', () => {
  const source = 'const add = (left, right) => left + right;';
  const result = babel.transformSync(source, {
    presets: [['@babel/preset-env', { targets: resolveBabelTargets({ ecma: 5, intendedBrowsers: { ie: '11' } }) }]],
    filename: 'sample.js',
    compact: false,
  });

  assert.ok(result?.code);
  assert.equal(result.code.includes('=>'), false);
});
