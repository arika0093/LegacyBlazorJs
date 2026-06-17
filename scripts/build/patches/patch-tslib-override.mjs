#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

export async function patchTslibOverride(packageJsonPath) {
  const content = await readFile(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(content);

  if (!packageJson.overrides) {
    packageJson.overrides = {};
  }

  packageJson.overrides.tslib = '^2.4.0';

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log('Patched workspace package.json to use tslib ^2.4.0.');
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const packageJsonPath = process.argv[2];
  if (!packageJsonPath) {
    throw new Error('Usage: patch-tslib-override.mjs <package.json path>');
  }

  await patchTslibOverride(packageJsonPath);
}
