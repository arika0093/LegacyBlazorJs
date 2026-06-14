import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('supported majors and browser target profiles are configured', async () => {
  const majors = await readJson('../config/majors.json');
  const targets = await readJson('../config/targets.json');
  assert.deepEqual(majors.supportedMajors, [8, 9, 10]);
  for (const required of ['ie6', 'ie7', 'ie8', 'ie9', 'ie10', 'ie11', 'es2015', 'es2016', 'es2017', 'es2018', 'es2019', 'es2020', 'es2021', 'es2022']) {
    assert.ok(targets[required], `missing ${required} profile`);
    assert.ok(targets[required].typescriptTarget, `missing ${required} TypeScript target`);
    assert.ok(targets[required].intendedBrowsers, `missing ${required} intended browser documentation`);
  }
  assert.equal(targets.modern, undefined);
});
